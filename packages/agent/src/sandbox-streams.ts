/**
 * Stream, line-range, and process helpers shared by every `Sandbox` provider.
 *
 * Runs on workerd as well as Node, so it uses only web-platform primitives. The
 * AI SDK's `SandboxProcess` is imported as a type only, so nothing from
 * `@ai-sdk/provider-utils` reaches the bundle.
 */

import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'

const encoder = new TextEncoder()

/** One-chunk byte stream. An empty payload yields an empty, already-closed stream. */
export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) { controller.enqueue(bytes) }
      controller.close()
    },
  })
}

/** UTF-8 encode `text` into a one-chunk byte stream. */
export function stringToStream(text: string): ReadableStream<Uint8Array> {
  return bytesToStream(encoder.encode(text))
}

/** Drain `stream` into one contiguous `Uint8Array`. */
export function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return readerToBytes(stream.getReader())
}

/** Drain an already-acquired `reader` into one contiguous `Uint8Array`, then release its lock. */
export async function readerToBytes(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { break }
      chunks.push(value)
      total += value.byteLength
    }
  }
  finally {
    // Unlock the source stream so the caller can still cancel or inspect it.
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Select lines `startLine..endLine` (1-based, inclusive) of `text`, keeping the
 * original line endings. An `endLine` past EOF returns through EOF; a
 * `startLine` past EOF returns `""`. Lines are split on `\n` only, so the `\r`
 * of a CRLF file stays attached to its line.
 */
export function sliceLines(text: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) { return text }
  const endsWithNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (endsWithNewline) { lines.pop() }
  const from = Math.max(1, startLine ?? 1) - 1
  const to = Math.min(lines.length, endLine ?? lines.length)
  if (from >= to) { return '' }
  const selected = lines.slice(from, to).join('\n')
  return endsWithNewline && to === lines.length ? `${selected}\n` : selected
}

export interface ProcessControllerOptions {
  /** Provider hook that terminates the real process. Called at most once. */
  kill: () => void | PromiseLike<void>
  pid?: number
  /**
   * Cap on the bytes queued but not yet read from each of stdout and stderr.
   * A chunk that would exceed it is dropped and the process settles like
   * `local()`'s output overflow: a stderr notice and exit code 1. Unset means
   * unbounded.
   */
  maxBufferedBytes?: number
  /** Called once on overflow, so the provider can stop reading the command's output. */
  onOverflow?: () => void
  /**
   * Closing clause of the stderr overflow notice. Defaults to `process killed`;
   * a provider whose `onOverflow` cannot terminate the command words its own.
   */
  overflowNoticeSuffix?: string
}

/** Unread-output cap {@link createProcessController} callers apply to live spawns. */
export const MAX_BUFFERED_OUTPUT_BYTES = 64 * 1024 * 1024

export interface ProcessController {
  process: Experimental_SandboxProcess
  /** Deliver a stdout chunk, in call order. Ignored after exit or failure. */
  pushStdout: (chunk: Uint8Array | string) => void
  /** Deliver a stderr chunk, in call order. Ignored after exit or failure. */
  pushStderr: (chunk: Uint8Array | string) => void
  /** Close both streams and resolve `wait()` with `exitCode`. First settlement wins. */
  exit: (exitCode: number) => void
  /** Error both streams and reject `wait()`. First settlement wins. */
  fail: (error: unknown) => void
}

/**
 * Build a `SandboxProcess` that a provider drives through producer hooks.
 *
 * `wait()` returns one shared promise whose rejection is pre-handled, so a
 * process nobody waits on never produces an unhandled rejection (an exception
 * on workerd); callers that do await it still see the rejection.
 */
export function createProcessController(options: ProcessControllerOptions): ProcessController {
  let stdoutController!: ReadableStreamDefaultController<Uint8Array>
  let stderrController!: ReadableStreamDefaultController<Uint8Array>
  const strategy = options.maxBufferedBytes === undefined
    ? undefined
    : { highWaterMark: options.maxBufferedBytes, size: (chunk: Uint8Array) => chunk.byteLength }
  const cancelled = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const stdout = new ReadableStream<Uint8Array>({
    start: (c) => { stdoutController = c },
    cancel: () => { cancelled.add(stdoutController) },
  }, strategy)
  const stderr = new ReadableStream<Uint8Array>({
    start: (c) => { stderrController = c },
    cancel: () => { cancelled.add(stderrController) },
  }, strategy)

  let settled = false
  let resolveWait!: (result: { exitCode: number }) => void
  let rejectWait!: (error: unknown) => void
  const waitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
    resolveWait = resolve
    rejectWait = reject
  })
  waitPromise.catch(() => {})

  const push = (target: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array | string): void => {
    if (settled || cancelled.has(target)) { return }
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    if (options.maxBufferedBytes !== undefined && bytes.byteLength > (target.desiredSize ?? 0)) {
      overflow()
      return
    }
    try {
      target.enqueue(bytes)
    }
    catch {
      /* the consumer cancelled this stream; drop the chunk */
    }
  }

  // Settles the process as a failed command rather than an error: the notice
  // goes in past the cap (it is tiny), then the streams close.
  const overflow = (): void => {
    if (settled) { return }
    settled = true
    try { stderrController.enqueue(encoder.encode(`\n[amond] process output exceeded ${options.maxBufferedBytes} unread bytes; ${options.overflowNoticeSuffix ?? 'process killed'}`)) }
    catch { /* the consumer cancelled stderr */ }
    closeBoth()
    resolveWait({ exitCode: 1 })
    options.onOverflow?.()
  }

  const closeBoth = (): void => {
    for (const target of [stdoutController, stderrController]) {
      try { target.close() }
      catch { /* already cancelled */ }
    }
  }

  const errorBoth = (error: unknown): void => {
    for (const target of [stdoutController, stderrController]) {
      try { target.error(error) }
      catch { /* already cancelled */ }
    }
  }

  let killPromise: Promise<void> | undefined

  const process: Experimental_SandboxProcess = {
    ...(options.pid !== undefined ? { pid: options.pid } : {}),
    stdout,
    stderr,
    wait: () => waitPromise,
    kill: () => {
      if (settled) { return Promise.resolve() }
      killPromise ??= Promise.resolve().then(() => options.kill())
      return killPromise
    },
  }

  return {
    process,
    pushStdout: chunk => push(stdoutController, chunk),
    pushStderr: chunk => push(stderrController, chunk),
    exit(exitCode) {
      if (settled) { return }
      settled = true
      closeBoth()
      resolveWait({ exitCode })
    },
    fail(error) {
      if (settled) { return }
      settled = true
      errorBoth(error)
      rejectWait(error)
    },
  }
}
