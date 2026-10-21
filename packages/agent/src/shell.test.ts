import { Bash } from 'just-bash'
import { describe, expect, it, vi } from 'vitest'
import { bash } from './sandbox.ts'
import { execShellWithEvents } from './shell.ts'
import type { Sandbox } from './types.ts'

async function spiedSandbox() {
  const inner = await bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'shell' })
  const run = vi.fn(inner.run)
  const sandbox: Sandbox = { ...inner, run }
  return { sandbox, run }
}

describe('execShellWithEvents', () => {
  it('runs through run, forwarding env, cwd, timeoutMs, and the signal, and returns the ShellResult', async () => {
    const { sandbox, run } = await spiedSandbox()
    await sandbox.mkdir('sub')
    const controller = new AbortController()
    const emit = vi.fn()

    const result = await execShellWithEvents(
      sandbox,
      emit,
      'echo "$GREETING" && pwd',
      { env: { GREETING: 'hi' }, cwd: 'sub', timeoutMs: 1500.4 },
      controller.signal,
      {},
    )

    expect(result).toEqual({ stdout: 'hi\n/work/sub\n', stderr: '', exitCode: 0 })
    expect(run).toHaveBeenCalledWith({
      command: 'echo "$GREETING" && pwd',
      env: { GREETING: 'hi' },
      workingDirectory: 'sub',
      timeoutMs: 1500.4,
      abortSignal: controller.signal,
    })
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'tool', toolName: 'bash', isError: false }),
      { origin: 'caller' },
    )
  })

  it('emits an error result and rethrows when run rejects', async () => {
    const { sandbox, run } = await spiedSandbox()
    const failure = new Error('sandbox gone')
    run.mockRejectedValueOnce(failure)
    const emit = vi.fn()

    await expect(execShellWithEvents(sandbox, emit, 'true', undefined, undefined, {})).rejects.toBe(failure)
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'tool',
        isError: true,
        result: { content: [{ type: 'text', text: 'sandbox gone' }], details: { command: 'true', exitCode: -1 } },
      }),
      expect.objectContaining({ origin: 'caller' }),
    )
  })
})
