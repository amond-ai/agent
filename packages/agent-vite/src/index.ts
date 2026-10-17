/**
 * `@amond-ai/agent-vite` — the Vite plugin that makes a Vite project an amond app.
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { amond } from '@amond-ai/agent-vite';
 * export default defineConfig({ plugins: [amond()] });
 * ```
 *
 * See plans/2026-07-02-vite-plugin-explicit-routing-redesign.md. Targets:
 * Node (`amond()` alone) and Cloudflare (`amond()` before a sibling
 * `cloudflare({ config: amondWorkerConfig() })` from `@cloudflare/vite-plugin`).
 *
 * The `'use agent'` scanner (`scanAgents` and friends in `agent-scan.ts`) is
 * deliberately not public API: its only consumers are this plugin and the
 * package's own tests. A tooling-facing scan API can ship on purpose later.
 */
export type { AgentScanResult } from './agent-scan.ts'
export type { AmondWorkerConfigCustomizer } from './cloudflare-worker-config.ts'
export { amondWorkerConfig } from './cloudflare-worker-config.ts'
export type { AmondResolvedProjectInfo, AmondVitePluginApi } from './amond-plugin.ts'
export { amond } from './amond-plugin.ts'
export type {
  AmondNodeActivityLease,
  AmondNodeServer,
  LoadAmondNodeApplicationOptions,
  LoadedAmondNodeApplication,
  StartAmondNodeServerOptions,
} from './types.ts'
