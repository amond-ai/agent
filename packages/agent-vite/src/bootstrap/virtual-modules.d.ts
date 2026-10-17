/**
 * Ambient types for amond's virtual modules. The `amond()` plugin resolves
 * these inside the application's Vite graph:
 *
 * - `virtual:amond/app`    → the user's app entry (`app.ts` default export)
 * - `virtual:amond/db`     → the user's `db.ts` default export, or `undefined`
 * - `virtual:amond/agents` → the scanned `'use agent'` module set
 * - `virtual:amond/server` → the Node bootstrap (src/bootstrap/node-server.ts)
 * - `virtual:amond/providers` → provider registration generated from config
 */

declare module 'virtual:amond/app' {
  /** The user's app.ts default export — anything with a Fetch handler. */
  const app: { fetch(request: Request, env?: unknown): Response | Promise<Response> }
  export default app
}

declare module 'virtual:amond/db' {
  /** The user's db.ts default export, or `undefined` when no db entry exists. */
  const adapter: unknown
  export default adapter
}

declare module 'virtual:amond/agents' {
  export interface ScannedAgent {
    /** Agent identity (exported function name or `agentName` override); keys durable storage. */
    readonly identity: string
    /** The agent function (the module's evaluated export). */
    readonly agent: unknown
  }
  /** Scanned `'use agent'` agents, path-ordered. */
  export const scannedAgents: readonly ScannedAgent[]
}

declare module 'virtual:amond/providers' {
  // Side-effect module: registers the configured (or default) provider set.
}

declare module 'virtual:amond/server' {
  import type { AmondNodeServer, StartAmondNodeServerOptions } from './node-server.ts'

  export function startAmondNodeServer(
    options?: StartAmondNodeServerOptions,
  ): Promise<AmondNodeServer>
}
