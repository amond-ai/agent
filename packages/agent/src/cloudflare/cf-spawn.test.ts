import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SandboxDiedError } from '../errors.ts'
import type { Sandbox } from '../types.ts'
import type { CloudflareSandboxStub } from './cf-sandbox.ts'
import { cloudflareSandbox, setContainerDeathCadenceForTests } from './cf-sandbox.ts'
import type { ExecStreamEvent } from './cf-spawn.ts'
import { createExecStreamParser } from './cf-spawn.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** One SSE frame carrying `event` as JSON. */
function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function parseChunks(chunks: string[]): ExecStreamEvent[] {
  const parser = createExecStreamParser()
  return [...chunks.flatMap(chunk => parser.push(encoder.encode(chunk))), ...parser.end()]
}

type Outcome = { status: 'resolved', value: unknown } | { status: 'rejected', error: unknown } | { status: 'pending' }

async function settleWithin(promise: PromiseLike<unknown>, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending' }), ms)
  })
  try {
    return await Promise.race([
      Promise.resolve(promise).then(
        (value): Outcome => ({ status: 'resolved', value }),
        (error: unknown): Outcome => ({ status: 'rejected', error }),
      ),
      pending,
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

describe('createExecStreamParser', () => {
  it('parses a frame split across two chunks into exactly one event', () => {
    const whole = frame({ type: 'stdout', data: 'hello' })
    const cut = 9

    expect(parseChunks([whole.slice(0, cut), whole.slice(cut)])).toEqual([{ type: 'stdout', data: 'hello' }])
  })

  it('parses every split point of a two-frame stream the same way', () => {
    const text = frame({ type: 'stdout', data: 'a' }) + frame({ type: 'complete', exitCode: 2 })
    const expected = [{ type: 'stdout', data: 'a' }, { type: 'complete', exitCode: 2 }]

    for (let cut = 0; cut <= text.length; cut++) {
      expect(parseChunks([text.slice(0, cut), text.slice(cut)])).toEqual(expected)
    }
  })

  it('reassembles a multi-byte character split between chunks', () => {
    const bytes = encoder.encode(frame({ type: 'stdout', data: 'café ✓' }))
    const parser = createExecStreamParser()
    const accent = bytes.indexOf(0xC3)

    const events = [...parser.push(bytes.slice(0, accent + 1)), ...parser.push(bytes.slice(accent + 1)), ...parser.end()]

    expect(events).toEqual([{ type: 'stdout', data: 'café ✓' }])
  })

  it('accepts CRLF line endings, including a CRLF split across chunks', () => {
    const text = `data: ${JSON.stringify({ type: 'stderr', data: 'x' })}\r\n\r\n`

    expect(parseChunks([text.slice(0, -3), text.slice(-3)])).toEqual([{ type: 'stderr', data: 'x' }])
  })

  it('ignores comments, other fields, and unknown event types', () => {
    const events = parseChunks([
      ': keep-alive\n\n',
      'event: message\nid: 7\n',
      frame({ type: 'progress', percent: 50 }),
      frame({ type: 'stdout', data: 'kept' }),
    ])

    expect(events).toEqual([{ type: 'stdout', data: 'kept' }])
  })

  it('joins a frame\'s data lines with a newline', () => {
    expect(parseChunks(['data: {"type":"stdout",\ndata: "data":"joined"}\n\n'])).toEqual([
      { type: 'stdout', data: 'joined' },
    ])
  })

  it('dispatches a final frame that lacks its blank line at end of input', () => {
    expect(parseChunks([`data: ${JSON.stringify({ type: 'complete', exitCode: 0 })}`])).toEqual([
      { type: 'complete', exitCode: 0 },
    ])
  })

  it('reads the exit event\'s code, or leaves it undefined when absent', () => {
    expect(parseChunks([frame({ type: 'exit', exitCode: 5 }), frame({ type: 'exit' })])).toEqual([
      { type: 'exit', exitCode: 5 },
      { type: 'exit', exitCode: undefined },
    ])
  })

  it('reads the error event\'s message', () => {
    expect(parseChunks([frame({ type: 'error', error: 'boom' })])).toEqual([{ type: 'error', error: 'boom' }])
  })

  it('parses a ~1 MiB frame pushed in small chunks without rescanning the partial line', () => {
    const data = 'x'.repeat(1024 * 1024)
    const text = frame({ type: 'stdout', data })
    const chunks: string[] = []
    for (let at = 0; at < text.length; at += 64) { chunks.push(text.slice(at, at + 64)) }

    const started = performance.now()
    const events = parseChunks(chunks)
    const elapsed = performance.now() - started

    expect(events).toEqual([{ type: 'stdout', data }])
    expect(elapsed).toBeLessThan(500)
  })

  it('throws on a data payload that is not JSON', () => {
    expect(() => parseChunks(['data: not json\n\n'])).toThrow(/not JSON/)
  })
})

/**
 * A stub whose `execStream` hands the test the stream controller, so the test
 * decides when each byte arrives. Its buffered `exec` never settles, so a
 * `spawn` that fell back to buffered output would deliver nothing.
 */
function drivenStub() {
  let status = 'running'
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  let cancelled: unknown = 'not cancelled'
  const calls: { command: string, options?: { cwd?: string, env?: Record<string, string>, timeout?: number } }[] = []
  const neverSettles = () => new Promise<never>(() => {})
  const stub: CloudflareSandboxStub = {
    exec: neverSettles,
    readFile: neverSettles,
    writeFile: neverSettles,
    exists: neverSettles,
    mkdir: neverSettles,
    deleteFile: neverSettles,
    getState: async () => ({ status }),
    async execStream(command, options) {
      calls.push({ command, options })
      return new ReadableStream<Uint8Array>({
        start: (controller) => { stream = controller },
        cancel: (reason) => { cancelled = reason },
      })
    },
  }
  const send = (text: string): void => stream!.enqueue(encoder.encode(text))
  return {
    stub,
    calls,
    send,
    end: () => stream!.close(),
    stop: () => { status = 'stopped' },
    cancelled: () => cancelled,
  }
}

async function spawnOn(stub: CloudflareSandboxStub, options: Parameters<Sandbox['spawn']>[0]) {
  const sandbox = await cloudflareSandbox(stub, { cwd: '/workspace' }).createSandbox({ id: 'live' })
  return sandbox.spawn(options)
}

describe('cloudflareSandbox live spawn', () => {
  beforeAll(() => {
    setContainerDeathCadenceForTests({ statePollMs: 5, probeSilenceMs: 200 })
  })

  afterAll(() => {
    setContainerDeathCadenceForTests()
  })

  it('delivers output before the command completes', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'build' })
    const stdout = proc.stdout.getReader()

    driven.send(frame({ type: 'start' }) + frame({ type: 'stdout', data: 'first\n' }))

    const first = await stdout.read()
    expect(decoder.decode(first.value)).toBe('first\n')
    expect((await settleWithin(proc.wait(), 30)).status).toBe('pending')

    const done = frame({ type: 'complete', exitCode: 0 })
    driven.send(done.slice(0, 12))
    driven.send(done.slice(12))
    driven.end()

    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
    expect(await stdout.read()).toEqual({ done: true, value: undefined })
  })

  it('delivers each event once when its frame arrives split across two chunks', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'split' })
    const stdout = proc.stdout.getReader()

    const split = frame({ type: 'stdout', data: 'whole' })
    driven.send(split.slice(0, 10))
    const firstRead = stdout.read()
    expect((await settleWithin(firstRead, 30)).status).toBe('pending')
    driven.send(split.slice(10) + frame({ type: 'complete', exitCode: 0 }))
    driven.end()

    const chunks: string[] = []
    for (let next = await firstRead; !next.done; next = await stdout.read()) {
      chunks.push(decoder.decode(next.value))
    }
    expect(chunks).toEqual(['whole'])
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
  })

  it('separates stderr from stdout and reports a non-zero exit code', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'fail' })

    driven.send(frame({ type: 'stderr', data: 'oops\n' }) + frame({ type: 'stdout', data: 'out\n' }))
    driven.send(frame({ type: 'complete', exitCode: 3 }))
    driven.end()

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect(stdout).toBe('out\n')
    expect(stderr).toBe('oops\n')
    await expect(proc.wait()).resolves.toEqual({ exitCode: 3 })
  })

  it('passes the resolved working directory, env, and rounded-up timeout to execStream', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'pwd', workingDirectory: 'sub', env: { A: '1' }, timeoutMs: 1500.4 })

    expect(driven.calls).toEqual([{ command: '( eval \' pwd\' )', options: { cwd: '/workspace/sub', env: { A: '1' }, timeout: 1501 } }])

    driven.send(frame({ type: 'complete', exitCode: 0 }))
    driven.end()
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
  })

  it('rejects wait() with SandboxDiedError and errors the streams when the container dies', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'long' })
    const stdout = proc.stdout.getReader()
    driven.send(frame({ type: 'stdout', data: 'partial' }))
    expect(decoder.decode((await stdout.read()).value)).toBe('partial')

    driven.stop()

    const outcome = await settleWithin(proc.wait(), 500)
    expect(outcome.status).toBe('rejected')
    expect((outcome as { error: unknown }).error).toBeInstanceOf(SandboxDiedError)
    await expect(stdout.read()).rejects.toBeInstanceOf(SandboxDiedError)
    await expect(new Response(proc.stderr).text()).rejects.toBeInstanceOf(SandboxDiedError)
  })

  it('rejects wait() with the message of an error event', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'x' })

    driven.send(frame({ type: 'error', error: 'command not found' }))

    await expect(proc.wait()).rejects.toThrow('command not found')
  })

  it('rejects wait() when the stream ends without a complete event', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'x' })

    driven.send(frame({ type: 'stdout', data: 'cut off' }))
    driven.end()

    await expect(proc.wait()).rejects.toThrow(/ended before the command completed/)
  })

  it('cancels the event stream and rejects wait() with an orphan AbortError on kill()', async () => {
    const driven = drivenStub()
    const proc = await spawnOn(driven.stub, { command: 'long' })
    driven.send(frame({ type: 'stdout', data: 'started' }))

    await proc.kill()

    const outcome = await settleWithin(proc.wait(), 500)
    expect(outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } })
    expect((outcome as { error: Error }).error.message).toMatch(/could not be confirmed cancelled and may still be running/)
    expect(driven.cancelled()).not.toBe('not cancelled')
  })

  it('cancels the event stream on a caller abort', async () => {
    const driven = drivenStub()
    const caller = new AbortController()
    const proc = await spawnOn(driven.stub, { command: 'long', abortSignal: caller.signal })

    caller.abort(new Error('stop now'))

    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('stop now') })
    expect(driven.cancelled()).not.toBe('not cancelled')
  })

  it('cancels a stream that arrives after the caller aborted while execStream was pending', async () => {
    const driven = drivenStub()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const execStream = driven.stub.execStream!.bind(driven.stub)
    const stub: CloudflareSandboxStub = {
      ...driven.stub,
      execStream: async (command, options) => {
        await gate
        return execStream(command, options)
      },
    }
    const caller = new AbortController()
    const proc = await spawnOn(stub, { command: 'long', abortSignal: caller.signal })

    caller.abort(new Error('stop now'))

    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('stop now') })
    expect(driven.cancelled()).toBe('not cancelled')

    release!()
    await vi.waitFor(() => expect(driven.cancelled()).not.toBe('not cancelled'))
  })

  it('does not call execStream for a pre-aborted call', async () => {
    const driven = drivenStub()

    await expect(spawnOn(driven.stub, { command: 'never', abortSignal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(driven.calls).toEqual([])
  })
})

interface ProcessStubOptions {
  /** Holds `startProcess` until the test calls `release`. */
  gateStart?: boolean
  /** Makes `killProcess` reject with this error. */
  killError?: unknown
  /** Holds `killProcess` until the test calls `releaseKill`. */
  gateKill?: boolean
  /** The record `getProcess` answers with; leave out to omit `getProcess`. */
  record?: { exitCode?: number } | null
}

/**
 * A stub that models the container's process table the way a real
 * `@cloudflare/sandbox` 0.11 container behaves: cancelling an `execStream`
 * stream does not stop its command, and only `killProcess(id)` stops a process
 * started with `startProcess`. The test drives the log stream by hand.
 */
function processStub(options: ProcessStubOptions = {}) {
  let status = 'running'
  const running = new Map<string, string>()
  const startCalls: { command: string, options?: { cwd?: string, env?: Record<string, string>, timeout?: number } }[] = []
  const killCalls: string[] = []
  const streamCalls: string[] = []
  let logs: ReadableStreamDefaultController<Uint8Array> | undefined
  let logsCancelled = false
  let release!: () => void
  const startGate = new Promise<void>((resolve) => { release = resolve })
  let releaseKill!: () => void
  const killGate = new Promise<void>((resolve) => { releaseKill = resolve })
  const neverSettles = () => new Promise<never>(() => {})
  const stub: CloudflareSandboxStub = {
    exec: neverSettles,
    readFile: neverSettles,
    writeFile: neverSettles,
    exists: neverSettles,
    mkdir: neverSettles,
    deleteFile: neverSettles,
    getState: async () => ({ status }),
    // Present so the tests prove the process path wins over `execStream`.
    execStream: neverSettles,
    async startProcess(command, startOptions) {
      startCalls.push({ command, options: startOptions })
      if (options.gateStart) { await startGate }
      const id = `proc-${startCalls.length}`
      running.set(id, command)
      return { id }
    },
    async streamProcessLogs(id) {
      streamCalls.push(id)
      return new ReadableStream<Uint8Array>({
        start: (controller) => { logs = controller },
        cancel: () => { logsCancelled = true },
      })
    },
    async killProcess(id) {
      killCalls.push(id)
      if (options.gateKill) { await killGate }
      if (options.killError !== undefined) { throw options.killError }
      running.delete(id)
    },
    ...(options.record !== undefined ? { getProcess: async () => options.record! } : {}),
  }
  return {
    stub,
    running: () => [...running.values()],
    startCalls,
    killCalls,
    streamCalls,
    send: (text: string): void => logs!.enqueue(encoder.encode(text)),
    end: () => logs!.close(),
    exit: (): void => { running.clear() },
    release,
    releaseKill,
    stop: () => { status = 'stopped' },
    logsCancelled: () => logsCancelled,
  }
}

/** An error as the SDK throws it: the class name and a `code`. */
function sdkError(name: string, code: string, message = 'stop failed'): Error {
  return Object.assign(new Error(message), { name, code })
}

describe('cloudflareSandbox live spawn through the process API', () => {
  beforeAll(() => {
    setContainerDeathCadenceForTests({ statePollMs: 5, probeSilenceMs: 200 })
  })

  afterAll(() => {
    setContainerDeathCadenceForTests()
  })

  it('leaves no command running in the container after kill() (#47)', async () => {
    const fake = processStub()
    const proc = await spawnOn(fake.stub, { command: 'sleep 100' })

    await proc.kill()
    await proc.wait().then(undefined, () => {})

    expect(fake.running()).toEqual([])
  })

  it('leaves no command running after a caller abort (#47)', async () => {
    const fake = processStub()
    const caller = new AbortController()
    const proc = await spawnOn(fake.stub, { command: 'sleep 100', abortSignal: caller.signal })

    caller.abort(new Error('stop now'))
    await proc.wait().then(undefined, () => {})
    await vi.waitFor(() => expect(fake.running()).toEqual([]))
  })

  it('sends a stop requested before startProcess resolves as soon as the id arrives, without opening the logs', async () => {
    const fake = processStub({ gateStart: true })
    const proc = await spawnOn(fake.stub, { command: 'sleep 100' })
    const killed = proc.kill()

    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.killCalls).toEqual([])

    fake.release()
    await killed

    expect(fake.killCalls).toEqual(['proc-1'])
    expect(fake.running()).toEqual([])
    expect(fake.streamCalls).toEqual([])
  })

  it('sends a caller abort that arrives before startProcess resolves as soon as the id arrives', async () => {
    const fake = processStub({ gateStart: true })
    const caller = new AbortController()
    const proc = await spawnOn(fake.stub, { command: 'sleep 100', abortSignal: caller.signal })

    caller.abort(new Error('stop now'))
    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('stop now') })
    fake.release()

    await vi.waitFor(() => expect(fake.killCalls).toEqual(['proc-1']))
    expect(fake.streamCalls).toEqual([])
  })

  it('does not call the stub for a pre-aborted call', async () => {
    const fake = processStub()

    await expect(spawnOn(fake.stub, { command: 'never', abortSignal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.startCalls).toEqual([])
  })

  it('rejects wait() at once with the orphan wording, before the container confirms the stop', async () => {
    const fake = processStub({ gateKill: true })
    const proc = await spawnOn(fake.stub, { command: 'long' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    const killed = proc.kill()

    const outcome = await settleWithin(proc.wait(), 500)
    expect(outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } })
    expect((outcome as { error: Error }).error.message).toMatch(/could not be confirmed cancelled and may still be running/)
    expect((await settleWithin(killed, 30)).status).toBe('pending')

    fake.releaseKill()
    await killed
  })

  it('keeps kill() pending until the container stops the command, even after an abort settled the process', async () => {
    const fake = processStub({ gateKill: true })
    const caller = new AbortController()
    const proc = await spawnOn(fake.stub, { command: 'long', abortSignal: caller.signal })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    caller.abort()
    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError' })
    const again = proc.kill()
    expect((await settleWithin(again, 30)).status).toBe('pending')

    fake.releaseKill()
    await again
    expect(fake.killCalls).toEqual(['proc-1'])
  })

  it('keeps a second kill() pending until the container stops the command', async () => {
    const fake = processStub({ gateKill: true })
    const proc = await spawnOn(fake.stub, { command: 'long' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    const first = proc.kill()
    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError' })
    const second = proc.kill()
    expect((await settleWithin(second, 30)).status).toBe('pending')

    fake.releaseKill()
    await Promise.all([first, second])
  })

  it('sends one stop however many of kill() and an abort fire', async () => {
    const fake = processStub()
    const caller = new AbortController()
    const proc = await spawnOn(fake.stub, { command: 'long', abortSignal: caller.signal })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    await Promise.all([proc.kill(), proc.kill()])
    caller.abort()
    await proc.wait().then(undefined, () => {})

    expect(fake.killCalls).toEqual(['proc-1'])
  })

  it('delivers output before the command completes and resolves wait() with the exit code', async () => {
    const fake = processStub()
    const proc = await spawnOn(fake.stub, { command: 'build', workingDirectory: 'sub', env: { A: '1' }, timeoutMs: 1500.4 })
    const stdout = proc.stdout.getReader()
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    fake.send(frame({ type: 'process_info' }) + frame({ type: 'stdout', data: 'first\n' }) + frame({ type: 'progress' }))

    expect(decoder.decode((await stdout.read()).value)).toBe('first\n')
    expect((await settleWithin(proc.wait(), 30)).status).toBe('pending')

    fake.send(frame({ type: 'stderr', data: 'warn\n' }) + frame({ type: 'exit', exitCode: 3 }))
    fake.end()

    await expect(proc.wait()).resolves.toEqual({ exitCode: 3 })
    expect(await new Response(proc.stderr).text()).toBe('warn\n')
    expect(await stdout.read()).toEqual({ done: true, value: undefined })
    expect(fake.startCalls).toEqual([{ command: '( eval \' build\' )', options: { cwd: '/workspace/sub', env: { A: '1' }, timeout: 1501 } }])
    expect(fake.killCalls).toEqual([])
  })

  it('falls back to getProcess when the exit event has no exit code', async () => {
    const fake = processStub({ record: { exitCode: 7 } })
    const proc = await spawnOn(fake.stub, { command: 'x' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    fake.send(frame({ type: 'exit' }))

    await expect(proc.wait()).resolves.toEqual({ exitCode: 7 })
  })

  it.each([
    ['getProcess has no exit code', { record: {} }],
    ['getProcess is absent', {}],
  ] satisfies [string, ProcessStubOptions][])('rejects wait() when the exit code is missing and %s', async (_name, stubOptions) => {
    const fake = processStub(stubOptions)
    const proc = await spawnOn(fake.stub, { command: 'x' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    fake.send(frame({ type: 'exit' }))

    await expect(proc.wait()).rejects.toThrow(/completed without an exit code/)
  })

  it('stops the command and rejects wait() when the log stream ends without an exit event', async () => {
    const fake = processStub()
    const proc = await spawnOn(fake.stub, { command: 'x' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    fake.send(frame({ type: 'stdout', data: 'cut off' }))
    fake.end()

    await expect(proc.wait()).rejects.toThrow(/ended before the command completed/)
    await vi.waitFor(() => expect(fake.killCalls).toEqual(['proc-1']))
  })

  it('rejects wait() with the message of an error event', async () => {
    const fake = processStub()
    const proc = await spawnOn(fake.stub, { command: 'x' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    fake.send(frame({ type: 'error', error: 'command not found' }))

    await expect(proc.wait()).rejects.toThrow('command not found')
  })

  it.each([
    ['a CommandNotFoundError by name', sdkError('CommandNotFoundError', 'X')],
    ['a ProcessNotFoundError by name', sdkError('ProcessNotFoundError', 'X')],
    ['COMMAND_NOT_FOUND by code', sdkError('Error', 'COMMAND_NOT_FOUND')],
    ['PROCESS_NOT_FOUND by code', sdkError('Error', 'PROCESS_NOT_FOUND')],
    ['a not-found message with no name or code', new Error('Process not found: proc-1')],
  ])('settles kill() when killProcess rejects with %s', async (_name, killError) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = processStub({ killError })
    const proc = await spawnOn(fake.stub, { command: 'long' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    await expect(proc.kill()).resolves.toBeUndefined()

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('settles kill() and reports an unexpected killProcess failure without an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = processStub({ killError: new Error('disk on fire') })
    const proc = await spawnOn(fake.stub, { command: 'long' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    await expect(proc.kill()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not stop a command that already exited, and keeps the result wait() settled with', async () => {
    const fake = processStub()
    const proc = await spawnOn(fake.stub, { command: 'quick' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))
    fake.send(frame({ type: 'exit', exitCode: 0 }))
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })

    await expect(proc.kill()).resolves.toBeUndefined()

    expect(fake.killCalls).toEqual([])
    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
  })

  it('keeps the first result when the stop finds the command already exited', async () => {
    const fake = processStub({ killError: sdkError('CommandNotFoundError', 'COMMAND_NOT_FOUND') })
    const caller = new AbortController()
    const proc = await spawnOn(fake.stub, { command: 'long', abortSignal: caller.signal })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    caller.abort()

    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fake.killCalls).toHaveLength(1))
    await expect(proc.kill()).resolves.toBeUndefined()
  })

  it('rejects wait() with SandboxDiedError when the container dies during startProcess', async () => {
    const fake = processStub({ gateStart: true })
    const proc = await spawnOn(fake.stub, { command: 'long' })

    fake.stop()

    const outcome = await settleWithin(proc.wait(), 500)
    expect((outcome as { error: unknown }).error).toBeInstanceOf(SandboxDiedError)
    await expect(proc.kill()).resolves.toBeUndefined()
  })

  it('rejects wait() with SandboxDiedError and errors the streams when the container dies while streaming', async () => {
    const fake = processStub()
    const proc = await spawnOn(fake.stub, { command: 'long' })
    const stdout = proc.stdout.getReader()
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))
    fake.send(frame({ type: 'stdout', data: 'partial' }))
    expect(decoder.decode((await stdout.read()).value)).toBe('partial')

    fake.stop()

    const outcome = await settleWithin(proc.wait(), 500)
    expect((outcome as { error: unknown }).error).toBeInstanceOf(SandboxDiedError)
    await expect(stdout.read()).rejects.toBeInstanceOf(SandboxDiedError)
    await expect(proc.kill()).resolves.toBeUndefined()
  })

  it('settles kill() when the container dies during the stop', async () => {
    const fake = processStub({ gateKill: true })
    const proc = await spawnOn(fake.stub, { command: 'long' })
    await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

    const killed = proc.kill()
    fake.stop()

    await expect(settleWithin(killed, 500)).resolves.toMatchObject({ status: 'resolved' })
    await expect(proc.wait()).rejects.toMatchObject({ name: 'AbortError' })
  })

  describe('output cap and deadline', () => {
    const OVER_CAP = 64 * 1024 * 1024 + 1

    it('stops the command past the unread-output cap and resolves wait() with 1', async () => {
      const fake = processStub()
      const proc = await spawnOn(fake.stub, { command: 'flood' })
      await vi.waitFor(() => expect(fake.streamCalls).toHaveLength(1))

      fake.send(frame({ type: 'stdout', data: 'x'.repeat(OVER_CAP) }))

      await expect(proc.wait()).resolves.toEqual({ exitCode: 1 })
      await vi.waitFor(() => expect(fake.killCalls).toEqual(['proc-1']))
      expect(fake.running()).toEqual([])
      const notice = await new Response(proc.stderr).text()
      expect(notice).toContain('the remote command is being stopped')
      expect(notice).not.toContain('may still be running')
      await proc.kill()
      expect(fake.killCalls).toHaveLength(1)
    })

    it('keeps the "may still be running" notice on an execStream-only stub', async () => {
      const driven = drivenStub()
      const proc = await spawnOn(driven.stub, { command: 'flood' })

      driven.send(frame({ type: 'stdout', data: 'x'.repeat(OVER_CAP) }))

      await expect(proc.wait()).resolves.toEqual({ exitCode: 1 })
      expect(await new Response(proc.stderr).text()).toContain('the remote command may still be running')
    })

    describe('with fake timers', () => {
      beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
      afterEach(() => {
        vi.useRealTimers()
        setContainerDeathCadenceForTests({ statePollMs: 5, probeSilenceMs: 200 })
      })

      it('stops the command no earlier than the rounded-up deadline and resolves wait() with 124', async () => {
        const fake = processStub()
        const proc = await spawnOn(fake.stub, { command: 'slow', timeoutMs: 1500.4 })
        await vi.advanceTimersByTimeAsync(0)
        fake.send(frame({ type: 'stdout', data: 'tick\n' }))

        await vi.advanceTimersByTimeAsync(1500)
        expect(fake.killCalls).toEqual([])
        let settled = false
        void proc.wait().then(() => { settled = true }, () => { settled = true })
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(false)

        await vi.advanceTimersByTimeAsync(1)

        await expect(proc.wait()).resolves.toEqual({ exitCode: 124 })
        expect(fake.killCalls).toEqual(['proc-1'])
        expect(fake.startCalls[0]?.options?.timeout).toBe(1501)
        expect(await new Response(proc.stdout).text()).toBe('tick\n')
      })

      it('keeps kill() pending after the deadline until the container stops the command', async () => {
        const fake = processStub({ gateKill: true })
        const proc = await spawnOn(fake.stub, { command: 'slow', timeoutMs: 100 })
        await vi.advanceTimersByTimeAsync(0)

        await vi.advanceTimersByTimeAsync(100)
        await expect(proc.wait()).resolves.toEqual({ exitCode: 124 })
        const killed = proc.kill()
        let done = false
        void killed.then(() => { done = true })
        await vi.advanceTimersByTimeAsync(10)
        expect(done).toBe(false)

        fake.releaseKill()
        await killed
        expect(fake.killCalls).toEqual(['proc-1'])
      })

      it('does not fire a deadline above the setTimeout limit early, and fires it once fully elapsed', async () => {
        // A 5 ms state poll would make advancing 2^31 ms take millions of ticks.
        setContainerDeathCadenceForTests({ statePollMs: 2 ** 30, probeSilenceMs: 2 ** 30 })
        const fake = processStub()
        const proc = await spawnOn(fake.stub, { command: 'slow', timeoutMs: 2 ** 31 })
        await vi.advanceTimersByTimeAsync(0)

        await vi.advanceTimersByTimeAsync(1000)
        expect(fake.killCalls).toEqual([])
        let settled = false
        void proc.wait().then(() => { settled = true }, () => { settled = true })
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(false)

        await vi.advanceTimersByTimeAsync(2 ** 31 - 1000)
        await expect(proc.wait()).resolves.toEqual({ exitCode: 124 })
        expect(fake.killCalls).toEqual(['proc-1'])
      })

      it('sends one stop however many of the timeout, kill(), an abort and the cap fire', async () => {
        const fake = processStub()
        const caller = new AbortController()
        const proc = await spawnOn(fake.stub, { command: 'slow', timeoutMs: 100, abortSignal: caller.signal })
        await vi.advanceTimersByTimeAsync(0)

        await vi.advanceTimersByTimeAsync(100)
        await proc.kill()
        caller.abort()
        await vi.advanceTimersByTimeAsync(10)

        await expect(proc.wait()).resolves.toEqual({ exitCode: 124 })
        expect(fake.killCalls).toEqual(['proc-1'])
      })

      it('clears the deadline on exit, failure, kill, abort and overflow', async () => {
        const settle = {
          exit: (fake: ReturnType<typeof processStub>) => fake.send(frame({ type: 'exit', exitCode: 0 })),
          failure: (fake: ReturnType<typeof processStub>) => fake.send(frame({ type: 'error', error: 'boom' })),
          overflow: (fake: ReturnType<typeof processStub>) => fake.send(frame({ type: 'stdout', data: 'x'.repeat(OVER_CAP) })),
        }
        for (const [name, trigger] of Object.entries(settle)) {
          const fake = processStub()
          const proc = await spawnOn(fake.stub, { command: name, timeoutMs: 60_000 })
          await vi.advanceTimersByTimeAsync(0)
          trigger(fake)
          await proc.wait().then(undefined, () => {})
          await vi.advanceTimersByTimeAsync(0)
          expect(vi.getTimerCount(), name).toBe(0)
        }

        const killedFake = processStub()
        const killedProc = await spawnOn(killedFake.stub, { command: 'k', timeoutMs: 60_000 })
        await vi.advanceTimersByTimeAsync(0)
        await killedProc.kill()
        await vi.advanceTimersByTimeAsync(0)
        expect(vi.getTimerCount()).toBe(0)

        const caller = new AbortController()
        const abortedFake = processStub()
        const abortedProc = await spawnOn(abortedFake.stub, { command: 'a', timeoutMs: 60_000, abortSignal: caller.signal })
        await vi.advanceTimersByTimeAsync(0)
        caller.abort()
        await abortedProc.wait().then(undefined, () => {})
        await vi.advanceTimersByTimeAsync(0)
        expect(vi.getTimerCount()).toBe(0)
      })

      it('does not reject wait() with an AbortError on a timeout', async () => {
        const fake = processStub()
        const proc = await spawnOn(fake.stub, { command: 'slow', timeoutMs: 5 })
        await vi.advanceTimersByTimeAsync(5)

        await expect(proc.wait()).resolves.toEqual({ exitCode: 124 })
      })
    })
  })

  it.each(['startProcess', 'streamProcessLogs', 'killProcess'] as const)('falls back to execStream when the stub lacks %s', async (missing) => {
    const fake = processStub()
    const driven = drivenStub()
    const partial: CloudflareSandboxStub = { ...fake.stub, execStream: driven.stub.execStream, [missing]: undefined }

    const proc = await spawnOn(partial, { command: 'echo' })
    driven.send(frame({ type: 'complete', exitCode: 0 }))

    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
    expect(driven.calls).toHaveLength(1)
    expect(fake.startCalls).toEqual([])
  })

  it('uses the buffered path for a stub with only some process methods and no execStream', async () => {
    const fake = processStub()
    let execCalls = 0
    const partial: CloudflareSandboxStub = {
      ...fake.stub,
      execStream: undefined,
      killProcess: undefined,
      exec: async () => { execCalls += 1; return { success: true, stdout: '', stderr: '', exitCode: 0 } },
    }

    const proc = await spawnOn(partial, { command: 'echo' })

    await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
    expect(execCalls).toBe(1)
    expect(fake.startCalls).toEqual([])
  })
})
