/**
 * `@amond-ai/agent/config` — the host-independent amond project configuration.
 *
 * `amond.config.ts` describes an amond *project* (not a deployment host): which
 * target it builds for, where its entry modules live, and which files the
 * `'use agent'` scan covers. Both hosts consume it:
 *
 *   - the `@amond-ai/agent-vite` plugin auto-discovers it (inline `amond(config)` values
 *     merged over the file via {@link mergeAmondConfig}), and
 *   - `amond run <path>` reads it directly.
 *
 * This module is host-side tooling (it touches the filesystem); import it
 * from build/CLI code, never from agent modules.
 *
 * Config-module evaluation: {@link loadAmondConfig} evaluates the config file
 * with the host's native dynamic `import()`, which handles plain JS, ESM, and
 * TypeScript via Node's type-stripping (Node ≥ 22.18 / ≥ 23.6). A host with
 * its own module loader (e.g. a Vite plugin evaluating through the module
 * runner, or one that must honor TS syntax that type-stripping rejects) can
 * instead evaluate the module itself and validate the raw default export with
 * {@link parseAmondConfig}.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as v from 'valibot'

// ─── Authoring API ──────────────────────────────────────────────────────────

/**
 * Configuration authored in `amond.config.ts`. Only the fields declared by
 * this interface are accepted.
 */
export interface AmondConfig {
  /**
   * Build and development target.
   *
   * - `'node'` builds a Node.js server.
   * - `'cloudflare'` builds a Workers-compatible application.
   *
   * Optional: the Vite plugin auto-detects `'cloudflare'` from the presence
   * of the `@cloudflare/vite-plugin` sibling when unset; `amond run` is
   * always Node-local.
   */
  target?: 'node' | 'cloudflare'
  /**
   * Path to the application entry (`app.ts`), the project's route map.
   * Relative values resolve from the config file's directory. Defaults to
   * the source-root lookup (see {@link resolveSourceRoot} and
   * {@link discoverProjectEntry}). The resolved file must exist — an
   * explicit path that doesn't is an error.
   */
  app?: string
  /**
   * Path to the persistence entry (`db.ts`); Node hosts only. Same
   * resolution rules as {@link AmondConfig.app}.
   */
  db?: string
  /**
   * Path to the non-HTTP Cloudflare handlers entry (`cloudflare.ts`). Same
   * resolution rules as {@link AmondConfig.app}.
   */
  cloudflare?: string
  /**
   * Glob narrowing the `'use agent'` scan, relative to the source root
   * (`.amond/`, `src/`, or the project root — whichever resolves). Defaults
   * to the whole source root, recursively. Passed through verbatim for the
   * scanner to interpret.
   */
  agents?: string
  /**
   * Built-in pi-ai providers registered at server start, by provider ID
   * (`['anthropic', 'openai']`). Each entry maps to a
   * `@earendil-works/pi-ai/providers/<id>` factory import in the generated
   * entry, so only the listed providers ship in the build. Omitted registers
   * every built-in provider. Custom providers are unaffected — register
   * those with `setProvider()` in `app.ts`.
   */
  providers?: string[]
  /**
   * Cloudflare target only: whether the generated Worker entry installs
   * Cloudflare tracing by default. Defaults to `true` — deployed agents are
   * pre-instrumented, and spans flow once Workers Traces is enabled on the
   * account (wrangler `observability.traces` or the dashboard). `false`
   * omits the default from the build entirely; an explicit
   * `instrument(createCloudflareTracing(...))` in `app.ts` is unaffected
   * (and always takes precedence over the default when both are present).
   */
  tracing?: boolean
}

/**
 * Provides type checking and editor completion for `amond.config.ts`. Returns
 * the configuration unchanged.
 *
 * ```ts
 * import { defineConfig } from '@amond-ai/agent/config';
 *
 * export default defineConfig({
 *   target: 'node',
 * });
 * ```
 */
export function defineConfig(config: AmondConfig): AmondConfig {
  return config
}

// ─── Validation ─────────────────────────────────────────────────────────────

const NonEmptyPathSchema = v.pipe(v.string(), v.minLength(1, 'Path must not be empty.'))

const ProviderIdSchema = v.pipe(
  v.string(),
  // Provider IDs become `@earendil-works/pi-ai/providers/<id>` import
  // specifiers in generated code; reject anything that couldn't be one.
  v.regex(/^[a-z0-9][a-z0-9-]*$/, 'Provider IDs are lowercase alphanumerics and dashes.'),
)

const AmondConfigSchema = v.strictObject({
  target: v.optional(v.picklist(['node', 'cloudflare'] as const)),
  app: v.optional(NonEmptyPathSchema),
  db: v.optional(NonEmptyPathSchema),
  cloudflare: v.optional(NonEmptyPathSchema),
  agents: v.optional(NonEmptyPathSchema),
  providers: v.optional(v.array(ProviderIdSchema)),
  tracing: v.optional(v.boolean()),
})

