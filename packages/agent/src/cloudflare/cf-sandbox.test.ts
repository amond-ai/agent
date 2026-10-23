import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineSandboxContract } from '../__contract__/define-sandbox-contract.ts'
import type { SessionRun } from '../__contract__/fake-cloudflare-stub.ts'
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
          void fake.session(command, { cwd: options?.cwd, env: options?.env }).then((run) => {
            const { stdout, stderr } = run
            const events = [
              { type: 'start' },
              ...(stdout ? [{ type: 'stdout', data: stdout }] : []),
              ...(stderr ? [{ type: 'stderr', data: stderr }] : []),
              // A command that ended the session shell never reaches the completion step.
              ...(run.ended ? [] : [{ type: 'complete', exitCode: run.exitCode }]),
            ]
            const bytes = encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
            try {
              for (let offset = 0; offset < bytes.byteLength; offset += STREAM_CHUNK_BYTES) {
                controller.enqueue(bytes.slice(offset, offset + STREAM_CHUNK_BYTES))
              }
              if (!run.ended) { controller.close() }
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
  const runs = new Map<string, Promise<SessionRun>>()
  const killed: string[] = []
  let started = 0
  const stub: CloudflareSandboxStub = {
    ...fake.stub,
    async startProcess(command, options) {
      fake.timeouts.push(options?.timeout)
      const id = `proc-${++started}`
      runs.set(id, fake.session(command, { cwd: options?.cwd, env: options?.env }))
      return { id }
    },
    async streamProcessLogs(id) {
      const run = runs.get(id)
      if (!run) { throw new Error(`Process not found: ${id}`) }
      return new ReadableStream<Uint8Array>({
        start(controller) {
          void run.then((result) => {
            const { stdout, stderr } = result
            const events = [
              { type: 'process_info', id },
              ...(stdout ? [{ type: 'stdout', data: stdout }] : []),
              ...(stderr ? [{ type: 'stderr', data: stderr }] : []),
              // A command that ended the session shell never reaches the completion step.
              ...(result.ended ? [] : [{ type: 'exit', exitCode: result.exitCode }]),
            ]
            const bytes = encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
            try {
              for (let offset = 0; offset < bytes.byteLength; offset += STREAM_CHUNK_BYTES) {
                controller.enqueue(bytes.slice(offset, offset + STREAM_CHUNK_BYTES))
              }
              if (!result.ended) { controller.close() }
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

/** Each stub shape, over the same model of the SDK's session shell. */
const SHAPES = [
  { name: 'buffered', make: () => fakeStub('/workspace') },
  { name: 'execStream', make: () => fakeStreamingStub('/workspace') },
  { name: 'process API', make: () => fakeProcessStub('/workspace') },
] as const

/** Fail instead of hanging when a settle never comes (a stream the session left open). */
function within<T>(promise: PromiseLike<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no result within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * {@link fakeStub} with a persistent session shell: every exec first replays the
 * commands received before it (output discarded), so whatever a bare command
 * changes in the shell (`export`, `cd`) is still in effect for the next one.
 */
function persistentSessionStub(cwd: string) {
  const fake = fakeStub(cwd)
  const received: string[] = []
  const stub: CloudflareSandboxStub = {
    ...fake.stub,
    async exec(command, options) {
      const replay = received.map(prior => `{ ${prior}\n} >/dev/null 2>&1\n`).join('')
      received.push(command)
      return fake.stub.exec(`${replay}${command}`, options)
    },
  }
  return { stub }
}

/**
 * {@link fakeStub} where a top-level `exec` replaces the session shell: a command
 * that is not inside a subshell and runs `exec` never reaches the completion
 * step, so `exec` rejects as the SDK does with `SessionTerminatedError`.
 */
function execReplacesShellStub(cwd: string) {
  const fake = fakeStub(cwd)
  const stub: CloudflareSandboxStub = {
    ...fake.stub,
    async exec(command, options) {
      if (!command.trimStart().startsWith('(') && /(?:^|[;&|\n])\s*exec\s/.test(command)) {
        throw new Error('SessionTerminatedError: Session \'default\' shell exited (exit code: 5)')
      }
      return fake.stub.exec(command, options)
    },
  }
  return { stub }
}

describe('cloudflareSandbox with an exec that replaces the session shell (AC-009)', () => {
  it('reports the exit code of an exec-ed program only when the command ran in a subshell', async () => {
    const sandbox = await cloudflareSandbox(execReplacesShellStub('/workspace').stub, { cwd: '/workspace' }).createSandbox({ id: 'exec-replaces' })
    await expect(within(sandbox.run({ command: `exec sh -c 'exit 5'` }))).resolves.toMatchObject({ exitCode: 5 })
  })
})

describe('cloudflareSandbox isolation on a persistent session shell (AC-013)', () => {
  async function open() {
    return cloudflareSandbox(persistentSessionStub('/workspace').stub, { cwd: '/workspace' }).createSandbox({ id: 'persistent' })
  }

  it('does not carry an export into the next run', async () => {
    const sandbox = await open()
    await within(sandbox.run({ command: 'export Z=1' }))
    await expect(within(sandbox.run({ command: 'echo "[$Z]"' }))).resolves.toMatchObject({ stdout: '[]\n' })
  })

  it('does not carry a cd into the next run', async () => {
    const sandbox = await open()
    await within(sandbox.run({ command: 'mkdir -p sub && cd sub' }))
    await expect(within(sandbox.run({ command: 'pwd' }))).resolves.toMatchObject({ stdout: '/workspace\n' })
  })
})

describe.each(SHAPES)('cloudflareSandbox commands run in their own shell scope ($name)', ({ make }) => {
  async function open() {
    const fake = make()
    const sandbox = await cloudflareSandbox(fake.stub, { cwd: '/workspace' }).createSandbox({ id: 'scope' })
    return { fake, sandbox }
  }

  it('reports the exit code and output of a bare exit from run (AC-001)', async () => {
    const { sandbox } = await open()
    await expect(within(sandbox.run({ command: 'echo before; exit 3' }))).resolves.toMatchObject({ exitCode: 3, stdout: 'before\n' })
  })

  it('reports the exit code and output of a bare exit from spawn without timeoutMs (AC-002..004)', async () => {
    const { sandbox } = await open()
    const proc = await sandbox.spawn({ command: 'echo before; exit 3' })
    const stdout = new Response(proc.stdout).text()
    await expect(within(proc.wait())).resolves.toEqual({ exitCode: 3 })
    await expect(within(stdout)).resolves.toBe('before\n')
  })

  it('runs the next command after a bare exit (AC-005)', async () => {
    const { sandbox } = await open()
    await within(sandbox.run({ command: 'exit 3' }))
    await expect(within(sandbox.run({ command: 'echo next; exit 4' }))).resolves.toMatchObject({ exitCode: 4, stdout: 'next\n' })
  })

  it('reports a syntax error as an exit status with the error on stderr (AC-006)', async () => {
    const { sandbox } = await open()
    // Real bash reports 2 for a syntax error inside `eval`; just-bash reports 1.
    const result = await within(sandbox.run({ command: 'echo (' }))
    expect(result.exitCode).toBeGreaterThan(0)
    expect(result.stderr).toMatch(/syntax error/)
  })

  it.each(['', '   ', '# only a comment'])('exits 0 for the empty or comment-only command %j (AC-007)', async (command) => {
    const { sandbox } = await open()
    await expect(within(sandbox.run({ command }))).resolves.toMatchObject({ exitCode: 0 })
    const proc = await sandbox.spawn({ command })
    await expect(within(proc.wait())).resolves.toEqual({ exitCode: 0 })
  })

  it('stops at the first failing step under set -e (AC-008)', async () => {
    const { sandbox } = await open()
    await expect(within(sandbox.run({ command: 'set -e; false; echo x' }))).resolves.toMatchObject({ exitCode: 1, stdout: '' })
  })

  it('reports the exit code of an exec-ed program (AC-009)', async () => {
    const { sandbox } = await open()
    await expect(within(sandbox.run({ command: `exec sh -c 'exit 5'` }))).resolves.toMatchObject({ exitCode: 5 })
  })

  it('delivers env and a non-default working directory (AC-010)', async () => {
    const { fake, sandbox } = await open()
    await fake.shell.fs.mkdir('/workspace/sub', { recursive: true })
    const result = await within(sandbox.run({ command: 'echo "$NAME"; pwd', env: { NAME: 'v' }, workingDirectory: 'sub' }))
    expect(result).toMatchObject({ exitCode: 0, stdout: 'v\n/workspace/sub\n' })
  })

  it('runs a command with single quotes unchanged (AC-011)', async () => {
    const { sandbox } = await open()
    await expect(within(sandbox.run({ command: `printf '%s\\n' 'it'"'"'s'` }))).resolves.toMatchObject({ exitCode: 0, stdout: `it's\n` })
  })

  it('does not carry an export into the next command (AC-013)', async () => {
    const { sandbox } = await open()
    await within(sandbox.run({ command: 'export Z=1' }))
    await expect(within(sandbox.run({ command: 'echo "[$Z]"' }))).resolves.toMatchObject({ stdout: '[]\n' })
  })

  it('reports the exit status after an EXIT trap command (AC-014; just-bash has no trap, so `bye` is only checked on a real container)', async () => {
    const { sandbox } = await open()
    await expect(within(sandbox.run({ command: `trap 'echo bye' EXIT; exit 2` }))).resolves.toMatchObject({ exitCode: 2 })
  })

  it('exits nonzero for an unbalanced quote instead of hanging (AC-015)', async () => {
    const { sandbox } = await open()
    const result = await within(sandbox.run({ command: 'echo "abc' }))
    expect(result.exitCode).toBeGreaterThan(0)
    const proc = await sandbox.spawn({ command: 'echo "abc' })
    expect((await within(proc.wait())).exitCode).toBeGreaterThan(0)
  })

  it.each([
    ['a CRLF line ending', 'echo a\r'],
    ['a trailing backslash', 'echo a \\'],
    ['a command starting with a dash', '-x'],
  ])('gives %s the result it has outside the wrapper', async (_label, command) => {
    const { fake, sandbox } = await open()
    const direct = await fake.shell.exec(command)
    const result = await within(sandbox.run({ command }))
    expect(result.stdout).toBe(direct.stdout)
    expect(result.exitCode).toBe(direct.exitCode)
  })

  it('does not name the wrapper in the abort error of a hung command', async () => {
    const received: string[] = []
    const hung: CloudflareSandboxStub = {
      ...make().stub,
      exec: (command) => {
        received.push(command)
        return new Promise(() => {})
      },
    }
    const sandbox = await cloudflareSandbox(hung, { cwd: '/workspace' }).createSandbox({ id: 'abort' })
    const controller = new AbortController()
    const pending = sandbox.run({ command: 'sleep 99', abortSignal: controller.signal })
    controller.abort()
    const error = await within(pending).catch((e: unknown) => e)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatch(/^\( eval /)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(String(error)).not.toMatch(/eval/)
  })
})
