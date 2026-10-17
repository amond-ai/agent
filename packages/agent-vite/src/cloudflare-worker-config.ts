/**
 * amond's Cloudflare worker configuration — the `amondWorkerConfig()`
 * customizer the user passes to the sibling `@cloudflare/vite-plugin`:
 *
 * ```ts
 * // vite.config.ts
 * import { cloudflare } from '@cloudflare/vite-plugin';
 * import { amond, amondWorkerConfig } from '@amond-ai/agent-vite';
 * export default defineConfig({
 *   plugins: [amond(), cloudflare({ config: amondWorkerConfig() })],
 * });
 * ```
 *
 * The sibling plugin owns the wrangler config end to end: it reads the
 * user's authored `wrangler.jsonc` (its `configPath`), resolves the active
 * Cloudflare environment, invokes this customizer on the resolved config,
 * and emits the merged deploy config into the build output. amond never
 * reads, merges, or writes a wrangler config file. The customizer
 * contributes only what amond derives at config-resolution time:
 *
 *   - `main` → `virtual:amond/worker`, the generated Worker entry served by
 *     the `amond()` plugin (left alone when the user set their own `main`);
 *   - one Durable Object binding per scanned `'use agent'` agent;
 *   - the `nodejs_compat` compatibility flag (unioned in);
 *   - validation of a user-set `compatibility_date` against amond's floor.
 *
 * Everything else — user Durable Object bindings, containers, R2 buckets,
 * and the complete migration history — belongs to the user's own
 * `wrangler.jsonc` and passes through untouched (adding an agent = file +
 * mount + migration tag).
 *
 * Linkage: `vite.config.ts` is re-evaluated per Vite config resolution, so
 * `amond()` and `amondWorkerConfig()` are fresh instances each resolution.
 * `amond()` registers its state synchronously at creation;
 * `amondWorkerConfig()` captures that state at creation. The customizer runs
 * inside the sibling's `config` hook — after amond's, which is why `amond()`
 * must precede `cloudflare()` in the plugin array — and reads the completed
 * agent scan from the captured state. Because each customizer is bound to
 * its own `amond()` instance, concurrent Vite servers in one process never
 * cross-talk.
 */
import { stackless } from './diagnostics.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_COMPATIBILITY_DATE = '2026-04-01'

/** compatibility_flag amond requires for pi-ai's process.env-based API key lookup. */
const REQUIRED_COMPAT_FLAG = 'nodejs_compat'

/** The virtual Worker entry `main` points at (served by the amond() plugin). */
export const VIRTUAL_WORKER_ENTRY = 'virtual:amond/worker'

// ─── State linkage ──────────────────────────────────────────────────────────

/** An amond-owned generated DO binding. */
interface AmondDoBinding {
  readonly name: string
  readonly class_name: string
}

/**
 * The narrow view of `amond()`'s plugin state the customizer needs. The
 * `amond()` config hook keeps these current; the customizer reads them and
 * reports back through `customizerInvoked`.
 */
export interface AmondWorkerConfigSource {
  /** True once amond()'s `config` hook has resolved the project for this resolution. */
  configReady: boolean
  /** Preview serves built artifacts; the customizer must not touch the config. */
  isPreview: boolean
  /** The scanned per-agent Durable Object bindings. */
  readonly doBindings: readonly AmondDoBinding[]
  /** Set by the customizer so `configResolved` can diagnose missing wiring. */
  customizerInvoked: boolean
}

let latestSource: AmondWorkerConfigSource | undefined

