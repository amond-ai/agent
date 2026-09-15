/**
 * A second harness adapter, kept unpublished on purpose.
 *
 * ADR-0001 makes the harness an explicit choice, which only means something if the seam holds
 * for more than one harness. An interface written against a single implementation takes that
 * implementation's shape and breaks when the second arrives. This package exists to make that
 * pressure real before 1.0 — it is a spike, not a product, and `private: true` keeps it off the
 * registry until it is one.
 */
import type { HarnessAdapter } from '@amond-ai/agent-core'

export interface CodexOptions {
  readonly model: string
}

/** _TODO: spike only — implement far enough to prove the seam, then decide whether to ship it._ */
export function codex(_options: CodexOptions): HarnessAdapter {
  throw new Error('not implemented')
}
