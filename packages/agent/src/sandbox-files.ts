/**
 * Builds the six AI SDK sandbox-session file methods from a provider's small
 * set of primitives, so every provider shares one implementation of the
 * null-on-missing, line-range, and encoding rules.
 *
 * Runs on workerd as well as Node: web-platform APIs only.
 */

import { abortErrorFor } from './abort.ts'
import { FileNotFoundError } from './errors.ts'
import { bytesToStream, readerToBytes, sliceLines, streamToBytes } from './sandbox-streams.ts'
import type { AmondFs, Sandbox } from './types.ts'

export interface ReadFileArgs {
  path: string
  abortSignal?: AbortSignal
}

export interface SandboxFileMethods {
  readFile: (options: ReadFileArgs) => Promise<ReadableStream<Uint8Array> | null>
  readBinaryFile: (options: ReadFileArgs) => Promise<Uint8Array | null>
  readTextFile: (
    options: ReadFileArgs & { encoding?: string, startLine?: number, endLine?: number },
  ) => Promise<string | null>
  writeFile: (
    options: { path: string, content: ReadableStream<Uint8Array>, abortSignal?: AbortSignal },
  ) => Promise<void>
  writeBinaryFile: (
    options: { path: string, content: Uint8Array, abortSignal?: AbortSignal },
  ) => Promise<void>
  writeTextFile: (
    options: { path: string, content: string, encoding?: string, abortSignal?: AbortSignal },
  ) => Promise<void>
}

/** What a provider supplies. Read primitives reject when the file is missing. */
export interface SandboxFilePrimitives {
  /** Resolve a possibly-relative path against the provider's working directory. */
  resolvePath: (path: string) => string
  readText: (resolvedPath: string) => Promise<string>
  readBytes: (resolvedPath: string) => Promise<Uint8Array>
  /** Write text or bytes, creating missing parent directories. */
  write: (resolvedPath: string, content: string | Uint8Array) => Promise<void>
  /** True when `error` means `path` does not exist (not any other failure). */
  isMissing: (error: unknown, path: string) => boolean | Promise<boolean>
}

/** The canonical label (`"utf-8"` for any UTF-8 alias), or `undefined` for an unknown label. */
function canonicalEncoding(label: string): string | undefined {
  try {
    return new TextDecoder(label).encoding
  }
  catch {
    return undefined
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) { throw abortErrorFor(signal) }
}

/**
 * Drain `stream` into bytes, stopping as soon as `signal` aborts: the reader
 * is cancelled and the read rejects with the abort error, even if the stream
 * never produces another chunk.
 */
async function drainStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (!signal) { return streamToBytes(stream) }
  throwIfAborted(signal)
  const reader = stream.getReader()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reader.cancel(signal.reason).catch(() => {})
      reject(abortErrorFor(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  // The losing side must never surface as an unhandled rejection.
  aborted.catch(() => {})
  const drained = readerToBytes(reader)
  drained.catch(() => {})
  try {
    return await Promise.race([drained, aborted])
  }
  finally {
    if (onAbort) { signal.removeEventListener('abort', onAbort) }
  }
}

/**
 * Run a provider primitive so `signal` can end the wait: an abort mid-flight
 * rejects promptly with the abort error, the late settlement of the abandoned
 * call is swallowed, and the listener is removed once the call settles. A
 * provider write that is abandoned this way may still land. Without a signal
 * the primitive runs untouched.
 */
async function abortable<T>(start: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) { return start() }
  throwIfAborted(signal)
  let onAbort: (() => void) | undefined
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortErrorFor(signal))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    aborted.catch(() => {})
    const pending = start()
    pending.catch(() => {})
    const result = await Promise.race([pending, aborted])
    throwIfAborted(signal)
    return result
  }
  finally {
    if (onAbort) { signal.removeEventListener('abort', onAbort) }
  }
}

export function createSandboxFileMethods(primitives: SandboxFilePrimitives): SandboxFileMethods {
  const { resolvePath, readText, readBytes, write, isMissing } = primitives

  /** Run a read; a missing file becomes `null`, every other failure is rethrown as-is. */
  async function readOrNull<T>(
    path: string,
    read: (resolved: string) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T | null> {
    const resolved = resolvePath(path)
    try {
      return await abortable(() => read(resolved), signal)
    }
    catch (error) {
      throwIfAborted(signal)
      if (await abortable(async () => isMissing(error, resolved), signal)) { return null }
      throw error
    }
  }

  return {
    async readFile({ path, abortSignal }) {
      throwIfAborted(abortSignal)
      const bytes = await readOrNull(path, readBytes, abortSignal)
      return bytes === null ? null : bytesToStream(bytes)
    },

    async readBinaryFile({ path, abortSignal }) {
      throwIfAborted(abortSignal)
      return readOrNull(path, readBytes, abortSignal)
    },

    async readTextFile({ path, abortSignal, encoding, startLine, endLine }) {
      throwIfAborted(abortSignal)
      if (encoding !== undefined && canonicalEncoding(encoding) === undefined) {
        throw new RangeError(`Unsupported encoding "${encoding}".`)
      }
      const decoded = await readOrNull(path, async (resolved) => {
        if (encoding === undefined || canonicalEncoding(encoding) === 'utf-8') {
          return readText(resolved)
        }
        return new TextDecoder(encoding).decode(await readBytes(resolved))
      }, abortSignal)
      return decoded === null ? null : sliceLines(decoded, startLine, endLine)
    },

    async writeFile({ path, content, abortSignal }) {
      throwIfAborted(abortSignal)
      const bytes = await drainStream(content, abortSignal)
      throwIfAborted(abortSignal)
      await abortable(() => write(resolvePath(path), bytes), abortSignal)
    },

    async writeBinaryFile({ path, content, abortSignal }) {
      throwIfAborted(abortSignal)
      await abortable(() => write(resolvePath(path), content), abortSignal)
    },

    async writeTextFile({ path, content, encoding, abortSignal }) {
      throwIfAborted(abortSignal)
      if (encoding !== undefined && canonicalEncoding(encoding) !== 'utf-8') {
        throw new TypeError(`Unsupported encoding "${encoding}": writeTextFile supports utf-8 only.`)
      }
      await abortable(() => write(resolvePath(path), content), abortSignal)
    },
  }
}

/**
 * The path-based `AmondFs` facade (`harness.fs`, `session.fs`) over the
 * session file methods. `getEnv` is called on every operation, so a swapped
 * sandbox is immediately what the facade operates on. A read of a missing
 * file rejects with {@link FileNotFoundError}, as `AmondFs` documents.
 */
export function createAmondFs(getEnv: () => Sandbox): AmondFs {
  return {
    async readFile(path) {
      const content = await getEnv().readTextFile({ path })
      if (content === null) { throw new FileNotFoundError({ path }) }
      return content
    },
    async readFileBuffer(path) {
      const content = await getEnv().readBinaryFile({ path })
      if (content === null) { throw new FileNotFoundError({ path }) }
      return content
    },
    writeFile: (path, content) =>
      typeof content === 'string'
        ? getEnv().writeTextFile({ path, content })
        : getEnv().writeBinaryFile({ path, content }),
    stat: path => getEnv().stat(path),
    readdir: path => getEnv().readdir(path),
    exists: path => getEnv().exists(path),
    mkdir: (path, options) => getEnv().mkdir(path, options),
    rm: (path, options) => getEnv().rm(path, options),
  }
}