/**
 * Validate a raw config value (a config module's default export, or inline
 * plugin options). Throws with per-field diagnostics naming `source`
 * (a config-file path, `"inline options"`, …).
 */
export function parseAmondConfig(value: unknown, source = 'amond config'): AmondConfig {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[amond] ${source} must be a config object.`)
  }
  const result = v.safeParse(AmondConfigSchema, value)
  if (!result.success) {
    const lines = [`[amond] Invalid config in ${source}:`]
    for (const issue of result.issues) {
      const dotPath = v.getDotPath(issue)
      lines.push(dotPath ? `  • ${dotPath}: ${issue.message}` : `  • ${issue.message}`)
    }
    throw new Error(lines.join('\n'))
  }
  return result.output
}

/**
 * Merge inline (host-provided) config over a discovered file config,
 * per-field. `undefined` inline fields fall through to the file value.
 */
export function mergeAmondConfig(file: AmondConfig, inline: AmondConfig): AmondConfig {
  return {
    target: inline.target ?? file.target,
    app: inline.app ?? file.app,
    db: inline.db ?? file.db,
    cloudflare: inline.cloudflare ?? file.cloudflare,
    agents: inline.agents ?? file.agents,
    providers: inline.providers ?? file.providers,
    tracing: inline.tracing ?? file.tracing,
  }
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Config file basenames searched, in priority order. TypeScript first because
 * amond's audience writes TS agents; the rest mirror Vite's supported set.
 */
export const AMOND_CONFIG_BASENAMES = Object.freeze([
  'amond.config.ts',
  'amond.config.mts',
  'amond.config.mjs',
  'amond.config.js',
  'amond.config.cjs',
  'amond.config.cts',
])

export interface ResolveAmondConfigPathOptions {
  /** Directory to search for `amond.config.*`, and base for `configFile`. */
  cwd: string
  /** Explicit config-file path (relative to `cwd`, or absolute). */
  configFile?: string
}

/**
 * Resolve the absolute path of the project's `amond.config.*` file, or
 * `undefined` when none exists and none was asked for.
 *
 * Throws if `configFile` is an explicit path that doesn't exist on disk —
 * that's a typo, not a "config not configured" situation.
 */
export function resolveAmondConfigPath(opts: ResolveAmondConfigPathOptions): string | undefined {
  const cwd = path.resolve(opts.cwd)
  if (opts.configFile) {
    const explicit = path.resolve(cwd, opts.configFile)
    if (!fs.existsSync(explicit)) {
      throw new Error(`[amond] Config file not found: ${opts.configFile}`)
    }
    return explicit
  }

  for (const basename of AMOND_CONFIG_BASENAMES) {
    const candidate = path.join(cwd, basename)
    if (fs.existsSync(candidate)) { return candidate }
  }
  return undefined
}

// ─── Loading ────────────────────────────────────────────────────────────────

export interface LoadedAmondConfig {
  /** Absolute path of the loaded config file, or `undefined` if none. */
  configPath: string | undefined
  /** The validated config ({} when no config file exists). */
  config: AmondConfig
}

/**
 * Discover, evaluate, and validate the project's `amond.config.*`.
 *
 * Evaluation uses the host's native dynamic `import()`: plain JS, ESM, and
 * TypeScript via Node's type-stripping (Node ≥ 22.18 / ≥ 23.6 enable this by
 * default). Hosts with their own module loader should evaluate the file
 * themselves and validate with {@link parseAmondConfig} instead.
 *
 * Cache-busts via a query param so repeated loads (e.g. a dev-server config
 * watcher) get a fresh module instead of the cached one.
 */
export async function loadAmondConfig(
  opts: ResolveAmondConfigPathOptions,
): Promise<LoadedAmondConfig> {
  const configPath = resolveAmondConfigPath(opts)
  if (!configPath) { return { configPath: undefined, config: {} } }
  const configModule = await loadAmondConfigModule(configPath)
  const source = path.relative(path.resolve(opts.cwd), configPath) || configPath
  const raw = configModule.default
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`[amond] ${source} must export a config object as the default export.`)
  }
  return { configPath, config: parseAmondConfig(raw, source) }
}

/**
 * Load a config file's module namespace via native dynamic `import()`.
 * Errors that come out of strip-mode (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`)
 * are repackaged with a hint pointing at the constraint, since the original
 * Node message is terse.
 */
