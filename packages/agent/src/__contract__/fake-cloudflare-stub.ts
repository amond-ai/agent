import { Bash } from 'just-bash'
import { decodeBase64, encodeBase64 } from '../base64.ts'
import type { CloudflareSandboxStub } from '../cloudflare/cf-sandbox.ts'

/**
 * In-memory stand-in for a `@cloudflare/sandbox` Durable Object stub: its
 * shell commands (including the `stat`/`find` the adapter issues) run on
 * just-bash over the same in-memory filesystem the file methods use.
 */
export function fakeStub(cwd: string) {
  const shell = new Bash({ cwd })
  const fs = shell.fs
  const timeouts: (number | undefined)[] = []
  let status = 'running'
  let execCalls = 0
  const stub: CloudflareSandboxStub = {
    async exec(command, options) {
      execCalls += 1
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
  return { stub, shell, timeouts, execCalls: () => execCalls, stop: () => { status = 'stopped' } }
}
