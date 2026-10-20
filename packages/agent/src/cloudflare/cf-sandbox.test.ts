import { Bash } from 'just-bash'
import { afterAll, beforeAll } from 'vitest'
import { defineSandboxContract } from '../__contract__/define-sandbox-contract.ts'
import { decodeBase64, encodeBase64 } from '../base64.ts'
import type { CloudflareSandboxStub } from './cf-sandbox.ts'
import { cloudflareSandbox, setContainerDeathCadenceForTests } from './cf-sandbox.ts'

/**
 * In-memory stand-in for a `@cloudflare/sandbox` Durable Object stub: its
 * shell commands (including the `stat`/`find` the adapter issues) run on
 * just-bash over the same in-memory filesystem the file methods use.
 */
function fakeStub(cwd: string) {
  const shell = new Bash({ cwd })
  const fs = shell.fs
  const timeouts: (number | undefined)[] = []
  let status = 'running'
  const stub: CloudflareSandboxStub = {
    async exec(command, options) {
      timeouts.push(options?.timeout)
      const { stdout, stderr, exitCode } = await shell.exec(command, { cwd: options?.cwd, env: options?.env })
      return { success: exitCode === 0, stdout, stderr, exitCode }
    },
    async readFile(path, options) {
      if (options?.encoding === 'base64') { return { content: encodeBase64(await fs.readFileBuffer(path)) } }
      return { content: await fs.readFile(path) }
    },
    async writeFile(path, content, options) {
      await fs.writeFile(path, options?.encoding === 'base64' ? decodeBase64(content) : content)
    },
    exists: async path => ({ exists: await fs.exists(path) }),
    mkdir: async (path, options) => fs.mkdir(path, options),
    deleteFile: async path => fs.rm(path),
    getState: async () => ({ status }),
  }
  return { stub, timeouts, stop: () => { status = 'stopped' } }
}

beforeAll(() => {
  setContainerDeathCadenceForTests({ statePollMs: 5, probeSilenceMs: 200 })
})

afterAll(() => {
  setContainerDeathCadenceForTests()
})

defineSandboxContract({
  name: 'cloudflareSandbox',
  caps: { nativeDeadline: true, orphanReporting: false, deathDetection: true },
  async make() {
    const { stub, timeouts, stop } = fakeStub('/workspace')
    const sandbox = await cloudflareSandbox(stub, { cwd: '/workspace' }).createSandbox({ id: 'contract' })
    return { sandbox, nativeTimeouts: () => timeouts, killSandbox: stop }
  },
})
