/**
 * Provider contract suite for `Sandbox`: the behaviour every provider owes the
 * AI SDK sandbox session and the framework, run against each provider from its
 * own test file. Internal: not a build entry and not exported.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxDiedError } from '../errors.ts'
import type { OrphanedExecSettlement } from '../sandbox.ts'
import { createCwdSandbox } from '../sandbox.ts'
import { streamToBytes } from '../sandbox-streams.ts'
import type { Sandbox } from '../types.ts'

/** One provider instance under test, with the instruments its capabilities need. */
export interface SandboxContractSubject {
  sandbox: Sandbox
  /**
   * Deadlines the provider's native timeout received, in call order: the
   * provider SDK's timeout option, or the `AbortSignal.timeout` deadline for
   * providers that enforce `timeoutMs` with a signal. Required by `caps.nativeDeadline`.
   */
  nativeTimeouts?: () => ReadonlyArray<number | undefined>
  /** Settlements reported to `onOrphanSettled`. Required by `caps.orphanReporting`. */
  orphanSettlements?: () => ReadonlyArray<OrphanedExecSettlement>
  /** Make the sandbox die while a call is in flight. Required by `caps.deathDetection`. */
  killSandbox?: () => void
  cleanup?: () => void | Promise<void>
}

export interface SandboxContractCaps {
  /** The deadline `run` hands the provider is observable (AC-005). */
  nativeDeadline: boolean
  /** The provider reports orphaned commands to `onOrphanSettled` (AC-008). */
  orphanReporting: boolean
  /** The provider rejects in-flight calls with `SandboxDiedError` when it dies (AC-009). */
  deathDetection: boolean
}

export interface SandboxContractOptions {
  name: string
  make: () => Promise<SandboxContractSubject>
  caps: SandboxContractCaps
}

/** Long enough to outlast every assertion that expects a prompt settlement. */
const SLOW_COMMAND = 'sleep 1'
/** Bound on "promptly": well under {@link SLOW_COMMAND}'s duration. */
const PROMPT_MS = 500

type Outcome = { status: 'resolved', value: unknown } | { status: 'rejected', error: unknown } | { status: 'pending' }

/** Settle `promise` within `ms`, or report it still pending. */
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

const decoder = new TextDecoder()

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return decoder.decode(await streamToBytes(stream))
}

