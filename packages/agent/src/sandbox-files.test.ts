import { Bash } from 'just-bash'
import { describe, expect, it, vi } from 'vitest'
import { FileNotFoundError } from './errors.ts'
import { bash } from './sandbox.ts'
import { createAmondFs, createSandboxFileMethods } from './sandbox-files.ts'
import { streamToBytes, stringToStream } from './sandbox-streams.ts'
import type { Sandbox } from './types.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

class MissingError extends Error {}

/** In-memory provider; relative paths resolve under /work. */
function setup(initial: Record<string, Uint8Array | string> = {}) {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]),
  )
  const calls: string[] = []
  const primitives = {
    resolvePath: (p: string) => (p.startsWith('/') ? p : `/work/${p}`),
    readText: vi.fn(async (p: string) => {
      calls.push(`readText ${p}`)
      const f = files.get(p)
      if (!f) { throw new MissingError(p) }
      return dec.decode(f)
    }),
    readBytes: vi.fn(async (p: string) => {
      calls.push(`readBytes ${p}`)
      const f = files.get(p)
      if (!f) { throw new MissingError(p) }
      return f
    }),
    write: vi.fn(async (p: string, c: string | Uint8Array) => {
      calls.push(`write ${p}`)
      files.set(p, typeof c === 'string' ? enc.encode(c) : c)
    }),
    isMissing: vi.fn((e: unknown) => e instanceof MissingError),
  }
  return { files, calls, primitives, methods: createSandboxFileMethods(primitives) }
}

describe('createSandboxFileMethods reads', () => {
  it('resolves relative paths through the provider', async () => {
    const { methods } = setup({ '/work/a.txt': 'hi' })
    expect(await methods.readTextFile({ path: 'a.txt' })).toBe('hi')
  })

  it('resolves to null for a missing file on all three read methods', async () => {
    const { methods } = setup()
    expect(await methods.readTextFile({ path: 'nope' })).toBeNull()
    expect(await methods.readBinaryFile({ path: 'nope' })).toBeNull()
    expect(await methods.readFile({ path: 'nope' })).toBeNull()
  })

  it('rethrows the original error when the failure is not a missing file', async () => {
    const { methods, primitives } = setup({ '/work/a': 'x' })
    const boom = new Error('EACCES')
    primitives.readText.mockRejectedValueOnce(boom)
    await expect(methods.readTextFile({ path: 'a' })).rejects.toBe(boom)
    primitives.readBytes.mockRejectedValueOnce(boom)
    await expect(methods.readBinaryFile({ path: 'a' })).rejects.toBe(boom)
  })

  it('passes the resolved path to isMissing', async () => {
    const { methods, primitives } = setup()
    await methods.readBinaryFile({ path: 'nope' })
    expect(primitives.isMissing).toHaveBeenCalledWith(expect.any(MissingError), '/work/nope')
  })

  it('reads an existing empty file as "" / zero bytes, not null', async () => {
    const { methods } = setup({ '/work/e': '' })
    expect(await methods.readTextFile({ path: 'e' })).toBe('')
    expect((await methods.readBinaryFile({ path: 'e' }))?.byteLength).toBe(0)
    const stream = await methods.readFile({ path: 'e' })
    expect(stream).not.toBeNull()
    expect((await streamToBytes(stream!)).byteLength).toBe(0)
  })

  it('streams and returns bytes', async () => {
    const { methods } = setup({ '/work/b': new Uint8Array([0, 255, 7]) })
    expect(await methods.readBinaryFile({ path: 'b' })).toEqual(new Uint8Array([0, 255, 7]))
    expect(await streamToBytes((await methods.readFile({ path: 'b' }))!)).toEqual(new Uint8Array([0, 255, 7]))
  })

  it('applies 1-based inclusive line ranges, returning through EOF past the end', async () => {
    const { methods } = setup({ '/work/l': 'one\ntwo\nthree\n' })
    expect(await methods.readTextFile({ path: 'l', startLine: 2, endLine: 2 })).toBe('two')
    expect(await methods.readTextFile({ path: 'l', startLine: 2, endLine: 50 })).toBe('two\nthree\n')
    expect(await methods.readTextFile({ path: 'l', startLine: 9 })).toBe('')
  })

  it('decodes non-utf-8 encodings from bytes and accepts utf-8 aliases', async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xE9])
    const { methods, calls } = setup({ '/work/f': latin1 })
    expect(await methods.readTextFile({ path: 'f', encoding: 'latin1' })).toBe('café')
    expect(calls).toEqual(['readBytes /work/f'])
    await methods.readTextFile({ path: 'f', encoding: 'UTF8' })
    expect(calls.at(-1)).toBe('readText /work/f')
  })

  it('rejects with an AbortError before any provider call when already aborted', async () => {
    const { methods, primitives } = setup({ '/work/a': 'x' })
    const abortSignal = AbortSignal.abort('stop')
    for (const call of [
      methods.readFile({ path: 'a', abortSignal }),
      methods.readBinaryFile({ path: 'a', abortSignal }),
      methods.readTextFile({ path: 'a', abortSignal }),
      methods.writeFile({ path: 'a', content: stringToStream('x'), abortSignal }),
      methods.writeBinaryFile({ path: 'a', content: new Uint8Array(), abortSignal }),
      methods.writeTextFile({ path: 'a', content: 'x', abortSignal }),
    ]) {
      await expect(call).rejects.toMatchObject({ name: 'AbortError' })
    }
    expect(primitives.readText).not.toHaveBeenCalled()
    expect(primitives.readBytes).not.toHaveBeenCalled()
    expect(primitives.write).not.toHaveBeenCalled()
  })
})

