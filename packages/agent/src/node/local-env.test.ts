import { existsSync, readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineSandboxContract } from '../__contract__/define-sandbox-contract.ts'
import type { Sandbox } from '../types.ts'
import { createLocalSandbox } from './local-env.ts'
import { local } from './local.ts'

defineSandboxContract({
  name: 'local()',
  caps: { nativeDeadline: true, orphanReporting: false, deathDetection: false },
  async make() {
    // realpath: the shell's `pwd` reports the resolved directory.
    const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'amond-local-contract-')))
    // `timeoutMs` becomes an `AbortSignal.timeout` that kills the process group.
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const sandbox = await local({ cwd }).createSandbox({ id: 'contract' })
    return {
      sandbox,
      nativeTimeouts: () => timeoutSpy.mock.calls.map(([ms]) => ms),
      cleanup: async () => {
        timeoutSpy.mockRestore()
        await fs.rm(cwd, { recursive: true, force: true })
      },
    }
  },
})

describe('local() live spawn and run', () => {
  let cwd: string
  let sandbox: Sandbox

  beforeEach(async () => {
    cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'amond-local-live-')))
    sandbox = await local({ cwd }).createSandbox({ id: 'live' })
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  const decoder = new TextDecoder()
  const pidAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    }
    catch {
      return false
    }
  }
  const waitUntil = async (condition: () => boolean, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (condition()) { return true }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return condition()
  }

  it('delivers the first chunk before the command exits (AC-010)', async () => {
    const proc = await sandbox.spawn({ command: 'echo first; sleep 1; echo second' })
    let exited = false
    void proc.wait().then(() => { exited = true }, () => { exited = true })

    const reader = proc.stdout.getReader()
    const first = await reader.read()

    expect(decoder.decode(first.value)).toBe('first\n')
    // Still running: a buffered spawn could only have produced this chunk after exit.
    expect(exited).toBe(false)

    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { break }
      rest += decoder.decode(value)
    }
    expect(rest).toBe('second\n')
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
  })

  it('kill() ends the whole process group', async () => {
    const pidFile = path.join(cwd, 'bg.pid')
    const proc = await sandbox.spawn({ command: 'sleep 30 & echo $! > bg.pid; sleep 30; wait' })
    const written = (): boolean => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== ''
    expect(await waitUntil(written, 2000)).toBe(true)
    const bgPid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(pidAlive(bgPid)).toBe(true)

    await proc.kill()
    const settled = await Promise.race([
      proc.wait().then(() => 'settled', () => 'settled'),
      new Promise<string>(resolve => setTimeout(() => resolve('pending'), 1500)),
    ])

    expect(settled).toBe('settled')
    expect(await waitUntil(() => !pidAlive(bgPid), 1500)).toBe(true)
  })

  it('resolves wait() with 124 on a timeout alone and rejects on a caller abort', async () => {
    const timedOut = await sandbox.spawn({ command: 'sleep 5', timeoutMs: 100 })
    await expect(timedOut.wait()).resolves.toEqual({ exitCode: 124 })

    const controller = new AbortController()
    const aborted = await sandbox.spawn({ command: 'sleep 5', abortSignal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(aborted.wait()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects wait() promptly on abort even when the command ignores SIGTERM', async () => {
    const controller = new AbortController()
    const proc = await sandbox.spawn({
      command: `trap '' TERM; echo ready; sleep 10`,
      abortSignal: controller.signal,
    })
    const reader = proc.stdout.getReader()
    let seen = ''
    while (!seen.includes('ready')) {
      const { done, value } = await reader.read()
      if (done) { break }
      seen += decoder.decode(value)
    }

    const start = Date.now()
    controller.abort()
    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('run() keeps its output and exit codes, with 124 on timeout', async () => {
    await expect(sandbox.run({ command: 'printf "é"; echo err >&2; exit 3' })).resolves.toEqual({
      stdout: 'é',
      stderr: 'err\n',
      exitCode: 3,
    })
    await expect(sandbox.run({ command: 'sleep 5', timeoutMs: 100 })).resolves.toMatchObject({ exitCode: 124 })
  })

  it('run() settles with the overflow result when a SIGTERM-ignoring producer exceeds the cap', async () => {
    const result = await sandbox.run({ command: `trap '' TERM; yes` })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('output exceeded')
  }, 20_000)

  it('spawn() does not cap lifetime output while the caller keeps reading', async () => {
    const small = createLocalSandbox({ cwd }, { maxBufferedBytes: 4096 })
    const proc = await small.spawn!({ command: 'for i in $(seq 1 100); do printf "%0100d\\n" 0; sleep 0.01; done' })
    const reader = proc.stdout.getReader()
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { break }
      total += value.byteLength
    }

    expect(total).toBe(100 * 101)
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
  })

  it('run() decodes a multibyte character split across chunks', async () => {
    const result = await sandbox.run({ command: 'printf "\\xe2\\x82"; sleep 0.2; printf "\\xac"' })

    expect(result.stdout).toBe('€')
  })
})
