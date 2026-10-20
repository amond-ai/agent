import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { vi } from 'vitest'
import { defineSandboxContract } from '../__contract__/define-sandbox-contract.ts'
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
