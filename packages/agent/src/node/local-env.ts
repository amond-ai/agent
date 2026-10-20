/**
 * Pure-Node `Sandbox` backed by the host filesystem and `child_process`.
 *
 * Internal implementation behind the `local()` sandbox factory (see
 * `./local.ts`). Not exported from `@amond-ai/agent/node` — user code reaches
 * this through `local(...)`. `run` and `spawn` shell out via `child_process.spawn`;
 * file methods call `node:fs/promises` directly.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { abortErrorFor, composeTimeoutSignal } from '../abort.ts'
import { writeFileCreatingParents } from '../sandbox.ts'
import { createSandboxFileMethods } from '../sandbox-files.ts'
import { createProcessController } from '../sandbox-streams.ts'
import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'
import type { FileStat, Sandbox, SandboxRunOptions, ShellResult } from '../types.ts'
import { launchShell, MAX_OUTPUT_BYTES } from './shell-process.ts'

/**
 * Run `command` through the shared shell launcher and collect its output as
 * strings.
 *
 * Always resolves with a `ShellResult`; spawn failures surface as
 * `exitCode: 1` with the error message on stderr, matching the previous
 * `exec`-based behavior for non-zero exits.
 */
async function execShell(
  command: string,
  opts: { cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal },
): Promise<ShellResult> {
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  let stdout = ''
  let stderr = ''

  const exit = await launchShell(command, {
    ...opts,
    onStdout: (chunk) => { stdout += stdoutDecoder.write(chunk) },
    onStderr: (chunk) => { stderr += stderrDecoder.write(chunk) },
  }).exited
  stdout += stdoutDecoder.end()
  stderr += stderrDecoder.end()

  if (exit.error) {
    return { stdout, stderr: stderr || String(exit.error.message ?? exit.error), exitCode: 1 }
  }
  if (exit.overflowed) {
    return {
      stdout,
      stderr: `${stderr}\n[amond] local exec output exceeded ${MAX_OUTPUT_BYTES} bytes; process tree killed`,
      exitCode: 1,
    }
  }
  // `code` is null when the child died from a signal. A kill driven
  // by this adapter's own abort resolves with the timeout(1)
  // convention's exit code 124; callers only ever see it for
  // `timeoutMs` kills, because the caller-abort path rethrows
  // AbortError before the result surfaces. A signal death we did
  // not initiate keeps the generic failure code.
  return { stdout, stderr, exitCode: exit.code ?? (opts.signal?.aborted ? 124 : 1) }
}

/**
 * Shell-essential env vars inherited from `process.env` by default. Pulled
 * once at sandbox construction.
 *
 * Invariant: nothing on this list should be sensitive on a typical host.
 * Adding entries here is a security-relevant decision — secrets, tokens,
 * cloud-provider creds, and agent sockets MUST NOT appear. To expose
 * anything else, callers opt in explicitly via `options.env`.
 */
const DEFAULT_LOCAL_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'HOSTNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
] as const

export interface LocalSandboxOptions {
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string
  /**
   * Env vars layered on top of `DEFAULT_LOCAL_ENV_ALLOWLIST`. Set a key
   * to `undefined` to drop a default. Per-call `env` on `run()`/`spawn()`
   * layers on top of this.
   *
   * Pass-through is intentionally explicit:
   *
   * ```ts
   * // Expose one host var.
   * local({ env: { GH_TOKEN: process.env.GH_TOKEN } });
   *
   * // Inherit everything (exposes host secrets to the model's bash tool).
   * local({ env: { ...process.env } });
   * ```
   */
  env?: Record<string, string | undefined>
}

/**
 * Snapshot `process.env` through the allowlist, then layer user overrides.
 * Called once per sandbox; the result is captured in a closure and reused
 * across every command so per-call cost stays minimal and the env shape
 * is stable for the sandbox's lifetime (host mutations to `process.env`
 * after construction are NOT picked up).
 */
function resolveBaseEnv(userEnv: LocalSandboxOptions['env']): NodeJS.ProcessEnv {
  // Reject non-record shapes (notably `true` and arrays) at runtime so
  // we keep the option's shape open for future shorthands like
  // `env: true` meaning "pass through all of process.env". The TS type
  // already forbids these; this guard is for JS callers and accidental
  // `any`s.
  if (userEnv !== undefined && (typeof userEnv !== 'object' || Array.isArray(userEnv))) {
    throw new TypeError(
      '[amond] local() `env` must be a Record<string, string | undefined>. ' +
      'To inherit the full host env, pass `env: { ...process.env }`.',
    )
  }

  const base: NodeJS.ProcessEnv = {}
  for (const key of DEFAULT_LOCAL_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) { base[key] = value }
  }
  if (!userEnv) { return base }
  for (const [key, value] of Object.entries(userEnv)) {
    if (value === undefined) {
      delete base[key]
    }
    else {
      base[key] = value
    }
  }
  return base
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}

