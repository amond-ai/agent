/**
 * The Claude Code harness adapter.
 *
 * It is a translation and nothing more: `@amond-ai/harness-claude-code` already owns the turn
 * loop, the bridge socket and the journal, so this package maps an `AgentManifest`'s tools and
 * instructions onto a `TurnDriver` run and maps the driver's result back to a `TurnOutcome`.
 * Everything platform-shaped — which sandbox, how to open a socket — stays injected, exactly
 * as the driver requires.
 */
import type { HarnessAdapter } from '@amond-ai/agent-core'

export interface ClaudeCodeOptions {
  /** The model the turn runs on. */
  readonly model: string
}

/**
 * _TODO: implement against `turnDriver` once the manifest-to-turn mapping is settled._
 *
 * Deliberately unimplemented rather than stubbed with a plausible body: a fake that returns a
 * shaped result would pass a test suite while proving nothing about the seam.
 */
export function claudeCode(_options: ClaudeCodeOptions): HarnessAdapter {
  throw new Error('not implemented')
}
