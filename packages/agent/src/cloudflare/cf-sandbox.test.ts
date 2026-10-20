import { Bash } from 'just-bash'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

/** Bytes are handed out in chunks this small, so most SSE frames and lines split across chunks. */
const STREAM_CHUNK_BYTES = 7

/**
 * {@link fakeStub} plus a streaming exec. just-bash runs each command to
 * completion, so the events arrive together at the end; the stream then
 * delivers them as SSE bytes cut into {@link STREAM_CHUNK_BYTES}-byte chunks.
 * Liveness itself is asserted in `cf-spawn.test.ts` with a hand-driven stream.
 */
function fakeStreamingStub(cwd: string) {
  const fake = fakeStub(cwd)
  const encoder = new TextEncoder()
  let streamCalls = 0
  const stub: CloudflareSandboxStub = {
    ...fake.stub,
    async execStream(command, options) {
      streamCalls += 1
      fake.timeouts.push(options?.timeout)
      return new ReadableStream<Uint8Array>({
        start(controller) {
          void fake.shell.exec(command, { cwd: options?.cwd, env: options?.env }).then(({ stdout, stderr, exitCode }) => {
            const events = [
              { type: 'start' },
              ...(stdout ? [{ type: 'stdout', data: stdout }] : []),
              ...(stderr ? [{ type: 'stderr', data: stderr }] : []),
              { type: 'complete', exitCode },
            ]
            const bytes = encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
            try {
              for (let offset = 0; offset < bytes.byteLength; offset += STREAM_CHUNK_BYTES) {
                controller.enqueue(bytes.slice(offset, offset + STREAM_CHUNK_BYTES))
              }
              controller.close()
            }
            catch {
              /* the reader cancelled the stream */
            }
          })
        },
      })
    },
  }
  return { ...fake, stub, streamCalls: () => streamCalls }
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

describe('cloudflareSandbox with a streaming stub', () => {
  defineSandboxContract({
    name: 'cloudflareSandbox (execStream)',
    caps: { nativeDeadline: true, orphanReporting: false, deathDetection: true },
    async make() {
      const { stub, timeouts, stop } = fakeStreamingStub('/workspace')
      const sandbox = await cloudflareSandbox(stub, { cwd: '/workspace' }).createSandbox({ id: 'contract' })
      return { sandbox, nativeTimeouts: () => timeouts, killSandbox: stop }
    },
  })

  it('runs spawn through execStream, not the buffered exec', async () => {
    const fake = fakeStreamingStub('/workspace')
    const sandbox = await cloudflareSandbox(fake.stub, { cwd: '/workspace' }).createSandbox({ id: 'route' })

    const proc = await sandbox.spawn({ command: 'echo routed' })
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })

    expect(fake.streamCalls()).toBe(1)
    expect(fake.execCalls()).toBe(0)
  })

  it('keeps spawn buffered on a stub without execStream', async () => {
    const fake = fakeStub('/workspace')
    const sandbox = await cloudflareSandbox(fake.stub, { cwd: '/workspace' }).createSandbox({ id: 'buffered' })

    const proc = await sandbox.spawn({ command: 'echo buffered' })
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })

    expect(fake.execCalls()).toBe(1)
  })
})