export function createLocalSandbox(options: LocalSandboxOptions = {}): Sandbox {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const baseEnv = resolveBaseEnv(options.env)

  const resolvePath = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(cwd, p))

  const run = async (options: SandboxRunOptions): Promise<ShellResult> => {
    const signal = options.abortSignal
    if (signal?.aborted) { throw abortErrorFor(signal) }

    // Compose timeoutMs with the caller's signal so signal-blind
    // callers still observe deadlines and signal-aware ones can abort
    // mid-flight. Mirrors the bashFactory adapter's behavior.
    const { mergedSignal } = composeTimeoutSignal(options.timeoutMs, signal)

    const result = await execShell(options.command, {
      cwd: options.workingDirectory ? resolvePath(options.workingDirectory) : cwd,
      // Per-call env layers on top of `baseEnv` (allowlist +
      // sandbox `env` option). `process.env` is intentionally
      // never read here.
      env: options.env ? { ...baseEnv, ...options.env } : baseEnv,
      signal: mergedSignal,
    })
    if (signal?.aborted) { throw abortErrorFor(signal) }
    return result
  }

  /**
   * Live `spawn`: chunks reach the streams as the shell writes them.
   * `kill()` and either abort path signal the whole process group. A caller
   * abort rejects `wait()` with an `AbortError`; a `timeoutMs` expiry alone
   * resolves it with 124, like `run`.
   */
  const spawnLive = async (options: SandboxRunOptions): Promise<Experimental_SandboxProcess> => {
    const callerSignal = options.abortSignal
    if (callerSignal?.aborted) { throw abortErrorFor(callerSignal) }

    const { mergedSignal } = composeTimeoutSignal(options.timeoutMs, callerSignal)
    const shell = launchShell(options.command, {
      cwd: options.workingDirectory ? resolvePath(options.workingDirectory) : cwd,
      env: options.env ? { ...baseEnv, ...options.env } : baseEnv,
      signal: mergedSignal,
      onStdout: chunk => controller.pushStdout(chunk),
      onStderr: chunk => controller.pushStderr(chunk),
    })
    const controller = createProcessController({
      kill: () => shell.kill(),
      ...(shell.pid !== undefined ? { pid: shell.pid } : {}),
    })

    void shell.exited.then((exit) => {
      if (callerSignal?.aborted) {
        controller.fail(abortErrorFor(callerSignal))
      }
      else if (exit.error) {
        controller.pushStderr(String(exit.error.message ?? exit.error))
        controller.exit(1)
      }
      else if (exit.overflowed) {
        controller.pushStderr(`\n[amond] local exec output exceeded ${MAX_OUTPUT_BYTES} bytes; process tree killed`)
        controller.exit(1)
      }
      else {
        controller.exit(exit.code ?? (mergedSignal?.aborted ? 124 : 1))
      }
    })
    return controller.process
  }

  const readBytes = async (resolved: string): Promise<Uint8Array> => {
    const buf = await fs.readFile(resolved)
    // Return a fresh Uint8Array view; Node Buffers are subclasses but
    // downstream code shouldn't rely on Buffer-only methods.
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  // AmondFs.writeFile guarantees parents are created as needed in every
  // sandbox mode; the shared lazy implementation keeps the happy path at a
  // single fs call.
  const write = (resolved: string, content: string | Uint8Array): Promise<void> =>
    writeFileCreatingParents(
      () => fs.writeFile(resolved, content),
      () => fs.mkdir(path.dirname(resolved), { recursive: true }),
    )

  const fileMethods = createSandboxFileMethods({
    resolvePath,
    readText: resolved => fs.readFile(resolved, 'utf8'),
    readBytes,
    write,
    // ENOTDIR: a path component is a file, so the path cannot exist.
    isMissing: error => isNodeErrorCode(error, 'ENOENT') || isNodeErrorCode(error, 'ENOTDIR'),
  })

  return {
    description:
      'The host machine\'s own shell and filesystem, with no isolation. ' +
      `The working directory is ${cwd}; relative paths and commands resolve against it.`,

    run,

    spawn: spawnLive,

    ...fileMethods,

    async stat(p): Promise<FileStat> {
      const resolved = resolvePath(p)
      // fs.stat follows symlinks, so its Stats.isSymbolicLink() is always
      // false. lstat the path itself for the symlink flag, then follow the
      // link for type/size/mtime so they describe the target (matching
      // cf-sandbox's `stat -L` semantics).
      const l = await fs.lstat(resolved)
      const s = l.isSymbolicLink() ? await fs.stat(resolved) : l
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        isSymbolicLink: l.isSymbolicLink(),
        size: s.size,
        mtime: s.mtime,
      }
    },

    async readdir(p) {
      return fs.readdir(resolvePath(p))
    },

    async exists(p) {
      try {
        await fs.access(resolvePath(p))
        return true
      }
      catch {
        return false
      }
    },

    async mkdir(p, opts) {
      await fs.mkdir(resolvePath(p), { recursive: opts?.recursive ?? false })
    },

    async rm(p, opts) {
      await fs.rm(resolvePath(p), {
        recursive: opts?.recursive ?? false,
        force: opts?.force ?? false,
      })
    },

    cwd,
    resolvePath,
  }
}
