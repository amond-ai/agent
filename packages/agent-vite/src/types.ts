/**
 * Public-facing types for `@amond-ai/agent-vite`. Types that are part of the package's
 * public surface live here (or are re-exported from here when they naturally
 * belong next to an implementation), and `index.ts` re-exports them.
 *
 * This module must stay implementation-free: it is what the published
 * `index.d.mts` pulls in, so nothing here may import modules with runtime
 * side effects (in particular `virtual:amond/*`, which only resolves inside a
 * Vite graph running the amond() plugin).
 */

// ─── The Node build artifact's surface ──────────────────────────────────────
// `dist/app.mjs` exports `loadAmondNodeApplication`/`startAmondNodeServer`
// (implemented in bootstrap/node-server.ts); these are their parameter and
// return types. Hosts load the values from the artifact and take the types
// from `@amond-ai/agent-vite`.

export interface LoadAmondNodeApplicationOptions {
  /** Local (dev) mode: dev error rendering, dev SQLite file, lifecycle logs. */
  local?: boolean
  /** Environment for the runtime; defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

/** An activity lease marking an in-flight request; release it when the request settles. */
export interface AmondNodeActivityLease {
  release(): void
}

/** The loaded application's lifecycle surface (admission, drain, shutdown). */
export interface LoadedAmondNodeApplication {
  fetch(request: Request, env?: unknown): Response | Promise<Response>
  /** Take an activity lease marking an in-flight request; `pauseAdmissions()` rejects new leases. */
  enterActivity(): AmondNodeActivityLease
  /** Stop admitting new durable work (drain phase). */
  pauseAdmissions(): void
  /** Graceful shutdown: coordinator, instrumentation, persistence. */
  stop(timeoutMs?: number): Promise<void>
  /** Synchronous best-effort teardown for abnormal exits. */
  closeSync(): void
}

export interface StartAmondNodeServerOptions extends LoadAmondNodeApplicationOptions {
  port?: number
  hostname?: string
  quiet?: boolean
  signal?: AbortSignal
  onReady?: () => void
}

export interface AmondNodeServer {
  stop(): Promise<void>
  closeSync(): void
}
