import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

  it('reads the error event\'s message', () => {
    expect(parseChunks([frame({ type: 'error', error: 'boom' })])).toEqual([{ type: 'error', error: 'boom' }])
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
    await spawnOn(driven.stub, { command: 'pwd', workingDirectory: 'sub', env: { A: '1' }, timeoutMs: 1500.4 })

    expect(driven.calls).toEqual([{ command: 'pwd', options: { cwd: '/workspace/sub', env: { A: '1' }, timeout: 1501 } }])
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

  it('does not call execStream for a pre-aborted call', async () => {
    const driven = drivenStub()

    await expect(spawnOn(driven.stub, { command: 'never', abortSignal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(driven.calls).toEqual([])
  })
})
