/**
 * Node-specific entry point for `@amond-ai/agent`. Exports the `local()`
 * sandbox factory for use in `useSandbox(local(...))`,
 * and the built-in `sqlite()` persistence adapter.
 *
 * Import platform-agnostic types (`AmondEventContext`, `PersistenceAdapter`, etc.)
 * from `@amond-ai/agent`.
 */
export { sqlite } from './agent-execution-store.ts'
export { local, type LocalSandboxOptions } from './local.ts'
export {
  type Amond,
  start,
  type StartAgentConfig,
  type StartAgentEntry,
  type StartOptions,
} from './start.ts'