function instrument<T>(value: T | undefined, what: string): T {
  if (value === undefined) { throw new Error(`The contract subject must provide ${what}.`) }
  return value
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

export function defineSandboxContract({ name, make, caps }: SandboxContractOptions): void {
  describe(`${name} sandbox contract`, () => {
    let subject: SandboxContractSubject
    let sandbox: Sandbox

    beforeEach(async () => {
      subject = await make()
      sandbox = subject.sandbox
    })

    afterEach(async () => {
      await subject.cleanup?.()
    })

    describe('description', () => {
      it('names the working directory', () => {
        expect(sandbox.description).toContain(sandbox.cwd)
      })
    })

    describe('files', () => {
      it('reads a relative path against cwd (AC-002)', async () => {
        await sandbox.run({ command: 'printf hello > rel.txt' })

        await expect(sandbox.readTextFile({ path: 'rel.txt' })).resolves.toBe('hello')
        await expect(sandbox.readTextFile({ path: `${sandbox.cwd}/rel.txt` })).resolves.toBe('hello')
      })

      it('writes a relative path against cwd', async () => {
        await sandbox.writeTextFile({ path: 'written.txt', content: 'from the session' })

        const result = await sandbox.run({ command: 'cat written.txt' })
        expect(result.stdout).toBe('from the session')
      })

      it('resolves null for a missing file (AC-003)', async () => {
        await expect(sandbox.readTextFile({ path: 'missing.txt' })).resolves.toBeNull()
        await expect(sandbox.readBinaryFile({ path: 'missing.txt' })).resolves.toBeNull()
      })

      it('resolves null when a path component is a file', async () => {
        await sandbox.writeTextFile({ path: 'plain.txt', content: 'x' })

        await expect(sandbox.readTextFile({ path: 'plain.txt/child' })).resolves.toBeNull()
      })

      it('rejects, not null, when the path exists but cannot be read as a file', async () => {
        await sandbox.mkdir('a-directory', { recursive: true })

        await expect(sandbox.readTextFile({ path: 'a-directory' })).rejects.toBeDefined()
      })

      it('reads an existing empty file as "", not null', async () => {
        await sandbox.writeTextFile({ path: 'empty.txt', content: '' })

        await expect(sandbox.readTextFile({ path: 'empty.txt' })).resolves.toBe('')
        await expect(sandbox.readBinaryFile({ path: 'empty.txt' })).resolves.toEqual(new Uint8Array())
      })

      it('creates missing parent directories on write (AC-004)', async () => {
        await sandbox.writeTextFile({ path: 'deep/nested/file.txt', content: 'nested' })

        await expect(sandbox.readTextFile({ path: 'deep/nested/file.txt' })).resolves.toBe('nested')
      })

      it('round-trips bytes', async () => {
        const bytes = new Uint8Array([0, 1, 127, 128, 233, 255])
        await sandbox.writeBinaryFile({ path: 'bin/data.bin', content: bytes })

        await expect(sandbox.readBinaryFile({ path: 'bin/data.bin' })).resolves.toEqual(bytes)
      })

      it('reads 1-based inclusive line ranges', async () => {
        await sandbox.writeTextFile({ path: 'lines.txt', content: 'one\ntwo\nthree\nfour\n' })

        await expect(sandbox.readTextFile({ path: 'lines.txt', startLine: 2, endLine: 3 })).resolves.toBe('two\nthree')
        await expect(sandbox.readTextFile({ path: 'lines.txt', startLine: 3, endLine: 99 })).resolves.toBe('three\nfour\n')
        await expect(sandbox.readTextFile({ path: 'lines.txt', startLine: 9 })).resolves.toBe('')
      })

      it('decodes with the requested encoding', async () => {
        await sandbox.writeBinaryFile({ path: 'latin1.txt', content: new Uint8Array([0x63, 0x61, 0x66, 0xE9]) })

        await expect(sandbox.readTextFile({ path: 'latin1.txt', encoding: 'latin1' })).resolves.toBe('café')
      })
    })

    describe('run', () => {
      it('returns stdout, stderr, and the exit code', async () => {
        const result = await sandbox.run({ command: 'echo out; echo err >&2; exit 3' })

        expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 })
      })

      it('runs in cwd and resolves a relative workingDirectory against it', async () => {
        await sandbox.mkdir('sub', { recursive: true })

        expect((await sandbox.run({ command: 'pwd' })).stdout.trim()).toBe(sandbox.cwd)
        expect((await sandbox.run({ command: 'pwd', workingDirectory: 'sub' })).stdout.trim()).toBe(
          `${sandbox.cwd}/sub`,
        )
      })

      it('passes env to the command', async () => {
        const result = await sandbox.run({ command: 'printf "$CONTRACT_VAR"', env: { CONTRACT_VAR: 'set' } })

        expect(result.stdout).toBe('set')
      })

      it.runIf(caps.nativeDeadline)('hands a fractional timeoutMs to the native deadline rounded up (AC-005)', async () => {
        const nativeTimeouts = instrument(subject.nativeTimeouts, 'nativeTimeouts')

        await sandbox.run({ command: 'true', timeoutMs: 1500.4 })

        expect(nativeTimeouts().at(-1)).toBe(1501)
      })

      it('rejects a pre-aborted call without executing it (AC-006)', async () => {
        await expect(
          sandbox.run({ command: 'printf x > marker.txt', abortSignal: abortedSignal() }),
        ).rejects.toMatchObject({ name: 'AbortError' })

        await expect(sandbox.readTextFile({ path: 'marker.txt' })).resolves.toBeNull()
      })

      it('rejects promptly with an AbortError on a mid-flight abort (AC-007)', async () => {
        const controller = new AbortController()
        const running = sandbox.run({ command: SLOW_COMMAND, abortSignal: controller.signal })
        setTimeout(() => controller.abort(), 30)

        const outcome = await settleWithin(running, PROMPT_MS)

        expect(outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } })
      })

      it.runIf(caps.orphanReporting)('reports the aborted command\'s later settlement to onOrphanSettled (AC-008)', async () => {
        const orphanSettlements = instrument(subject.orphanSettlements, 'orphanSettlements')
        const controller = new AbortController()
        const command = 'sleep 0.2; echo finished'
        const running = sandbox.run({ command, abortSignal: controller.signal })
        setTimeout(() => controller.abort(), 30)

        await expect(running).rejects.toMatchObject({ name: 'AbortError' })
        expect(orphanSettlements()).toHaveLength(0)

        await expect.poll(() => orphanSettlements().length, { timeout: 2000 }).toBe(1)
        const [settlement] = orphanSettlements()
        expect(settlement).toMatchObject({ command, result: { stdout: 'finished\n', exitCode: 0 } })
        expect(settlement!.settledAt.getTime()).toBeGreaterThanOrEqual(settlement!.abortedAt.getTime())
      })

      it.runIf(caps.deathDetection)('rejects with SandboxDiedError when the sandbox dies mid-run (AC-009)', async () => {
        const killSandbox = instrument(subject.killSandbox, 'killSandbox')
        const running = sandbox.run({ command: SLOW_COMMAND })
        setTimeout(killSandbox, 20)

        const outcome = await settleWithin(running, PROMPT_MS)

        expect(outcome.status).toBe('rejected')
        expect((outcome as { error: unknown }).error).toBeInstanceOf(SandboxDiedError)
      })
    })

    describe('spawn', () => {
      it('delivers the full stdout and stderr and resolves wait() with the exit code (AC-011, AC-012)', async () => {
        const proc = await sandbox.spawn({ command: 'echo out; echo more; echo err >&2; exit 4' })

        const [stdout, stderr, exit] = await Promise.all([
          streamText(proc.stdout),
          streamText(proc.stderr),
          proc.wait(),
        ])

        expect(stdout).toBe('out\nmore\n')
        expect(stderr).toBe('err\n')
        expect(exit).toEqual({ exitCode: 4 })
      })

      it('honours workingDirectory and env', async () => {
        await sandbox.mkdir('spawn-dir', { recursive: true })
        const proc = await sandbox.spawn({
          command: 'printf "%s:%s" "$PWD" "$CONTRACT_VAR"',
          workingDirectory: 'spawn-dir',
          env: { CONTRACT_VAR: 'v' },
        })

        expect(await streamText(proc.stdout)).toBe(`${sandbox.cwd}/spawn-dir:v`)
        await expect(proc.wait()).resolves.toEqual({ exitCode: 0 })
      })

      it('rejects a pre-aborted call without executing it', async () => {
        await expect(
          sandbox.spawn({ command: 'printf x > spawn-marker.txt', abortSignal: abortedSignal() }),
        ).rejects.toMatchObject({ name: 'AbortError' })

        await expect(sandbox.readTextFile({ path: 'spawn-marker.txt' })).resolves.toBeNull()
      })

      it('settles wait() when kill() is called (AC-013)', async () => {
        const proc = await sandbox.spawn({ command: SLOW_COMMAND })

        await proc.kill()
        const outcome = await settleWithin(proc.wait(), PROMPT_MS)

        expect(outcome.status).not.toBe('pending')
      })

      it('rejects wait() and errors the streams with an AbortError on a caller abort', async () => {
        const controller = new AbortController()
        const proc = await sandbox.spawn({ command: SLOW_COMMAND, abortSignal: controller.signal })
        setTimeout(() => controller.abort(), 30)

        const outcome = await settleWithin(proc.wait(), PROMPT_MS)

        expect(outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } })
        await expect(streamText(proc.stdout)).rejects.toMatchObject({ name: 'AbortError' })
      })
    })

    describe('createCwdSandbox', () => {
      it('runs commands and resolves workingDirectory and file paths against its own cwd', async () => {
        await sandbox.mkdir('scope/inner', { recursive: true })
        const scoped = createCwdSandbox(sandbox, sandbox.resolvePath('scope'))

        expect(scoped.cwd).toBe(`${sandbox.cwd}/scope`)
        expect(scoped.description).toContain(scoped.cwd)
        expect((await scoped.run({ command: 'pwd' })).stdout.trim()).toBe(scoped.cwd)
        expect((await scoped.run({ command: 'pwd', workingDirectory: 'inner' })).stdout.trim()).toBe(
          `${scoped.cwd}/inner`,
        )

        const proc = await scoped.spawn({ command: 'pwd', workingDirectory: 'inner' })
        expect((await streamText(proc.stdout)).trim()).toBe(`${scoped.cwd}/inner`)

        await scoped.writeTextFile({ path: 'scoped.txt', content: 'text' })
        await scoped.writeBinaryFile({ path: 'scoped.bin', content: new Uint8Array([7]) })
        await expect(sandbox.readTextFile({ path: 'scope/scoped.txt' })).resolves.toBe('text')
        await expect(scoped.readTextFile({ path: 'scoped.txt' })).resolves.toBe('text')
        await expect(scoped.readBinaryFile({ path: 'scoped.bin' })).resolves.toEqual(new Uint8Array([7]))
        await expect(scoped.readTextFile({ path: 'missing.txt' })).resolves.toBeNull()
      })
    })
  })
}