/** Called synchronously by `amond()` at plugin creation. */
export function registerAmondWorkerConfigSource(source: AmondWorkerConfigSource): void {
  latestSource = source
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * amond's worker-config customizer, compatible with the sibling plugin's
 * `cloudflare({ config })` option. The parameter is typed structurally
 * (`object`) because `@amond-ai/agent-vite` deliberately has no dependency on
 * `@cloudflare/vite-plugin`; the sibling passes its resolved `WorkerConfig`.
 */
export type AmondWorkerConfigCustomizer = (config: object) => void

/**
 * Create the worker-config customizer for the `amond()` instance created in
 * the same `vite.config.ts` evaluation. Must be called after `amond()`.
 */
export function amondWorkerConfig(): AmondWorkerConfigCustomizer {
  // One-shot capture: consuming the slot means an amondWorkerConfig() created
  // before its amond() always hits the clear error below — even in a warm
  // process where a previous resolution's registration would otherwise
  // linger in the module scope and be captured silently.
  const source = latestSource
  latestSource = undefined
  if (!source) {
    throw stackless(
      new Error(
        '[amond] amondWorkerConfig() was called before amond(). Create the amond() plugin first ' +
        'in the same Vite config:\n\n' +
        '  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })]\n',
      ),
    )
  }
  return (config: object) => {
    source.customizerInvoked = true
    // Preview serves the already-built Worker output; its config is the
    // emitted deploy config and must pass through untouched.
    if (source.isPreview) { return }
    if (!source.configReady) {
      // The linked amond() never took the Cloudflare config path in this
      // resolution — its hook hasn't run yet (plugin ordering), or it
      // configured the Node target (explicit `target: 'node'`, or the
      // cloudflare() plugin was not visible as a plain plugins entry).
      throw stackless(
        new Error(
          '[amond] amondWorkerConfig() ran before amond() configured the Cloudflare target. ' +
          'Ensure amond() precedes cloudflare() as plain entries of the same `plugins` array ' +
          '(not wrapped in a Promise or added by another plugin), and that amond\'s `target` ' +
          'is not forced to \'node\':\n\n' +
          '  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })]\n',
        ),
      )
    }
    applyAmondWorkerConfig(config as Record<string, unknown>, source.doBindings)
  }
}

/**
 * Diagnostic shared with the plugin's own ordering checks: the customizer
 * runs inside the sibling's `config` hook, so amond's hook (project
 * resolution + agent scan) must have run first.
 */
export function cloudflareOrderingError(): Error {
  return stackless(
    new Error(
      '[amond] amond() must come before cloudflare() in the Vite plugins array. ' +
      'The Cloudflare plugin invokes amondWorkerConfig() while Vite resolves the config, and ' +
      'amond() must have scanned the project first. Reorder:\n\n' +
      '  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })]\n',
    ),
  )
}

// ─── Customizer body ────────────────────────────────────────────────────────

/**
 * Mutate the sibling's resolved worker config in place. The sibling resolves
 * the active Cloudflare environment (`CLOUDFLARE_ENV`) before invoking the
 * customizer, so this always sees — and every contribution lands in — the
 * effective config for the environment actually being built or served.
 */
function applyAmondWorkerConfig(
  config: Record<string, unknown>,
  doBindings: readonly AmondDoBinding[],
): void {
  validateCompatibilityDate(config)

  // compatibility_flags: union in nodejs_compat. The deploy artifact is the
  // sibling-emitted merged config, so the union is always effective; the
  // user's authored file no longer needs to carry the flag itself.
  const flags = Array.isArray(config.compatibility_flags)
    ? (config.compatibility_flags as unknown[]).filter((f): f is string => typeof f === 'string')
    : []
  if (!flags.includes(REQUIRED_COMPAT_FLAG)) { flags.push(REQUIRED_COMPAT_FLAG) }
  config.compatibility_flags = flags

  // main: default to the generated virtual Worker entry. A user-set main is
  // respected — it owns the Worker entry and can re-export the generated
  // module (`export * from 'virtual:amond/worker'` for the Durable Object
  // classes) while composing its own default handler.
  if (typeof config.main !== 'string' || config.main.length === 0) {
    config.main = VIRTUAL_WORKER_ENTRY
  }

  mergeDurableObjectBindings(config, doBindings)

  // compatibility_date and name are left to the sibling's own defaults when
  // unset (its date default tracks the workerd version it bundles, which is
  // strictly better than an amond-pinned floor). containers, migrations, and
  // every other field pass through untouched.
}

/**
 * Enforce amond's compatibility_date floor on a user-set value. We're
 * intentionally strict rather than silently bumping the date — the failure
 * modes of an old date (missing SQLite DO support, nodejs_compat v2,
 * AsyncLocalStorage) produce confusing runtime errors, and a user pins a
 * date deliberately.
 */
function validateCompatibilityDate(config: Record<string, unknown>): void {
  if (typeof config.compatibility_date !== 'string') { return }
  const userDate = config.compatibility_date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(userDate)) {
    throw stackless(
      new Error(
        `[amond] Your wrangler config's "compatibility_date" ("${userDate}") is not in YYYY-MM-DD format.`,
      ),
    )
  }
  if (userDate < MIN_COMPATIBILITY_DATE) {
    throw stackless(
      new Error(
        `[amond] Your wrangler config's "compatibility_date" is "${userDate}". ` +
        `amond requires at least "${MIN_COMPATIBILITY_DATE}" for SQLite-backed Durable Object support, nodejs_compat v2, and AsyncLocalStorage. ` +
        `Bump the date (set it to today unless you have a specific reason).`,
      ),
    )
  }
}

/**
 * Add amond's generated per-agent DO bindings, validating that any user
 * binding occupying an amond-reserved name is exactly the binding amond would
 * generate (harmless duplication) rather than a conflicting redirection.
 */
function mergeDurableObjectBindings(
  config: Record<string, unknown>,
  doBindings: readonly AmondDoBinding[],
): void {
  const existingDo =
    typeof config.durable_objects === 'object' && config.durable_objects !== null
      ? (config.durable_objects as Record<string, unknown>)
      : {}
  const existingBindings = Array.isArray(existingDo.bindings)
    ? (existingDo.bindings as unknown[]).filter(
        (b): b is Record<string, unknown> => typeof b === 'object' && b !== null,
      )
    : []
  const existingByName = new Map(
    existingBindings.filter(b => typeof b.name === 'string').map(b => [b.name as string, b]),
  )
  for (const binding of doBindings) {
    const existing = existingByName.get(binding.name)
    if (!existing) { continue }
    if (
      existing.class_name !== binding.class_name ||
      existing.script_name !== undefined ||
      existing.environment !== undefined
    ) {
      throw stackless(
        new Error(
          `[amond] wrangler config durable object binding "${binding.name}" is reserved by amond. ` +
          `Expected a local class_name "${binding.class_name}" binding without script_name or environment.`,
        ),
      )
    }
  }
  const bindingsToAdd = doBindings
    .filter(binding => !existingByName.has(binding.name))
    .map(binding => ({ name: binding.name, class_name: binding.class_name }))
  config.durable_objects = {
    ...existingDo,
    bindings: [...existingBindings, ...bindingsToAdd],
  }
}
