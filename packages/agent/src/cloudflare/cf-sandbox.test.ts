import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineSandboxContract } from '../__contract__/define-sandbox-contract.ts'
import { fakeStub } from '../__contract__/fake-cloudflare-stub.ts'
import type { CloudflareSandboxStub } from './cf-sandbox.ts'
import { cloudflareSandbox, setContainerDeathCadenceForTests } from './cf-sandbox.ts'

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

/**
 * {@link fakeStub} plus the process API. Each command runs on just-bash when
 * started; its log stream replays the buffered output and the `exit` frame as
 * SSE bytes cut into {@link STREAM_CHUNK_BYTES}-byte chunks. `killProcess`
 * forgets the id, as the real container does.
 */
function fakeProcessStub(cwd: string) {
  const fake = fakeStub(cwd)
  const encoder = new TextEncoder()
  const runs = new Map<string, Promise<{ stdout: string, stderr: string, exitCode: number }>>()
  const killed: string[] = []
  const stub: CloudflareSandboxStub = {
    ...fake.stub,
    async startProcess(command, options) {
      fake.timeouts.push(options?.timeout)
      const id = `proc-${runs.size + 1}`
      runs.set(id, fake.shell.exec(command, { cwd: options?.cwd, env: options?.env }))
      return { id }
    },
    async streamProcessLogs(id) {
      const run = runs.get(id)
      if (!run) { throw new Error(`Process not found: ${id}`) }
      return new ReadableStream<Uint8Array>({
        start(controller) {
          void run.then(({ stdout, stderr, exitCode }) => {
            const events = [
              { type: 'process_info', id },
              ...(stdout ? [{ type: 'stdout', data: stdout }] : []),
              ...(stderr ? [{ type: 'stderr', data: stderr }] : []),
              { type: 'exit', exitCode },
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
    async killProcess(id) {
      killed.push(id)
      runs.delete(id)
    },
  }
  return { ...fake, stub, killed: () => killed }
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

describe('cloudflareSandbox with a process-API stub', () => {
  defineSandboxContract({
    name: 'cloudflareSandbox (process API)',
    caps: { nativeDeadline: true, orphanReporting: false, deathDetection: true },
    async make() {
      const { stub, timeouts, stop } = fakeProcessStub('/workspace')
      const sandbox = await cloudflareSandbox(stub, { cwd: '/workspace' }).createSandbox({ id: 'contract' })
      return { sandbox, nativeTimeouts: () => timeouts, killSandbox: stop }
    },
  })

  it('runs spawn through the process API, not the buffered exec', async () => {
    const fake = fakeProcessStub('/workspace')
    const sandbox = await cloudflareSandbox(fake.stub, { cwd: '/workspace' }).createSandbox({ id: 'route' })

    const proc = await sandbox.spawn({ command: 'echo routed' })
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })

    expect(fake.execCalls()).toBe(0)
  })

  it('stops the started process on kill()', async () => {
    const fake = fakeProcessStub('/workspace')
    const sandbox = await cloudflareSandbox(fake.stub, { cwd: '/workspace' }).createSandbox({ id: 'kill' })

    const proc = await sandbox.spawn({ command: 'sleep 1' })
    await proc.kill()

    expect(fake.killed()).toEqual(['proc-1'])
  })
})
