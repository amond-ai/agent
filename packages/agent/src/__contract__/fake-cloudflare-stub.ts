import { Bash } from 'just-bash'
import { decodeBase64, encodeBase64 } from '../base64.ts'
import type { CloudflareSandboxStub } from '../cloudflare/cf-sandbox.ts'

/** What the model of the SDK's session shell prints after each command. */
const SESSION_DONE_MARKER = '__AMOND_SESSION_DONE__'

/**
 * How one command ran in the modeled session shell: it either reached the
 * SDK's completion step (`ended: false`) or ended the shell before it.
 */
export type SessionRun =
  | { ended: false, stdout: string, stderr: string, exitCode: number }
  | { ended: true, stdout: string, stderr: string, shellExit: number }

/**
 * In-memory stand-in for a `@cloudflare/sandbox` Durable Object stub: its
 * shell commands (including the `stat`/`find` the adapter issues) run on
 * just-bash over the same in-memory filesystem the file methods use.
 *
 * Commands run the way the SDK's default session runs them: in one shell,
 * followed by a completion step that reports `$?`. A command that ends the
 * shell (a bare `exit`, a failing `set -e` step) skips that step, so `exec`
 * rejects as the SDK does with `SessionTerminatedError`; {@link session}
 * exposes the same outcome to the streaming stubs, whose streams then stay
 * open after the last output.
 */
export function fakeStub(cwd: string) {
  const shell = new Bash({ cwd })
  const fs = shell.fs
  const timeouts: (number | undefined)[] = []
  let status = 'running'
  let execCalls = 0
  async function session(command: string, options?: { cwd?: string, env?: Record<string, string> }): Promise<SessionRun> {
    const result = await shell.exec(`${command}\nprintf '${SESSION_DONE_MARKER}%s' "$?"`, { cwd: options?.cwd, env: options?.env })
    const at = result.stdout.lastIndexOf(SESSION_DONE_MARKER)
    if (at < 0) { return { ended: true, stdout: result.stdout, stderr: result.stderr, shellExit: result.exitCode } }
    return {
      ended: false,
      stdout: result.stdout.slice(0, at),
      stderr: result.stderr,
      exitCode: Number(result.stdout.slice(at + SESSION_DONE_MARKER.length)),
    }
  }
  const stub: CloudflareSandboxStub = {
    async exec(command, options) {
      execCalls += 1
      timeouts.push(options?.timeout)
      const run = await session(command, options)
      if (run.ended) { throw new Error(`SessionTerminatedError: Session 'default' shell exited (exit code: ${run.shellExit})`) }
      return { success: run.exitCode === 0, stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode }
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
  return { stub, shell, session, timeouts, execCalls: () => execCalls, stop: () => { status = 'stopped' } }
}
