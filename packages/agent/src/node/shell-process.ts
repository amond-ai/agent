/**
 * Process-group shell launcher shared by `local()`'s `run` (buffered) and
 * `spawn` (live). Node only: it uses `node:child_process`.
 *
 * The launcher owns what both callers need and neither should duplicate:
 * the shell choice, the detached process group, tree-wide SIGTERM then SIGKILL
 * on abort, and the output cap. It hands output over as raw `Buffer` chunks
 * and reports how the process ended; decoding and exit-code mapping stay with
 * the caller.
 */
import type { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Grace period between SIGTERM and SIGKILL when tearing down a process group. */
const KILL_GRACE_MS = 2000

/**
 * Shell used for commands. The model-facing tool is named `bash` and the
 * default virtual sandbox emulates bash, so prefer real bash over Node's
 * default `/bin/sh` — on hosts where sh is dash (Debian/Ubuntu CI images)
 * bashisms like `[[ ]]` and `set -o pipefail` would otherwise fail with
 * syntax errors the model can't explain. Falls back to the platform default
 * shell when bash is absent (minimal images, Windows). Probed once per
 * process, lazily on first launch.
 *
 * The probe resolves an absolute path (using the host `process.env` PATH)
 * so a launch never depends on the sandbox env's PATH to find its own shell —
 * `/bin/sh` was absolute, and a sandbox with an overridden PATH must still
 * be able to run commands.
 */
let resolvedShell: string | true | undefined
function resolveShell(): string | true {
  if (resolvedShell === undefined) {
    if (process.platform === 'win32') {
      resolvedShell = true
    }
    else {
      const probe = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' })
      const found = probe.status === 0 ? probe.stdout.trim() : ''
      resolvedShell = found.startsWith('/') ? found : true
    }
  }
  return resolvedShell
}

export interface ShellProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  /** Aborting tears down the whole process group. */
  signal?: AbortSignal
  onStdout: (chunk: Buffer) => void
  onStderr: (chunk: Buffer) => void
}

export interface ShellExit {
  /** Exit code; `null` when the shell died from a signal. */
  code: number | null
  signal: NodeJS.Signals | null
  /** The output cap was exceeded and the process group was killed. */
  overflowed: boolean
  /** Set when the launch failed or a post-spawn error occurred (no exit code follows). */
  error?: Error
}

export interface ShellProcess {
  pid: number | undefined
  /** Signal the whole process group: SIGTERM now, SIGKILL after a grace period. */
  kill: () => void
  /** Settles once the shell has exited and both output streams have ended. */
  exited: Promise<ShellExit>
}

/**
 * Start `command` through the shell from `resolveShell()` in its own process
 * group. On abort (caller signal or timeout) or `kill()` the entire group is
 * signalled so compound commands can't orphan grandchildren on the host —
 * `child_process.exec`'s `signal` option kills only the shell itself, leaving
 * e.g. backgrounded dev servers alive.
 *
 * Never throws: spawn failures surface as an `error` on {@link ShellExit}.
 */
export function launchShell(command: string, opts: ShellProcessOptions): ShellProcess {
  const child = spawn(command, {
    cwd: opts.cwd,
    env: opts.env,
    shell: resolveShell(),
    // POSIX: lead a new process group so abort can signal the whole
    // tree via `process.kill(-pid)`. No-op grouping on Windows.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let overflowed = false
  let settled = false
  let total = 0

  const killTree = (sig: NodeJS.Signals): void => {
    if (child.pid === undefined) { return }
    try {
      // Negative pid → signal the process group (POSIX).
      process.kill(-child.pid, sig)
    }
    catch {
      try {
        child.kill(sig)
      }
      catch {
        // Already gone.
      }
    }
  }

  const kill = (): void => {
    killTree('SIGTERM')
    setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS).unref()
  }

  const exited = new Promise<ShellExit>((resolve) => {
    const settle = (exit: ShellExit): void => {
      if (settled) { return }
      settled = true
      // A pending SIGKILL stays armed: a group member that ignores SIGTERM
      // and holds none of the shell's pipes outlives the shell's exit.
      opts.signal?.removeEventListener('abort', kill)
      resolve(exit)
    }

    if (opts.signal?.aborted) {
      kill()
    }
    else {
      opts.signal?.addEventListener('abort', kill, { once: true })
    }

    const onData = (chunk: Buffer, deliver: (chunk: Buffer) => void): void => {
      deliver(chunk)
      total += chunk.byteLength
      if (!overflowed && total > MAX_OUTPUT_BYTES) {
        overflowed = true
        killTree('SIGTERM')
      }
    }
    child.stdout.on('data', (chunk: Buffer) => onData(chunk, opts.onStdout))
    child.stderr.on('data', (chunk: Buffer) => onData(chunk, opts.onStderr))

    child.once('error', (error) => {
      // Spawn failure (no 'close' will follow) or post-spawn kill error.
      killTree('SIGTERM')
      settle({ code: null, signal: null, overflowed, error })
    })

    child.once('close', (code, signal) => {
      settle({ code, signal, overflowed })
    })
  })

  return { pid: child.pid, kill, exited }
}