export async function loadAmondConfigModule(
  absConfigPath: string,
): Promise<Record<string, unknown>> {
  const fileUrl = `${pathToFileURL(absConfigPath).href}?t=${Date.now()}`
  try {
    return await import(fileUrl)
  }
  catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      throw new Error(
        `[amond] ${path.basename(absConfigPath)} uses TypeScript syntax that Node's ` +
        `type-stripping loader doesn't support (e.g. \`enum\`, \`namespace\` with ` +
        `runtime code, parameter properties, decorators). Rewrite using only ` +
        `erasable types (or move the config to plain JS).\n  Original: ${(err as Error).message}`,
      )
    }
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      throw new Error(
        `[amond] Cannot load ${path.basename(absConfigPath)}: this Node ` +
        `(v${process.versions.node}) does not support TypeScript natively. ` +
        `Upgrade to Node ≥ 22.18 or ≥ 23.6.`,
      )
    }
    throw err
  }
}

// ─── Source-root and entry lookup ───────────────────────────────────────────

/**
 * The directory authored modules are discovered from: `<root>/.amond` when it
 * exists as a directory, otherwise `<root>/src`, otherwise `<root>` itself.
 */
export function resolveSourceRoot(root: string): string {
  for (const sourceDirectory of ['.amond', 'src']) {
    const candidate = path.join(root, sourceDirectory)
    try {
      if (fs.statSync(candidate).isDirectory()) { return candidate }
    }
    catch {}
  }
  return root
}

/** Entry-module extensions, in lookup priority order. */
export const PROJECT_ENTRY_EXTENSIONS = Object.freeze(['ts', 'mts', 'js', 'mjs'])

/**
 * Locate `<sourceRoot>/<basename>.<ext>` for the default entry lookup
 * (`app`, `db`, `cloudflare`), honoring the extension priority
 * {@link PROJECT_ENTRY_EXTENSIONS}. Returns `undefined` when absent.
 */
export function discoverProjectEntry(sourceRoot: string, basename: string): string | undefined {
  for (const ext of PROJECT_ENTRY_EXTENSIONS) {
    const candidate = path.join(sourceRoot, `${basename}.${ext}`)
    if (fs.existsSync(candidate)) { return candidate }
  }
  return undefined
}

// ─── Project resolution ─────────────────────────────────────────────────────

export interface ResolveAmondProjectOptions {
  /** Absolute (or cwd-relative) project root. */
  root: string
  /** The (merged) config to resolve. Defaults to `{}`. */
  config?: AmondConfig
  /**
   * Path of the config file the values came from; relative config paths
   * resolve from its directory. Defaults to resolving from `root`.
   */
  configPath?: string
}

/** An amond project's fully resolved filesystem layout. */
export interface ResolvedAmondProject {
  /** Absolute project root. */
  root: string
  /** Absolute directory authored modules are discovered from. */
  sourceRoot: string
  /** Selected target, when configured. */
  target: 'node' | 'cloudflare' | undefined
  /** Absolute `app.*` entry path, or `undefined` when none exists. */
  app: string | undefined
  /** Absolute `db.*` entry path, or `undefined` when none exists. */
  db: string | undefined
  /** Absolute `cloudflare.*` entry path, or `undefined` when none exists. */
  cloudflare: string | undefined
  /** The `'use agent'` scan glob, verbatim as authored (root-relative). */
  agents: string | undefined
  /** Built-in provider IDs to register, or `undefined` for all built-ins. */
  providers: string[] | undefined
  /** Cloudflare default-tracing injection; `undefined` means on. */
  tracing: boolean | undefined
}

/**
 * Resolve a validated config against the filesystem: source-root lookup
 * (`.amond/` → `src/` → root) plus entry discovery with the `ts > mts > js >
 * mjs` extension priority. Explicit entry paths resolve from the config
 * file's directory and must exist (a typo, not a "not configured" state);
 * unset entries fall back to the source-root lookup and may be absent.
 *
 * Whether a missing entry is an error is the host's call (e.g. the Vite
 * plugin requires `app`; `amond run` requires none).
 */
export function resolveAmondProject(opts: ResolveAmondProjectOptions): ResolvedAmondProject {
  const root = path.resolve(opts.root)
  const config = opts.config ?? {}
  const baseDir = opts.configPath ? path.dirname(path.resolve(opts.configPath)) : root
  const sourceRoot = resolveSourceRoot(root)
  return {
    root,
    sourceRoot,
    target: config.target,
    app: resolveEntry('app', config.app, baseDir, sourceRoot),
    db: resolveEntry('db', config.db, baseDir, sourceRoot),
    cloudflare: resolveEntry('cloudflare', config.cloudflare, baseDir, sourceRoot),
    agents: config.agents,
    providers: config.providers,
    tracing: config.tracing,
  }
}

function resolveEntry(
  field: 'app' | 'db' | 'cloudflare',
  configured: string | undefined,
  baseDir: string,
  sourceRoot: string,
): string | undefined {
  if (configured !== undefined) {
    const explicit = path.resolve(baseDir, configured)
    if (!fs.existsSync(explicit)) {
      throw new Error(`[amond] Configured \`${field}\` entry not found: ${configured}`)
    }
    return explicit
  }
  return discoverProjectEntry(sourceRoot, field)
}
