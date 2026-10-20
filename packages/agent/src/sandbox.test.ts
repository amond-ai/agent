import { Bash } from 'just-bash'
import { describe, expect, it, vi } from 'vitest'
import { defineSandboxContract } from './__contract__/define-sandbox-contract.ts'
import type { OrphanedExecSettlement, SandboxDriver } from './sandbox.ts'
import { bash, sandboxFromDriver } from './sandbox.ts'

/**
 * A signal-blind in-memory driver over just-bash, the way most provider SDKs
 * behave: `exec` ignores `signal`, so an aborted command keeps running and
 * settles later as an orphan.
 */
function justBashDriver(shell: Bash) {
  const fs = shell.fs
  const timeouts: (number | undefined)[] = []
  const driver: SandboxDriver = {
    readFile: path => fs.readFile(path),
    readFileBuffer: path => fs.readFileBuffer(path),
    writeFile: (path, content) => fs.writeFile(path, content),
    stat: path => fs.stat(path),
    readdir: path => fs.readdir(path),
    exists: path => fs.exists(path),
    mkdir: (path, options) => fs.mkdir(path, options),
    rm: (path, options) => fs.rm(path, options),
    async exec(command, options) {
      timeouts.push(options?.timeoutMs)
      const { stdout, stderr, exitCode } = await shell.exec(command, { cwd: options?.cwd, env: options?.env })
      return { stdout, stderr, exitCode }
    },
  }
  return { driver, timeouts }
}

defineSandboxContract({
  name: 'bash()',
  caps: { nativeDeadline: true, orphanReporting: false, deathDetection: false },
  async make() {
    // just-bash has no native timeout; `timeoutMs` becomes an `AbortSignal.timeout`.
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const sandbox = await bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'contract' })
    return {
      sandbox,
      nativeTimeouts: () => timeoutSpy.mock.calls.map(([ms]) => ms),
      cleanup: () => timeoutSpy.mockRestore(),
    }
  },
})

defineSandboxContract({
  name: 'sandboxFromDriver',
  caps: { nativeDeadline: true, orphanReporting: true, deathDetection: false },
  async make() {
    const { driver, timeouts } = justBashDriver(new Bash({ cwd: '/work' }))
    const settlements: OrphanedExecSettlement[] = []
    const sandbox = sandboxFromDriver(driver, '/work', { onOrphanSettled: s => settlements.push(s) })
    return { sandbox, nativeTimeouts: () => timeouts, orphanSettlements: () => settlements }
  },
})

describe('sandboxFromDriver', () => {
  it('rethrows the original read error when exists() also fails', async () => {
    const readError = new Error('transport down')
    const { driver } = justBashDriver(new Bash({ cwd: '/work' }))
    const sandbox = sandboxFromDriver({
      ...driver,
      readFile: async () => { throw readError },
      readFileBuffer: async () => { throw readError },
      exists: async () => { throw new Error('exists failed too') },
    }, '/work')

    await expect(sandbox.readTextFile({ path: 'a.txt' })).rejects.toBe(readError)
    await expect(sandbox.readBinaryFile({ path: 'a.txt' })).rejects.toBe(readError)
  })

  it('takes a custom description', () => {
    const { driver } = justBashDriver(new Bash({ cwd: '/work' }))

    expect(sandboxFromDriver(driver, '/work', { description: 'My box at /work.' }).description).toBe(
      'My box at /work.',
    )
  })

  it('reports a killed spawn as an orphan and rejects wait() with the orphan notice', async () => {
    const { driver } = justBashDriver(new Bash({ cwd: '/work' }))
    const settlements: OrphanedExecSettlement[] = []
    const sandbox = sandboxFromDriver(driver, '/work', { onOrphanSettled: s => settlements.push(s) })

    const proc = await sandbox.spawn({ command: 'sleep 0.1; echo late' })
    await proc.kill()

    await expect(proc.wait()).rejects.toMatchObject({
      name: 'AbortError',
      message: expect.stringContaining('may still be running'),
    })
    await expect.poll(() => settlements.length, { timeout: 2000 }).toBe(1)
    expect(settlements[0]).toMatchObject({ command: 'sleep 0.1; echo late', result: { stdout: 'late\n' } })
  })
})
