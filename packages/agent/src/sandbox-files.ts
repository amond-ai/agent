/**
 * Builds the six AI SDK sandbox-session file methods from a provider's small
 * set of primitives, so every provider shares one implementation of the
 * null-on-missing, line-range, and encoding rules.
 *
 * Runs on workerd as well as Node: web-platform APIs only.
 */

import { abortErrorFor } from './abort.ts'
import { bytesToStream, sliceLines, streamToBytes } from './sandbox-streams.ts'

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

export function createSandboxFileMethods(primitives: SandboxFilePrimitives): SandboxFileMethods {
  const { resolvePath, readText, readBytes, write, isMissing } = primitives

  /** Run a read; a missing file becomes `null`, every other failure is rethrown as-is. */
  async function readOrNull<T>(path: string, read: (resolved: string) => Promise<T>): Promise<T | null> {
    const resolved = resolvePath(path)
    try {
      return await read(resolved)
    }
    catch (error) {
      if (await isMissing(error, resolved)) { return null }
      throw error
    }
  }

  return {
    async readFile({ path, abortSignal }) {
      throwIfAborted(abortSignal)
      const bytes = await readOrNull(path, readBytes)
      return bytes === null ? null : bytesToStream(bytes)
    },

    async readBinaryFile({ path, abortSignal }) {
      throwIfAborted(abortSignal)
      return readOrNull(path, readBytes)
    },

    async readTextFile({ path, abortSignal, encoding, startLine, endLine }) {
      throwIfAborted(abortSignal)
      const decoded = await readOrNull(path, async (resolved) => {
        if (encoding === undefined || canonicalEncoding(encoding) === 'utf-8') {
          return readText(resolved)
        }
        return new TextDecoder(encoding).decode(await readBytes(resolved))
      })
      return decoded === null ? null : sliceLines(decoded, startLine, endLine)
    },

    async writeFile({ path, content, abortSignal }) {
      throwIfAborted(abortSignal)
      await write(resolvePath(path), await streamToBytes(content))
    },

    async writeBinaryFile({ path, content, abortSignal }) {
      throwIfAborted(abortSignal)
      await write(resolvePath(path), content)
    },

    async writeTextFile({ path, content, encoding, abortSignal }) {
      throwIfAborted(abortSignal)
      if (encoding !== undefined && canonicalEncoding(encoding) !== 'utf-8') {
        throw new TypeError(`Unsupported encoding "${encoding}": writeTextFile supports utf-8 only.`)
      }
      await write(resolvePath(path), content)
    },
  }
}
