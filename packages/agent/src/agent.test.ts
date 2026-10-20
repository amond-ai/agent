import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Bash } from 'just-bash'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  createBashTool,
  createEditTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
  formatPackagedSkillFilePath,
  overlayPackagedSkills,
} from './agent.ts'
import { encodeBase64 } from './base64.ts'
import { FileNotFoundError } from './errors.ts'
import { local } from './node/local.ts'
import type { SandboxDriver } from './sandbox.ts'
import { bash, sandboxFromDriver } from './sandbox.ts'
import type { PackagedSkillDirectory, Sandbox } from './types.ts'

const enc = new TextEncoder()

/** A signal-blind driver over just-bash's in-memory filesystem. */
function justBashDriver(shell: Bash): SandboxDriver {
  const shellFs = shell.fs
  return {
    readFile: p => shellFs.readFile(p),
    readFileBuffer: p => shellFs.readFileBuffer(p),
    writeFile: (p, content) => shellFs.writeFile(p, content),
    stat: p => shellFs.stat(p),
    readdir: p => shellFs.readdir(p),
    exists: p => shellFs.exists(p),
    mkdir: (p, options) => shellFs.mkdir(p, options),
    rm: (p, options) => shellFs.rm(p, options),
    async exec(command, options) {
      const { stdout, stderr, exitCode } = await shell.exec(command, { cwd: options?.cwd, env: options?.env })
      return { stdout, stderr, exitCode }
    },
  }
}

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
})

const providers: Array<{ name: string, make: () => Promise<Sandbox> }> = [
  {
    name: 'local()',
    async make() {
      const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'amond-agent-tools-')))
      tempDirs.push(cwd)
      return local({ cwd }).createSandbox({ id: 'tools' })
    },
  },
  {
    name: 'bash()',
    make: () => bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'tools' }),
  },
  {
    name: 'sandboxFromDriver',
    make: async () => sandboxFromDriver(justBashDriver(new Bash({ cwd: '/work' })), '/work'),
  },
]

function textOf(result: { content: Array<{ type: string, text?: string }> }): string | undefined {
  return result.content[0]?.text
}

describe.each(providers)('built-in file tools on $name', ({ make }) => {
  it('read of a missing file fails with "File not found: {path}" (AC-015)', async () => {
    const sandbox = await make()
    const read = createReadTool(sandbox).execute('call', { path: 'missing.txt' })

    await expect(read).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(read).rejects.toThrow(/^File not found: missing\.txt$/)
  })

  it('edit of a missing file fails with "File not found: {path}" and writes nothing (AC-015)', async () => {
    const sandbox = await make()
    const edit = createEditTool(sandbox).execute('call', { path: 'nested/missing.txt', oldText: 'a', newText: 'b' })

    await expect(edit).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(edit).rejects.toThrow(/^File not found: nested\/missing\.txt$/)
    expect(await sandbox.exists('nested/missing.txt')).toBe(false)
  })

  it('write, edit, and read round-trip through the session file methods', async () => {
    const sandbox = await make()
    await createWriteTool(sandbox).execute('call', { path: 'dir/a.txt', content: 'one\ntwo\nthree' })
    await createEditTool(sandbox).execute('call', { path: 'dir/a.txt', oldText: 'two', newText: '2' })

    const result = await createReadTool(sandbox).execute('call', { path: 'dir/a.txt', offset: 2, limit: 2 })
    expect(textOf(result)).toBe('2\nthree')
    expect(await sandbox.readTextFile({ path: 'dir/a.txt' })).toBe('one\n2\nthree')
  })
})

/** A sandbox whose members are spies over an in-memory just-bash sandbox. */
async function spiedSandbox() {
  const inner = await bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'spied' })
  const run = vi.fn(inner.run)
  const readTextFile = vi.fn(inner.readTextFile)
  const writeTextFile = vi.fn(inner.writeTextFile)
  const sandbox: Sandbox = { ...inner, run, readTextFile, writeTextFile }
  return { sandbox, run, readTextFile, writeTextFile }
}

describe('write tool', () => {
  it('writes through writeTextFile without an abort signal', async () => {
    const { sandbox, writeTextFile } = await spiedSandbox()
    const controller = new AbortController()

    await createWriteTool(sandbox).execute('call', { path: 'out.txt', content: 'hi' }, controller.signal)

    expect(writeTextFile).toHaveBeenCalledWith({ path: 'out.txt', content: 'hi' })
  })
})

