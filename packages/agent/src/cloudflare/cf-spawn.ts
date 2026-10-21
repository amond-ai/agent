/**
 * Live `spawn` for `cloudflareSandbox`: runs a command through the Cloudflare
 * Sandbox SDK's streaming exec and delivers its output as it is produced.
 *
 * Parses the server-sent-events stream itself, so `@amond-ai/agent` keeps no
 * runtime import of `@cloudflare/sandbox`.
 */

import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'

import { abortErrorFor, abortErrorWithSuffix, roundUpTimeoutMs } from '../abort.ts'
import { ORPHANED_EXEC_SUFFIX } from '../sandbox.ts'
import { createProcessController } from '../sandbox-streams.ts'
import type { SandboxRunOptions } from '../types.ts'
import type { CloudflareSandboxStub } from './cf-sandbox.ts'

/** One event of the streaming exec, as amond reads it. Unknown event types are dropped by the parser. */
export type ExecStreamEvent =
  | { type: 'start' }
  | { type: 'stdout' | 'stderr', data: string }
  | { type: 'complete', exitCode: number | undefined }
  | { type: 'error', error: string }

/** Incremental parser for the streaming exec's server-sent events. */
export interface ExecStreamParser {
  /** Feed the next chunk of bytes; returns every event the chunk completed. */
  push: (chunk: Uint8Array) => ExecStreamEvent[]
  /** Signal end of input; returns the event of a final frame that lacked its blank line. */
  end: () => ExecStreamEvent[]
}

/** Read the JSON payload of one SSE `data` field. Unknown event types yield `undefined`. */
function toEvent(data: string): ExecStreamEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  }
  catch {
    throw new Error(`Cloudflare execStream sent an event that is not JSON: ${data}`)
  }
  if (typeof parsed !== 'object' || parsed === null) { return undefined }
  const event = parsed as Record<string, unknown>
  switch (event.type) {
    case 'start':
      return { type: 'start' }
    case 'stdout':
    case 'stderr':
      return { type: event.type, data: typeof event.data === 'string' ? event.data : '' }
    case 'complete':
      return { type: 'complete', exitCode: typeof event.exitCode === 'number' ? event.exitCode : undefined }
    case 'error':
      return { type: 'error', error: typeof event.error === 'string' ? event.error : 'Command failed.' }
    default:
      return undefined
  }
}

/**
 * Build an {@link ExecStreamParser}. Frames and lines may be split anywhere
 * across chunks, including inside a multi-byte UTF-8 character. Following the
 * SSE format, a frame's `data:` lines join with `\n`, a blank line ends the
 * frame, `:` lines are comments, and other fields (`event:`, `id:`) are ignored.
 */
export function createExecStreamParser(): ExecStreamParser {
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []

  const dispatch = (events: ExecStreamEvent[]): void => {
    if (data.length === 0) { return }
    const event = toEvent(data.join('\n'))
    data = []
    if (event) { events.push(event) }
  }

  const readLine = (line: string, events: ExecStreamEvent[]): void => {
    if (line === '') {
      dispatch(events)
      return
    }
    if (line.startsWith(':')) { return }
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== 'data') { return }
    const value = colon === -1 ? '' : line.slice(colon + 1)
    data.push(value.startsWith(' ') ? value.slice(1) : value)
  }

  const drainLines = (events: ExecStreamEvent[]): void => {
    for (;;) {
      const newline = buffer.search(/\r\n|\r|\n/)
      if (newline === -1) { return }
      // A trailing `\r` may be the first half of a `\r\n` split across chunks.
      if (buffer[newline] === '\r' && newline === buffer.length - 1) { return }
      const width = buffer.startsWith('\r\n', newline) ? 2 : 1
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + width)
      readLine(line, events)
    }
  }

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true })
      const events: ExecStreamEvent[] = []
      drainLines(events)
      return events
    },
    end() {
      buffer += decoder.decode()
      const events: ExecStreamEvent[] = []
      drainLines(events)
      if (buffer.endsWith('\r')) { buffer = buffer.slice(0, -1) }
      if (buffer !== '') { readLine(buffer, events) }
      buffer = ''
      dispatch(events)
      return events
    },
  }
}

