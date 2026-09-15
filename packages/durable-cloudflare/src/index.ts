/**
 * Cloudflare Workflows behind the durable contract.
 *
 * The first production adapter, and first for reasons ADR-0002 records: Workflows is GA, runs
 * for 365 days on a paid plan, and costs about $0.10 per million steps against $25 on the
 * nearest comparable. A session's `SessionStep` becomes a `step.do()`, and a `wait` outcome
 * becomes the workflow waiting on an event rather than this package polling anything.
 */
import type { DurableRuntime } from '@amond-ai/agent-durable'

export interface CloudflareRuntimeOptions {
  /** The Workflow binding from the Worker's env. Typed loosely so this package does not pin workers-types. */
  readonly workflow: unknown
}

/**
 * _TODO: implement over the Workflow binding once the contract has survived a second adapter._
 *
 * Left unimplemented rather than approximated: an adapter that silently loses the durability
 * guarantee is worse than one that is absent, because the failure only shows up in production
 * after a session has already been dropped.
 */
export function createCloudflareRuntime(_options: CloudflareRuntimeOptions): DurableRuntime {
  throw new Error('not implemented')
}