describe('bash tool', () => {
  it('runs the command through run, forwarding the timeout in milliseconds and a signal', async () => {
    const { sandbox, run } = await spiedSandbox()

    const result = await createBashTool(sandbox).execute('call', { command: 'echo hi', timeout: 1.5 })

    expect(textOf(result)).toBe('hi')
    expect(run).toHaveBeenCalledWith({
      command: 'echo hi',
      timeoutMs: 1500,
      abortSignal: expect.any(AbortSignal),
    })
  })
})

const SKILL_ID = 'skill:demo:abc'

function packagedSkills(): Record<string, PackagedSkillDirectory> {
  return {
    demo: {
      id: SKILL_ID,
      name: 'demo',
      description: 'Demo skill.',
      files: {
        'notes.md': { encoding: 'base64', kind: 'text', content: encodeBase64(enc.encode('l1\nl2\nl3\n')) },
        'blob.bin': { encoding: 'base64', kind: 'binary', content: encodeBase64(new Uint8Array([0, 1, 2, 255])) },
      },
    },
  }
}

describe('overlayPackagedSkills', () => {
  const notesPath = formatPackagedSkillFilePath(SKILL_ID, 'notes.md')
  const blobPath = formatPackagedSkillFilePath(SKILL_ID, 'blob.bin')

  it('serves packaged files through readTextFile, applying line ranges', async () => {
    const { sandbox, readTextFile } = await spiedSandbox()
    const overlay = overlayPackagedSkills(sandbox, packagedSkills())

    expect(await overlay.readTextFile({ path: notesPath })).toBe('l1\nl2\nl3\n')
    expect(await overlay.readTextFile({ path: `/.amond/packaged-skills/${SKILL_ID}/notes.md` })).toBe(
      'l1\nl2\nl3\n',
    )
    expect(await overlay.readTextFile({ path: notesPath, startLine: 2, endLine: 2 })).toBe('l2')
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('serves packaged files to the read tool', async () => {
    const { sandbox } = await spiedSandbox()
    const overlay = overlayPackagedSkills(sandbox, packagedSkills())

    const result = await createReadTool(overlay).execute('call', { path: notesPath, offset: 3, limit: 1 })

    expect(textOf(result)).toBe('l3')
  })

  it('serves packaged binary files as raw bytes through readBinaryFile', async () => {
    const { sandbox } = await spiedSandbox()
    const overlay = overlayPackagedSkills(sandbox, packagedSkills())

    expect(await overlay.readBinaryFile({ path: blobPath })).toEqual(new Uint8Array([0, 1, 2, 255]))
    expect(await overlay.readBinaryFile({ path: notesPath })).toEqual(enc.encode('l1\nl2\nl3\n'))
  })

  it('resolves an unknown packaged path to null on both read methods', async () => {
    const { sandbox } = await spiedSandbox()
    const overlay = overlayPackagedSkills(sandbox, packagedSkills())
    const unknown = formatPackagedSkillFilePath(SKILL_ID, 'nope.md')

    expect(await overlay.readTextFile({ path: unknown })).toBeNull()
    expect(await overlay.readBinaryFile({ path: unknown })).toBeNull()
    await expect(createReadTool(overlay).execute('call', { path: unknown })).rejects.toThrow(
      `File not found: ${unknown}`,
    )
  })

  it('delegates paths outside the packaged root to the sandbox', async () => {
    const { sandbox, readTextFile } = await spiedSandbox()
    await sandbox.writeTextFile({ path: 'a.txt', content: 'real' })
    const overlay = overlayPackagedSkills(sandbox, packagedSkills())

    expect(await overlay.readTextFile({ path: 'a.txt' })).toBe('real')
    expect(readTextFile).toHaveBeenCalledWith({ path: 'a.txt' })
    expect(await overlay.readBinaryFile({ path: 'a.txt' })).toEqual(enc.encode('real'))
  })

  it('keeps the sandbox run function, so the grep backend probe runs once across overlays', async () => {
    const { sandbox, run } = await spiedSandbox()
    const first = overlayPackagedSkills(sandbox, packagedSkills())
    const second = overlayPackagedSkills(sandbox, packagedSkills())
    expect(first.run).toBe(sandbox.run)
    expect(second.run).toBe(sandbox.run)

    await createGrepTool(first).execute('call', { pattern: 'x' })
    await createGrepTool(second).execute('call', { pattern: 'x' })

    const probes = run.mock.calls.filter(([options]) => options.command === 'rg --version')
    expect(probes).toEqual([[{ command: 'rg --version', timeoutMs: 10_000 }]])
  })
})
