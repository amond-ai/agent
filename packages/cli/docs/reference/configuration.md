---
title: Configuration
description: Reference for the amond.config file, the amond() Vite plugin and its option merging, target detection, and how vite dev, vite build, and amond run resolve configuration.
lastReviewedAt: 2026-07-21
---

amond project configuration has two authoring surfaces and one programmatic module:

- **`amond.config.ts`** — an optional file at the project root describing the project: its build target, entry-module paths, and the `'use agent'` scan scope.
- **Inline options to [`amond()`](#the-amond-vite-plugin)** — the Vite plugin accepts the same fields and merges them over the discovered file, per field.
- **[`@amond-ai/agent/config`](#amond-aiagentconfig)** — the module that implements discovery, validation, and resolution, for hosts and tooling.

Two consumers read the configuration: the `amond()` Vite plugin (`vite dev`, `vite build`, `vite preview`) and [`amond run`](/docs/cli/run/). Per-consumer behavior is specified in [Resolution by consumer](#resolution-by-consumer).

## `amond.config.ts`

```ts
// amond.config.ts
import { defineConfig } from '@amond-ai/agent/config';

export default defineConfig({
  target: 'node',
});
```

The file is optional, every field is optional, and the configuration must be the module's **default export**. A module without an object default export fails with `[amond] <file> must export a config object as the default export.`

### `defineConfig()`

```ts
function defineConfig(config: AmondConfig): AmondConfig;
```

Returns the configuration unchanged; exists for type checking and editor completion. A plain object default export is equally valid.

### File discovery

The config file is searched in the project root — the Vite root for the `amond()` plugin, the working directory for `amond run`. Basenames are tried in this priority order (first hit wins):

1. `amond.config.ts`
2. `amond.config.mts`
3. `amond.config.mjs`
4. `amond.config.js`
5. `amond.config.cjs`
6. `amond.config.cts`

When several of these files coexist in the same directory, the `amond()` plugin logs a warning naming the winner (`[amond] Multiple amond config files found (…); using <basename>.`); `amond run` selects silently by the same priority. There is no user-facing option to point the plugin or the CLI at a differently named config file; an explicit path exists only on the [programmatic API](#resolveamondconfigpath).

### Module evaluation

The config module is evaluated with Node's native dynamic `import()`, cache-busted on every load — not through Vite. Vite aliases, plugins, and transforms do not apply; every import in the config file must be resolvable by Node itself.

TypeScript config files rely on Node's type-stripping loader:

- Node ≥ 22.19 or ≥ 23.6 is required. On older Node, loading a `.ts` config fails with `[amond] Cannot load <file>: this Node (v…) does not support TypeScript natively.`
- Only erasable TypeScript syntax is accepted. `enum`, `namespace` with runtime code, parameter properties, and decorators fail with `[amond] <file> uses TypeScript syntax that Node's type-stripping loader doesn't support …`.

### Validation

The default export is validated strictly against the field set below:

- An unknown field is an error. (`amond run` is the one exception: it drops unknown keys instead of rejecting; see [`amond run`](#amond-run).)
- A non-object value fails with `[amond] <source> must be a config object.`
- Field-level failures (invalid `target` value, empty path strings) are reported together as `[amond] Invalid config in <source>:` followed by one line per field.

## Configuration fields

```ts
interface AmondConfig {
  target?: 'node' | 'cloudflare';
  app?: string;
  db?: string;
  cloudflare?: string;
  agents?: string;
  providers?: string[];
  tracing?: boolean;
}
```

`AmondConfig` is exported from `@amond-ai/agent/config`. The same object shape is accepted by the config file's default export and by [`amond()`](#the-amond-vite-plugin) inline options.

### `target`

The build and development target.

- `'node'` — build a self-starting Node.js server. See [the Node.js target](/docs/guide/node-target/).
- `'cloudflare'` — build a Workers-compatible application with one Durable Object class per agent. See [the Cloudflare target](/docs/guide/cloudflare-target/).
- Default: unset. The `amond()` plugin then auto-detects the target from the Vite plugin array — see [Target detection](#target-detection). An explicit value overrides detection.
- `amond run` ignores `target` entirely; it is always Node-local.

### `app`

Path to the application entry (`app.ts`) — the project's route map and the only module the Vite plugin requires to exist. See [Routing](/docs/guide/routing/).

- Default: the entry lookup `app.{ts,mts,js,mjs}` under the [source root](#entry-path-resolution). When no file resolves, `vite dev` and `vite build` fail with `[amond] No app entry found. …`.
- A relative value resolves from the config file's directory. An explicit path that does not exist is an error: ``[amond] Configured `app` entry not found: <path>``.

### `db`

Path to the persistence entry (`db.ts`), whose default export is the project's persistence adapter. Node target only. See [Database](/docs/guide/database/).

- Default: the entry lookup `db.{ts,mts,js,mjs}` under the source root; when nothing resolves, the Node target uses its built-in SQLite default.
- Same resolution and existence rules as `app`.
- On the Cloudflare target, a resolved `db` entry — discovered or explicit — is a hard error: `[amond] Custom persistence (db.ts) is not supported on the Cloudflare target. …` Cloudflare agents persist in Durable Object SQLite.

### `cloudflare`

Path to the non-HTTP Cloudflare handlers entry (`cloudflare.ts`), whose default export contributes Worker handlers (`scheduled`, `queue`, …) to the generated Worker entry. See [Extending the `cloudflare.ts` entrypoint](/docs/guide/cloudflare-target/#extending-cloudflarets-entrypoint).

- Default: the entry lookup `cloudflare.{ts,mts,js,mjs}` under the source root.
- Same resolution and existence rules as `app`.
- Consumed only by the Cloudflare target; a resolved entry is inert on Node.

### `agents`

A glob narrowing the [`'use agent'` scan](/docs/guide/building-agents/#use-agent-directive), interpreted relative to the source root (for example `'agents/**/*.ts'`).

- Default: the entire source root, recursively (`**/*.{ts,mts,js,mjs}`).
- Matches are always restricted to `.ts`/`.mts`/`.js`/`.mjs` files. `node_modules/`, `dist/`, `output/`, and `.wrangler/` directories are always excluded, and dot-directories are not matched.
- `amond run` ignores `agents`; it takes an explicit module path and performs no scan.

### `providers`

The providers registered at server start, by provider ID (for example `['anthropic', 'openai']`). Each entry becomes a `@earendil-works/pi-ai/providers/<id>` factory import in the generated entry — `'cloudflare'` selects amond's own Workers AI binding provider instead — so only the listed providers ship in the build.

- Default: unset — every built-in provider registers, the Workers AI binding provider included on the Cloudflare target.
- The list is exhaustive: on the Cloudflare target, `cloudflare/...` models require `'cloudflare'` in the list. On the Node target, `'cloudflare'` is a config error — the Workers AI binding only exists on Workers.
- Entries are validated as lowercase alphanumerics and dashes; an ID Pi doesn't ship fails the build with the unresolvable import path.
- Custom providers registered with `setProvider()` in `app.ts` are unaffected, and a user registration always wins over a listed provider with the same ID.
- `amond run` ignores `providers`; it always registers the full built-in set.

The full semantics live in the [Provider API reference](/docs/reference/provider-api/#the-providers-config).

### `tracing`

Agent tracing on the Cloudflare target (the built-in [`createCloudflareTracing()`](/docs/guide/cloudflare-target/#createcloudflaretracing) install). Inert on Node.

- Default: unset — tracing is on. Spans flow once [Workers Traces](https://developers.cloudflare.com/workers/observability/traces/) is enabled on the account; until then the instrumentation is a platform no-op.
- `false` drops it from the build.
- An explicit `instrument(createCloudflareTracing(...))` at `app.ts` module scope always replaces the built-in install, whatever this field is set to — customizing does not require `tracing: false`.

## Entry-path resolution

Both consumers resolve the configured fields against the filesystem with the same rules:

- **Source root.** Authored modules are discovered from `<root>/.amond` when it exists as a directory, otherwise `<root>/src`, otherwise the project root itself. See [Project layout](/docs/guide/project-layout/).
- **Default entry lookup.** An unset `app`/`db`/`cloudflare` field falls back to `<sourceRoot>/<field>.<ext>`, trying extensions in the order `ts`, `mts`, `js`, `mjs`. A missing default entry is not an error at resolution time; whether it is required is the consumer's call (`app` is required by `vite dev`/`vite build`; nothing is required by `amond run` or `vite preview`).
- **Explicit paths.** A set field resolves from the config file's directory (from the project root when the value came only from inline `amond()` options) and must exist; a missing explicit entry throws ``[amond] Configured `<field>` entry not found: <path>``.

## The `amond()` Vite plugin

```ts
import { amond } from '@amond-ai/agent-vite';

function amond(config?: AmondConfig): Plugin[];
```

Makes a Vite project an amond application. Returns an array of plugins; the core plugin is named `amond`. Adding `amond()` to the same Vite config more than once is an error. See [Deploy](/docs/guide/deploy/) for the build-and-deploy walkthrough on each target.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { amond } from '@amond-ai/agent-vite';

export default defineConfig({
  plugins: [amond({ target: 'node' })],
});
```

The plugin options are an `AmondConfig`. During Vite config resolution the plugin:

1. Validates the inline options (failures name `inline amond() options` as the source).
2. Discovers and loads `amond.config.*` from the Vite root.
3. Merges inline options over the file, per field: a defined inline field wins; an `undefined` inline field falls through to the file value. All fields are scalars; there is no deep merging.
4. Resolves the project layout and, outside preview, runs the `'use agent'` scan.

The project resolves against the Vite root (`root` in the Vite config, else the working directory). If another plugin changes `root` after `amond()` has resolved, config resolution fails with an error directing you to set `root` in the Vite config itself.

### Target detection

The effective target is decided in this order:

1. The merged `target` field, when set.
2. `'cloudflare'` when `@cloudflare/vite-plugin` is present in the resolved Vite plugin array.
3. `'node'` otherwise.

Cloudflare wiring is validated at config-resolution time; each failure is a distinct error:

- `target: 'cloudflare'` without `@cloudflare/vite-plugin` in the plugin array.
- `cloudflare()` listed before `amond()` — `amond()` must precede it, because the sibling's config resolution invokes amond's [worker-config customizer](#amondworkerconfig) and needs the completed project resolution and agent scan.
- The Cloudflare plugin present but not visible to `amond()` as a plain `plugins` entry (wrapped in a Promise, or injected by another plugin).
- `cloudflare()` invoked without `config: amondWorkerConfig()`, leaving the sibling without amond's Worker entry and Durable Object bindings.

### Vite configuration set by the plugin

On every target and mode the plugin sets `appType: 'custom'` and dedupes `@amond-ai/agent` and `hono` to a single copy per module graph.

On the **Node target**, `vite build` additionally forces: `build.ssr: true`, `build.target: 'node22'`, the two-entry rolldown input (the self-starting `server.mjs` plus the non-listening `app.mjs` chunk it imports), `.mjs` entry and chunk file names, and ES module output. Node builtins, the project's `package.json` dependencies (with their subpaths), and amond's optional native dependencies stay external to the bundle. User-set values at these forced paths are overridden with a warning (`[amond] The following Vite config options are overridden by amond(): …`), not an error. The user keeps:

- `build.outDir` — default `'dist'`. An output directory that resolves to (or contains) the project root or source root — including through symlinks or junctions — is rejected, because the build empties it: `[amond] build.outDir "…" resolves to "…", which is or contains the … . …`
- `build.sourcemap` — default `true`.
- `build.emptyOutDir` — left to Vite's own default and fencing.

In `vite dev` and `vite preview` (both targets), `server.cors` / `preview.cors` default to a localhost-only credentialed policy that also exposes the durable-stream coordination headers (`Stream-Next-Offset`, `Stream-Up-To-Date`, `Location`); an explicit user value replaces the default. Deployed servers apply no CORS — see [Routing](/docs/guide/routing/).

On the Node target, `vite dev` also loads the project's `.env` file set (Vite's standard `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`) into `process.env` with shell-wins semantics, matching `amond run`. Cloudflare dev-time variables (`.dev.vars`) belong to the Cloudflare plugin instead.

On the **Cloudflare target** the plugin imposes no build configuration; `@cloudflare/vite-plugin` owns the Worker build, dev server, and preview.

### Virtual modules

The plugin serves six virtual modules; they are resolvable only inside module graphs the plugin owns:

- `virtual:amond/app` — the resolved `app` entry (required).
- `virtual:amond/db` — the resolved `db` entry, or a stub exporting `undefined` (the built-in default adapter is then used).
- `virtual:amond/agents` — the scanned `'use agent'` module set.
- `virtual:amond/providers` — provider registration generated from [`providers`](#providers) (or the all-built-ins default).
- `virtual:amond/server` — the Node server bootstrap.
- `virtual:amond/worker` — the generated Cloudflare Worker entry (wrangler `main`; one Durable Object class per agent).

### `AmondVitePluginApi`

```ts
interface AmondVitePluginApi {
  readonly resolved: AmondResolvedProjectInfo | undefined;
}

interface AmondResolvedProjectInfo {
  readonly config: AmondConfig;
  readonly configPath: string | undefined;
  readonly project: ResolvedAmondProject;
  readonly target: 'node' | 'cloudflare';
  readonly agents: readonly AgentScanResult[];
}
```

Exported from `@amond-ai/agent-vite`. The core `amond` plugin exposes `AmondVitePluginApi` on its `api` field as a read surface for other tools. `resolved` is `undefined` until Vite config resolution completes.

- `config` — the merged amond config (file + inline options).
- `configPath` — absolute path of the discovered `amond.config.*`, if any.
- `project` — the resolved filesystem layout; see [`ResolvedAmondProject`](#resolveamondproject).
- `target` — the effective target after [detection](#target-detection).
- `agents` — the scanned agent set; live in dev (reflects the latest re-scan).

## `amondWorkerConfig()`

```ts
import { amond, amondWorkerConfig } from '@amond-ai/agent-vite';

function amondWorkerConfig(): AmondWorkerConfigCustomizer;

type AmondWorkerConfigCustomizer = (config: object) => void;
```

Creates the worker-config customizer for the Cloudflare target, passed to the sibling plugin's `config` option:

```ts
// vite.config.ts
import { cloudflare } from '@cloudflare/vite-plugin';
import { amond, amondWorkerConfig } from '@amond-ai/agent-vite';

export default defineConfig({
  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })],
});
```

`amondWorkerConfig()` must be called after `amond()` in the same Vite config evaluation; calling it first throws `[amond] amondWorkerConfig() was called before amond(). …`. The customizer runs inside the Cloudflare plugin's config resolution, against the resolved config of the active Cloudflare environment (`CLOUDFLARE_ENV`), and contributes exactly four things:

- `main` — set to `virtual:amond/worker`, the generated Worker entry, unless the user's wrangler config sets its own `main` (which can re-export the generated module: `export * from 'virtual:amond/worker'`).
- One Durable Object binding per scanned agent. A user binding that occupies an amond-reserved binding name must match the binding amond would generate (same `class_name`, no `script_name`/`environment`); a conflicting one throws `[amond] wrangler config durable object binding "…" is reserved by amond. …`.
- The `nodejs_compat` compatibility flag, unioned into `compatibility_flags`.
- Validation of a user-set `compatibility_date`: it must be `YYYY-MM-DD` and at least `2026-04-01`. An older date is an error, not a silent bump. An unset date is left to the Cloudflare plugin's own default.

Everything else in the wrangler config — `name`, user Durable Objects, containers, R2 buckets, migrations — passes through untouched. amond never reads, merges, or writes a wrangler config file; see [`wrangler.jsonc`](/docs/guide/cloudflare-target/#wranglerjsonc). Under `vite preview` the customizer is a no-op (preview serves the already-built Worker output).

## Resolution by consumer

### `vite dev`

Config resolution runs in the plugin's `config` hook: discover `amond.config.*` in the Vite root, merge inline options, resolve entries, require `app`, scan agents. The dev server then keeps the resolution live:

- An edit to the discovered `amond.config.*` — or the creation of any `amond.config.*` candidate when none existed at startup — restarts the dev server, which re-runs the full resolution.
- A change to the scanned agent set (file added/removed, directive or identity change) regenerates `virtual:amond/agents` and reloads the app on Node; on Cloudflare it restarts the dev server, so the Worker entry and Durable Object bindings are regenerated.
- On Cloudflare, an authored `wrangler.jsonc`/`wrangler.json`/`wrangler.toml` appearing or disappearing at the root restarts the dev server; edits to an existing file are handled by the Cloudflare plugin itself.
- Scan failures during watching (mid-edit syntax, duplicate identities) are logged and leave the last good agent set in place.

### `vite build`

Same resolution as `vite dev`, once. `app` is required; the agent scan must succeed; on Node the [forced build configuration](#vite-configuration-set-by-the-plugin) and the `build.outDir` safety check apply; on Cloudflare the ordering and wiring [validation](#target-detection) applies and the merged wrangler config is emitted into the build output by the Cloudflare plugin.

### `vite preview`

Preview is artifact-based: the config file is still discovered, loaded, and validated, and entries are resolved, but nothing is required, no agent scan runs, and nothing is generated. Node preview serves the built `dist/` output; Cloudflare preview is owned entirely by the Cloudflare plugin (workerd over the built Worker).

### `amond run`

[`amond run`](/docs/cli/run/) resolves configuration directly, without Vite config or the plugin:

- `amond.config.*` is discovered from the **working directory** (which is also the project root); `vite.config.ts` is never read.
- Unknown config keys are dropped before validation instead of rejected.
- `target` and `agents` are ignored: the run is always Node-local, and the agent module is the explicit `<path>` argument, not a scan result.
- `db` is honored; without one, the run uses a SQLite database at `node_modules/.cache/amond/run.db` under the project root.
- `app` and `cloudflare` are resolved but unused. Explicit-path existence checks still apply: a configured entry that does not exist fails the run.

## `@amond-ai/agent/config`

The programmatic configuration module. It is host-side tooling — it touches the filesystem — and must be imported from build or CLI code, never from agent modules. [`defineConfig()`](#defineconfig) and [`AmondConfig`](#configuration-fields) are documented above.

### `parseAmondConfig()`

```ts
function parseAmondConfig(value: unknown, source?: string): AmondConfig;
```

Validates a raw config value (a config module's default export, or inline plugin options) against the strict field set. Throws with per-field diagnostics naming `source` (default `'amond config'`). Returns the validated `AmondConfig`.

### `mergeAmondConfig()`

```ts
function mergeAmondConfig(file: AmondConfig, inline: AmondConfig): AmondConfig;
```

Merges host-provided config over a discovered file config, per field: defined `inline` fields win, `undefined` fields fall through to `file`.

### `resolveAmondConfigPath()`

```ts
interface ResolveAmondConfigPathOptions {
  cwd: string;
  configFile?: string;
}

function resolveAmondConfigPath(opts: ResolveAmondConfigPathOptions): string | undefined;
```

Resolves the absolute path of the project's `amond.config.*`, or `undefined` when none exists.

- `cwd` — directory searched for the [config basenames](#file-discovery), and the base for `configFile`.
- `configFile` — explicit config path (relative to `cwd`, or absolute). An explicit path that does not exist throws `[amond] Config file not found: <path>` rather than returning `undefined`.

### `loadAmondConfig()`

```ts
interface LoadedAmondConfig {
  configPath: string | undefined;
  config: AmondConfig;
}

function loadAmondConfig(opts: ResolveAmondConfigPathOptions): Promise<LoadedAmondConfig>;
```

Discovers, evaluates, and validates the project config in one step, under the [module-evaluation rules](#module-evaluation). Returns `{ configPath: undefined, config: {} }` when no config file exists. Throws on a missing explicit `configFile`, a non-object default export, or validation failure.

### `loadAmondConfigModule()`

```ts
function loadAmondConfigModule(absConfigPath: string): Promise<Record<string, unknown>>;
```

Evaluates a config file via native dynamic `import()` (cache-busted per call) and returns the module namespace, unvalidated. Type-stripping failures and unsupported-Node failures are rethrown with the diagnostic messages listed under [Module evaluation](#module-evaluation).

### `resolveSourceRoot()`

```ts
function resolveSourceRoot(root: string): string;
```

Returns the directory authored modules are discovered from: `<root>/.amond` when it exists as a directory, otherwise `<root>/src`, otherwise `root`.

### `discoverProjectEntry()`

```ts
function discoverProjectEntry(sourceRoot: string, basename: string): string | undefined;
```

Locates `<sourceRoot>/<basename>.<ext>` using the extension priority `ts`, `mts`, `js`, `mjs`. Returns `undefined` when no candidate exists.

### `resolveAmondProject()`

```ts
interface ResolveAmondProjectOptions {
  root: string;
  config?: AmondConfig;
  configPath?: string;
}

function resolveAmondProject(opts: ResolveAmondProjectOptions): ResolvedAmondProject;
```

Resolves a validated config against the filesystem, applying the rules in [Entry-path resolution](#entry-path-resolution). Missing explicit entries throw; missing default entries resolve to `undefined` (whether that is an error is the caller's decision).

- `root` — project root (absolute, or resolved from the working directory).
- `config` — the merged config to resolve. Default `{}`.
- `configPath` — path of the config file the values came from; relative entry paths resolve from its directory. Defaults to resolving from `root`.

### `ResolvedAmondProject`

```ts
interface ResolvedAmondProject {
  root: string;
  sourceRoot: string;
  target: 'node' | 'cloudflare' | undefined;
  app: string | undefined;
  db: string | undefined;
  cloudflare: string | undefined;
  agents: string | undefined;
}
```

A project's fully resolved filesystem layout. `root`, `sourceRoot`, and the entry fields are absolute paths; `target` is passed through from the config (detection is the Vite plugin's job); `agents` is the scan glob verbatim as authored.

### Constants

```ts
const AMOND_CONFIG_BASENAMES: readonly string[];
const PROJECT_ENTRY_EXTENSIONS: readonly string[];
```

- `AMOND_CONFIG_BASENAMES` — the [config basenames](#file-discovery), in priority order.
- `PROJECT_ENTRY_EXTENSIONS` — the entry extension priority: `['ts', 'mts', 'js', 'mjs']`.

## What configuration does not cover

- **Environment variables.** `amond.config.ts` declares no secrets and reads no `.env` mapping; API keys and runtime variables come from the process environment. See [Environment and secrets](/docs/guide/node-target/#environment-and-secrets).
- **Wrangler configuration.** Worker name, routes, user bindings, containers, and migrations live in your own `wrangler.jsonc`; amond only [contributes](#amondworkerconfig) its derived values at build time.
- **Agent behavior.** Models, tools, sandboxes, and durability are configured in agent modules, not in `amond.config.ts`. See [Models](/docs/guide/models/) and [Tools](/docs/guide/tools/).
- **Vite options.** `amond.config.ts` carries no Vite configuration; server ports, plugins, and build overrides stay in `vite.config.ts`.
