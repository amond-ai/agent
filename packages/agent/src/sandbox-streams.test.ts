import { describe, expect, it, vi } from 'vitest'
import {
  bytesToStream,
  createProcessController,
  sliceLines,
  streamToBytes,
  stringToStream,
} from './sandbox-streams.ts'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function readChunks(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader()
  const out: string[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) { return out }
    out.push(decode(value))
  }
}

describe('stream conversions', () => {
  it('round-trips bytes and strings through a stream', async () => {
    expect(decode(await streamToBytes(stringToStream('héllo')))).toBe('héllo')
    expect(await streamToBytes(bytesToStream(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('reads an empty payload as zero bytes', async () => {
    expect((await streamToBytes(bytesToStream(new Uint8Array()))).byteLength).toBe(0)
  })

  it('concatenates multiple chunks in order', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]))
        c.enqueue(new Uint8Array([3]))
        c.close()
      },
    })
    expect(await streamToBytes(stream)).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('sliceLines', () => {
  const text = 'a\nb\nc\nd\n'

  it('returns the text unchanged when no range is given', () => {
    expect(sliceLines(text)).toBe(text)
  })

  it('uses 1-based inclusive ranges', () => {
    expect(sliceLines(text, 2, 3)).toBe('b\nc')
    expect(sliceLines(text, 1, 1)).toBe('a')
    expect(sliceLines(text, 3)).toBe('c\nd\n')
    expect(sliceLines(text, undefined, 2)).toBe('a\nb')
  })

  it('returns through EOF when endLine is past the end, keeping the final newline', () => {
    expect(sliceLines(text, 3, 99)).toBe('c\nd\n')
    expect(sliceLines('a\nb', 2, 99)).toBe('b')
  })

  it('returns an empty string when startLine is past EOF or the range is empty', () => {
    expect(sliceLines(text, 5)).toBe('')
    expect(sliceLines(text, 99, 100)).toBe('')
    expect(sliceLines(text, 3, 2)).toBe('')
    expect(sliceLines('', 1, 1)).toBe('')
  })

  it('treats a start below 1 as line 1 and preserves CRLF', () => {
    expect(sliceLines('a\r\nb\r\n', 0, 1)).toBe('a\r')
  })
})

describe('createProcessController', () => {
  it('delivers pushed chunks in order and resolves wait() with the exit code', async () => {
    const c = createProcessController({ kill: () => {} })
    const out = readChunks(c.process.stdout)
    const err = readChunks(c.process.stderr)
    c.pushStdout('one')
    c.pushStderr(new TextEncoder().encode('e1'))
    c.pushStdout(new TextEncoder().encode('two'))
    c.pushStdout('three')
    c.pushStderr('e2')
    c.exit(7)
    expect(await out).toEqual(['one', 'two', 'three'])
    expect(await err).toEqual(['e1', 'e2'])
    expect(await c.process.wait()).toEqual({ exitCode: 7 })
  })

  it('exposes pid only when given', () => {
    expect(createProcessController({ kill: () => {}, pid: 42 }).process.pid).toBe(42)
    expect('pid' in createProcessController({ kill: () => {} }).process).toBe(false)
  })

  it('ignores pushes and a second settlement after exit', async () => {
    const c = createProcessController({ kill: () => {} })
    c.exit(0)
    c.pushStdout('late')
    c.exit(5)
    c.fail(new Error('late'))
    expect(await readChunks(c.process.stdout)).toEqual([])
    expect(await c.process.wait()).toEqual({ exitCode: 0 })
  })

  it('errors both streams and rejects wait() on fail', async () => {
    const c = createProcessController({ kill: () => {} })
    const boom = new Error('boom')
    c.fail(boom)
    await expect(readChunks(c.process.stdout)).rejects.toBe(boom)
    await expect(readChunks(c.process.stderr)).rejects.toBe(boom)
    await expect(c.process.wait()).rejects.toBe(boom)
  })

  it('does not raise an unhandled rejection when a failed process is never awaited', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      createProcessController({ kill: () => {} }).fail(new Error('nobody listens'))
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).not.toHaveBeenCalled()
    }
    finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('calls the provider kill hook once however often kill() is called', async () => {
    const kill = vi.fn()
    const c = createProcessController({ kill })
    await Promise.all([c.process.kill(), c.process.kill()])
    await c.process.kill()
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('lets the kill hook settle the process, and wait() reports that code', async () => {
    const c = createProcessController({ kill: () => c.exit(137) })
    await c.process.kill()
    expect(await c.process.wait()).toEqual({ exitCode: 137 })
  })

  it('makes kill() after exit a no-op that keeps the original code', async () => {
    const kill = vi.fn()
    const c = createProcessController({ kill })
    c.exit(3)
    await c.process.kill()
    expect(kill).not.toHaveBeenCalled()
    expect(await c.process.wait()).toEqual({ exitCode: 3 })
  })

  it('survives a consumer that cancelled a stream', async () => {
    const c = createProcessController({ kill: () => {} })
    await c.process.stdout.cancel()
    expect(() => c.pushStdout('x')).not.toThrow()
    expect(() => c.exit(0)).not.toThrow()
    expect(await c.process.wait()).toEqual({ exitCode: 0 })
  })
})