/** The death-detector race `cloudflareSandbox` wraps every container call in. */
export type ContainerCallGuard = <T>(operation: string, call: Promise<T>) => Promise<T>

/** A stub that has the streaming exec. */
export type StreamingCloudflareSandboxStub = CloudflareSandboxStub & Required<Pick<CloudflareSandboxStub, 'execStream'>>

export interface LiveSpawnContext {
  stub: StreamingCloudflareSandboxStub
  /** The sandbox's default working directory. */
  cwd: string
  /** Resolves a relative `workingDirectory` against the sandbox's cwd, as `run` does. */
  resolvePath: (path: string) => string
  guard: ContainerCallGuard
}

/**
 * The `AbortError` a caller abort or `kill()` settles the process with. No
 * remote kill is confirmed (cancelling the event stream may leave the command
 * running), so it carries the same orphan wording as the buffered path.
 */
function orphanAbortError(signal: AbortSignal): Error {
  return abortErrorWithSuffix(signal, ORPHANED_EXEC_SUFFIX)
}

/**
 * Spawn `options.command` through `stub.execStream` and push its output to
 * the process as the events arrive.
 *
 * A pre-aborted `abortSignal` rejects before the stub is called. A caller
 * abort or `kill()` cancels the event stream and rejects `wait()` with an
 * `AbortError`. The read is raced against container death, so a container
 * that dies mid-command errors both streams and rejects `wait()` with
 * `SandboxDiedError`.
 */
export async function spawnLive(
  context: LiveSpawnContext,
  options: SandboxRunOptions,
): Promise<Experimental_SandboxProcess> {
  const callerSignal = options.abortSignal
  if (callerSignal?.aborted) { throw abortErrorFor(callerSignal) }

  const killer = new AbortController()
  const signal = callerSignal ? AbortSignal.any([callerSignal, killer.signal]) : killer.signal
  const controller = createProcessController({
    kill: () => killer.abort(new DOMException('The process was killed.', 'AbortError')),
  })

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let stopped = false
  const stopReading = (reason?: unknown): void => {
    stopped = true
    reader?.cancel(reason).catch(() => {})
  }

  const readExitCode = async (): Promise<number> => {
    const stream = await context.stub.execStream(options.command, {
      cwd: options.workingDirectory !== undefined ? context.resolvePath(options.workingDirectory) : context.cwd,
      env: options.env,
      // The Cloudflare sandbox `timeout` option is in milliseconds; a
      // fractional deadline is rounded up, never down.
      timeout: options.timeoutMs !== undefined ? roundUpTimeoutMs(options.timeoutMs) : undefined,
    })
    reader = stream.getReader()
    if (stopped) { stopReading() }

    const parser = createExecStreamParser()
    for (;;) {
      const { done, value } = await reader.read()
      const events = done ? parser.end() : parser.push(value)
      for (const event of events) {
        if (event.type === 'stdout') { controller.pushStdout(event.data) }
        else if (event.type === 'stderr') { controller.pushStderr(event.data) }
        else if (event.type === 'error') { throw new Error(event.error) }
        else if (event.type === 'complete') {
          if (event.exitCode === undefined) {
            throw new Error('Cloudflare execStream completed without an exit code.')
          }
          stopReading()
          return event.exitCode
        }
      }
      if (done) { throw new Error('Cloudflare execStream ended before the command completed.') }
    }
  }

  const onAbort = (): void => {
    stopReading(signal.reason)
    controller.fail(orphanAbortError(signal))
  }
  signal.addEventListener('abort', onAbort, { once: true })

  context.guard('spawn', readExitCode()).then(
    exitCode => controller.exit(exitCode),
    (error: unknown) => {
      stopReading(error)
      controller.fail(error)
    },
  ).finally(() => signal.removeEventListener('abort', onAbort))

  return controller.process
}