describe('createSandboxFileMethods writes', () => {
  it('writes text, bytes, and streams to the resolved path', async () => {
    const { methods, files } = setup()
    await methods.writeTextFile({ path: 't', content: 'text' })
    await methods.writeBinaryFile({ path: 'b', content: new Uint8Array([9, 8]) })
    await methods.writeFile({ path: 's', content: stringToStream('streamed') })
    expect(dec.decode(files.get('/work/t'))).toBe('text')
    expect(files.get('/work/b')).toEqual(new Uint8Array([9, 8]))
    expect(dec.decode(files.get('/work/s'))).toBe('streamed')
  })

  it('hands text to the provider as a string and accepts utf-8 aliases', async () => {
    const { methods, primitives } = setup()
    await methods.writeTextFile({ path: 't', content: 'x', encoding: 'utf-8' })
    await methods.writeTextFile({ path: 't', content: 'y', encoding: 'utf8' })
    expect(primitives.write).toHaveBeenNthCalledWith(1, '/work/t', 'x')
    expect(primitives.write).toHaveBeenNthCalledWith(2, '/work/t', 'y')
  })

  it('throws a TypeError naming the encoding for non-utf-8 writes, without writing', async () => {
    const { methods, primitives } = setup()
    await expect(methods.writeTextFile({ path: 't', content: 'x', encoding: 'latin1' }))
      .rejects
      .toThrow(TypeError)
    await expect(methods.writeTextFile({ path: 't', content: 'x', encoding: 'latin1' }))
      .rejects
      .toThrow(/latin1/)
    await expect(methods.writeTextFile({ path: 't', content: 'x', encoding: 'not-a-codec' }))
      .rejects
      .toThrow(/not-a-codec/)
    expect(primitives.write).not.toHaveBeenCalled()
  })
})

describe('createAmondFs', () => {
  async function bashSandbox(): Promise<Sandbox> {
    return bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'fs' })
  }

  it('rejects readFile and readFileBuffer of a missing file with FileNotFoundError (AC-016)', async () => {
    const sandbox = await bashSandbox()
    const amondFs = createAmondFs(() => sandbox)

    await expect(amondFs.readFile('missing.txt')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(amondFs.readFile('missing.txt')).rejects.toThrow('File not found: missing.txt')
    await expect(amondFs.readFileBuffer('missing.bin')).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('writes strings as text and bytes as binary, creating parents, and reads them back', async () => {
    const sandbox = await bashSandbox()
    const writeTextFile = vi.spyOn(sandbox, 'writeTextFile')
    const writeBinaryFile = vi.spyOn(sandbox, 'writeBinaryFile')
    const amondFs = createAmondFs(() => sandbox)

    await amondFs.writeFile('a/b/t.txt', 'text')
    await amondFs.writeFile('a/b/b.bin', new Uint8Array([1, 2, 3]))

    expect(writeTextFile).toHaveBeenCalledWith({ path: 'a/b/t.txt', content: 'text' })
    expect(writeBinaryFile).toHaveBeenCalledWith({ path: 'a/b/b.bin', content: new Uint8Array([1, 2, 3]) })
    expect(await amondFs.readFile('a/b/t.txt')).toBe('text')
    expect(await amondFs.readFileBuffer('/work/a/b/b.bin')).toEqual(new Uint8Array([1, 2, 3]))
    expect(await amondFs.exists('a/b')).toBe(true)
    expect(await amondFs.readdir('a/b')).toEqual(['b.bin', 't.txt'])
  })

  it('reads an existing empty file as an empty string', async () => {
    const sandbox = await bashSandbox()
    const amondFs = createAmondFs(() => sandbox)
    await amondFs.writeFile('empty.txt', '')

    expect(await amondFs.readFile('empty.txt')).toBe('')
  })

  it('operates on the sandbox current at each call', async () => {
    const first = await bashSandbox()
    const second = await bashSandbox()
    await second.writeTextFile({ path: 'only-in-second.txt', content: 'second' })
    let current = first
    const amondFs = createAmondFs(() => current)

    expect(await amondFs.exists('only-in-second.txt')).toBe(false)
    current = second
    expect(await amondFs.readFile('only-in-second.txt')).toBe('second')
  })
})
