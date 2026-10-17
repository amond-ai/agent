/**
 * The `amond()` Vite plugin — makes a Vite project an amond application.
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { amond } from '@amond-ai/agent-vite';
 * export default defineConfig({ plugins: [amond()] });
 * ```
 *
 * The plugin options ARE the amond config: `amond(config?: AmondConfig)` merges
 * inline values over a discovered `amond.config.*` (inline wins). The target
 * defaults to `'cloudflare'` when `@cloudflare/vite-plugin` is present in the
 * resolved plugin array, `'node'` otherwise; an explicit `target` overrides
 * detection.
 *
 * On the Cloudflare target, the user wires `cloudflare({ config:
 * amondWorkerConfig() })` and `amond()` must precede `cloudflare()` in the
 * plugin array: the sibling's `config` hook invokes amond's worker-config
 * customizer (see cloudflare-worker-config.ts), which needs amond's completed
 * project resolution and agent scan. The sibling owns the wrangler config,
 * workerd dev, build output, and preview.
 *
 * Virtual modules (resolved only inside graphs this plugin serves):
 *
 * - `virtual:amond/app`    → the resolved app entry (REQUIRED to exist)
 * - `virtual:amond/db`     → the resolved db entry, or a default-adapter stub
 * - `virtual:amond/agents` → the scanned `'use agent'` module set
 * - `virtual:amond/server` → the Node bootstrap (real code in this package)
 * - `virtual:amond/worker` → the generated Cloudflare Worker entry (wrangler
 *   `main`; per-agent Durable Object classes)
 */
import * as fs from 'node:fs'
import { builtinModules } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AmondConfig, ResolvedAmondProject } from '@amond-ai/agent/config'
import {
  AMOND_CONFIG_BASENAMES,
  loadAmondConfig,
  mergeAmondConfig,
  parseAmondConfig,
  resolveAmondProject,
} from '@amond-ai/agent/config'
import {
  defaultAllowedOrigins,
  normalizePath,
	
} from 'vite'
import type { Plugin, PluginOption, UserConfig, ViteDevServer } from 'vite'
import {
  AGENT_DIRECTIVE,
  
  isAgentModulePath,
  scanAgents,
} from './agent-scan.ts'
import type { AgentScanResult } from './agent-scan.ts'
import { cloudflareAgentsResolverPlugin } from './cloudflare-agents-resolver.ts'
import { generateCloudflareEntry } from './cloudflare-entry.ts'
import {
  cloudflareOrderingError,
  
  registerAmondWorkerConfigSource,
  VIRTUAL_WORKER_ENTRY,
} from './cloudflare-worker-config.ts'
import type { AmondWorkerConfigSource } from './cloudflare-worker-config.ts'
import {
  
  amondDependencyResolverPlugin,
  getUserExternals,
} from './dependency-resolver.ts'
import type { DependencyResolverState } from './dependency-resolver.ts'
import { applyDevEnv } from './dev-env.ts'
import { stackless } from './diagnostics.ts'
import { createImportTrace, explainCloudflareImport } from './import-trace.ts'
import { markdownImportPlugin } from './markdown-import-plugin.ts'
import { createNodeDevController } from './node-dev.ts'
import { configureNodePreview } from './node-preview.ts'
import { canonicalizePath, isWithinDirectory } from './paths.ts'
import { generateProvidersModule } from './providers-module.ts'
import { transformUseAgentModule } from './use-agent-transform.ts'
import { createWatchQueue } from './watch-queue.ts'
import type { WatchQueue } from './watch-queue.ts'

/** The resolved amond project, exposed on the core plugin's `api` field. */
export interface AmondResolvedProjectInfo {
  /** The merged amond config (discovered file + inline `amond()` options). */
  readonly config: AmondConfig
  /** Absolute path of the discovered `amond.config.*`, if any. */
  readonly configPath: string | undefined
  /** The resolved filesystem layout (root, source root, entries). */
  readonly project: ResolvedAmondProject
  /** The selected target (explicit config, or plugin-array auto-detection). */
  readonly target: 'node' | 'cloudflare'
  /**
   * The scanned `'use agent'` module set. Live in dev: reflects the latest
   * watcher-driven re-scan.
   */
  readonly agents: readonly AgentScanResult[]
}

/**
 * The core plugin's `api` field — a stable read surface for other tools
 * (`amond run` may consume this later). `resolved` is `undefined` until Vite
 * config resolution completes.
 */
export interface AmondVitePluginApi {
  readonly resolved: AmondResolvedProjectInfo | undefined
}

const VIRTUAL_APP = 'virtual:amond/app'
const VIRTUAL_DB = 'virtual:amond/db'
const VIRTUAL_AGENTS = 'virtual:amond/agents'
const VIRTUAL_SERVER = 'virtual:amond/server'
const VIRTUAL_PROVIDERS = 'virtual:amond/providers'
const RESOLVED_DB_STUB = '\0virtual:amond/db'
const RESOLVED_AGENTS = '\0virtual:amond/agents'
const RESOLVED_PROVIDERS = '\0virtual:amond/providers'
const RESOLVED_WORKER_ENTRY = `\0${VIRTUAL_WORKER_ENTRY}`

/** Externals the Node target always keeps out of the bundle (optional native deps). */
const NODE_TARGET_EXTERNALS = ['node-liblzma', '@mongodb-js/zstd']

/**
 * Packages that must resolve to exactly one copy in every module graph:
 * `@amond-ai/agent` holds module-scoped registries, and a second `hono` splits
 * middleware/context identity. Declarative belt alongside the dependency
 * resolver, and the only single-instance guard on the Cloudflare target
 * (where the resolver stays inert).
 */
const RUNTIME_DEDUPE = ['@amond-ai/agent', 'hono']

/**
 * Vite config paths amond's `config` hook forces (scalars returned from the
 * hook override the user's values silently). User-set values are collected at
 * config time and warned about in `configResolved` instead of erroring —
 * matching how established Vite frameworks treat conflicting config.
 */
const ENFORCED_BUILD_CONFIG_PATHS = [
  'appType',
  'build.ssr',
  'build.target',
  'build.rolldownOptions.input',
  'build.rolldownOptions.output.entryFileNames',
  'build.rolldownOptions.output.chunkFileNames',
  'build.rolldownOptions.output.format',
]
const ENFORCED_DEV_CONFIG_PATHS = ['appType']

/** Chrome probes this on every DevTools open; it must never reach user routes. */
const CHROME_DEVTOOLS_PROBE_PATH = '/.well-known/appspecific/com.chrome.devtools.json'

/** Authored wrangler config basenames the sibling plugin discovers at the root. */
const AUTHORED_WRANGLER_BASENAMES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']

/**
 * Dev-server CORS defaults: allow credentialed requests from localhost-family
 * origins only (Vite's own default origin set), and expose the durable-stream
 * coordination headers so separate-origin local SPAs can resume stream
 * offsets. Reflecting arbitrary origins with credentials would let any
 * website drive and read the local agent API through ambient credentials
 * (SameSite=None cookies, cached Basic auth). Non-localhost clients need an
 * explicit `server.cors` override. Deployed servers keep CORS as an
 * application concern.
 */
const DEV_CORS = {
  origin: defaultAllowedOrigins,
  credentials: true,
  exposedHeaders: ['Stream-Next-Offset', 'Stream-Up-To-Date', 'Location'],
  maxAge: 86400,
}

interface AmondPluginState {
  root: string
  configPath: string | undefined
  mergedConfig: AmondConfig
  project: ResolvedAmondProject
  agents: AgentScanResult[]
  /** Scan results grouped by normalized (posix) absolute file path. */
  agentsByPath: Map<string, AgentScanResult[]>
  explicitTarget: 'node' | 'cloudflare' | undefined
  target: 'node' | 'cloudflare'
  /** Preview mode is artifact-based: no scanning, no input generation. */
  isPreview: boolean
  /** Whether the config hook took the Cloudflare path (sibling detected). */
  cloudflarePrepared: boolean
  /** Serializes and coalesces watcher-driven re-scans. */
  watchQueue: WatchQueue
  resolved: AmondResolvedProjectInfo | undefined
  /** Warnings collected during the `config` hook, logged in `configResolved`. */
  pendingWarnings: string[]
}

export function amond(config: AmondConfig = {}): Plugin[] {
  const inlineConfig = parseAmondConfig(config, 'inline amond() options')
  const bootstrap = resolveBootstrapPaths()

  const state: AmondPluginState = {
    root: '',
    configPath: undefined,
    mergedConfig: {},
    project: undefined as unknown as ResolvedAmondProject,
    agents: [],
    agentsByPath: new Map(),
    explicitTarget: undefined,
    target: 'node',
    isPreview: false,
    cloudflarePrepared: false,
    watchQueue: createWatchQueue(),
    resolved: undefined,
    pendingWarnings: [],
  }
  const resolverState: DependencyResolverState = {
    root: undefined,
    external: false,
    importers: undefined,
  }

  // The link between this amond() instance and an amondWorkerConfig() created
  // after it in the same vite.config evaluation. The `config` hook keeps
  // `configReady`/`isPreview` current; the customizer reads the live agent
  // scan through the getter and reports back via `customizerInvoked`.
  const workerConfigSource: AmondWorkerConfigSource = {
    configReady: false,
    isPreview: false,
    get doBindings() {
      return state.agents.map(agent => ({
        name: agent.bindingName,
        class_name: agent.className,
      }))
    },
    customizerInvoked: false,
  }
  registerAmondWorkerConfigSource(workerConfigSource)

  // Records import edges on the Node target so wrong-environment failures
  // (a `cloudflare:*` import reaching the Node graph) can print the chain
  // from the user's entry to the offending module. Inert on Cloudflare,
  // where those imports are legitimate and the sibling owns the graph.
  const importTrace = createImportTrace({
    enabled: () => state.target === 'node' && !state.isPreview,
  })

  const updateAgents = (agents: AgentScanResult[]): void => {
    state.agents = agents
    const byPath = new Map<string, AgentScanResult[]>()
    for (const agent of agents) {
      const key = normalizePath(agent.filePath)
      const group = byPath.get(key) ?? []
      group.push(agent)
      byPath.set(key, group)
    }
    state.agentsByPath = byPath
  }

  const api: AmondVitePluginApi = {
    get resolved() {
      return state.resolved
    },
  }

  // Servers whose (bound) close has begun. A queued restart of a closing
  // server must never run: restarting re-executes every `config` hook, which
  // re-resolves the project and re-scans the agent set — work that would
  // race whatever replaced the server.
  const closedServers = new WeakSet<ViteDevServer>()

  // Serialized dev-server restarts. Vite's server.restart() returns the
  // in-flight promise when one is already running, which would silently drop
  // an amond.config edit landing mid-restart; queueing at plugin scope (the
  // plugin instances survive restarts) guarantees a follow-up restart runs.
  let restartQueue = Promise.resolve()
  let restartPending = false
  const requestRestart = (server: ViteDevServer): void => {
    if (restartPending || closedServers.has(server)) { return }
    restartPending = true
    restartQueue = restartQueue
      .then(async () => {
        restartPending = false
        if (closedServers.has(server)) { return }
        await server.restart()
      })
      .catch((error) => {
        server.config.logger.error(
          `[amond] Dev server restart failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  const corePlugin: Plugin = {
    name: 'amond',
    api,

    async config(userConfig, env) {
      const root = path.resolve(userConfig.root ?? process.cwd())
      const loaded = await loadAmondConfig({ cwd: root })
      const merged = mergeAmondConfig(loaded.config, inlineConfig)
      const project = resolveAmondProject({
        root,
        config: merged,
        configPath: loaded.configPath,
      })
      state.root = root
      state.configPath = loaded.configPath
      state.mergedConfig = merged
      state.project = project
      state.explicitTarget = merged.target
      state.isPreview = env.isPreview === true
      state.cloudflarePrepared = false
      state.pendingWarnings = []
      workerConfigSource.configReady = false
      workerConfigSource.isPreview = state.isPreview
      workerConfigSource.customizerInvoked = false

      const ambiguityWarning = amondConfigAmbiguityWarning(loaded.configPath)
      if (ambiguityWarning) { state.pendingWarnings.push(ambiguityWarning) }

      // Preliminary target detection from the user config's plugin array;
      // `configResolved` re-detects against the final resolved array and is
      // authoritative.
      const preliminaryTarget =
        merged.target ?? (containsCloudflarePlugin(userConfig.plugins) ? 'cloudflare' : 'node')
      state.target = preliminaryTarget

      // Preview is artifact-based (Cloudflare: the sibling plugin serves the
      // built Worker output; Node: configurePreviewServer imports the built
      // app chunk). Require no source state and generate nothing — but keep
      // appType 'custom' so Vite's SPA fallback doesn't answer requests
      // before the application middleware, and default preview CORS to the
      // dev policy so separate-origin local clients (the demo chat app)
      // can read the durable-stream coordination headers.
      if (state.isPreview) {
        return {
          appType: 'custom',
          preview: { cors: userConfig.preview?.cors ?? DEV_CORS },
        } satisfies UserConfig
      }

      if (!project.app) { throw missingAppEntryError(project) }
      updateAgents(await scanAgents({ sourceRoot: project.sourceRoot, agents: project.agents }))

      const isBuild = env.command === 'build'

      if (preliminaryTarget === 'cloudflare') {
        // The sibling plugin resolves its configuration in ITS `config`
        // hook — reading the user's wrangler config and invoking amond's
        // worker-config customizer — which runs after this one only when
        // amond() precedes cloudflare() in the plugin array. Diagnose the
        // wrong order here, before the customizer could run against an
        // unresolved project.
        if (cloudflarePluginPrecedesAmond(userConfig.plugins, corePlugin)) {
          throw cloudflareOrderingError()
        }
        if (project.db) { throw dbOnCloudflareError() }
        state.cloudflarePrepared = true
        workerConfigSource.configReady = true
        // The dependency resolver stays inert (root unset): the Worker
        // entry is a virtual module resolved against the user's project
        // root, so its bare imports resolve from the user's node_modules
        // natively (the Agents SDK additionally falls back to this
        // package's pinned copy — see cloudflare-agents-resolver.ts),
        // and externalization would break the workerd module graph. Dev
        // CORS matches the Node target: workerd requests flow
        // through Vite's middleware stack, and separate-origin local
        // clients need the durable-stream coordination headers exposed.
        return {
          resolve: { dedupe: RUNTIME_DEDUPE },
          ...(isBuild ? {} : { server: { cors: userConfig.server?.cors ?? DEV_CORS } }),
        } satisfies UserConfig
      }

      // The Workers AI binding provider only exists on the Cloudflare
      // target — env.AI is a Worker binding. Diagnose the config here
      // rather than silently registering nothing.
      if (project.providers?.includes('cloudflare')) {
        throw cloudflareProviderOnNodeError()
      }

      resolverState.root = root
      resolverState.external = !isBuild
      resolverState.importers = isBuild ? undefined : [bootstrap.server]

      state.pendingWarnings.push(
        ...enforcedConfigWarnings(
          userConfig,
          isBuild ? ENFORCED_BUILD_CONFIG_PATHS : ENFORCED_DEV_CONFIG_PATHS,
        ),
      )

      if (isBuild) {
        const outDir = userConfig.build?.outDir ?? 'dist'
        assertSafeBuildOutDir(root, project.sourceRoot, outDir)
        return {
          appType: 'custom',
          resolve: { dedupe: RUNTIME_DEDUPE },
          build: {
            ssr: true,
            outDir,
            // `emptyOutDir` is deliberately left to Vite: its default
            // empties in-root output directories and warns-without-emptying
            // for out-of-root ones. Forcing `true` here would override that
            // fence and empty whatever directory the config points at.
            sourcemap: userConfig.build?.sourcemap ?? true,
            target: 'node22',
            rolldownOptions: {
              // Two entries: the self-starting server.mjs, and the
              // non-listening application chunk app.mjs it imports —
              // which artifact-based consumers (`vite preview`, custom
              // hosts) load without binding a port.
              input: { server: bootstrap.entry, app: bootstrap.server },
              external: [
                ...NODE_TARGET_EXTERNALS,
                ...getUserExternals(root),
                ...builtinModules,
                ...builtinModules.map(name => `node:${name}`),
              ],
              output: {
                entryFileNames: '[name].mjs',
                // Shared chunks must keep the .mjs extension: the dist
                // directory has no package.json, so Node treats .js as
                // CommonJS and the import graph would break.
                chunkFileNames: '[name]-[hash].mjs',
                format: 'es',
              },
            },
          },
        } satisfies UserConfig
      }
      return {
        appType: 'custom',
        resolve: { dedupe: RUNTIME_DEDUPE },
        server: { cors: userConfig.server?.cors ?? DEV_CORS },
      } satisfies UserConfig
    },

    configResolved(resolved) {
      for (const warning of state.pendingWarnings) { resolved.logger.warn(warning) }
      state.pendingWarnings = []
      if (resolved.plugins.filter(plugin => plugin.name === 'amond').length > 1) {
        throw stackless(new Error('[amond] amond() was added to the Vite config more than once.'))
      }
      if (normalizePath(path.resolve(resolved.root)) !== normalizePath(state.root)) {
        throw stackless(
          new Error(
            `[amond] The resolved Vite root (${resolved.root}) differs from the root amond() resolved its project against (${state.root}). ` +
            'Another plugin changed `root` after amond() ran; set `root` in the Vite config itself instead.',
          ),
        )
      }
      // Authoritative target detection: the full resolved plugin array is
      // visible here.
      const cloudflareDetected = resolved.plugins.some(plugin =>
        isCloudflarePluginName(plugin.name),
      )
      const target = state.explicitTarget ?? (cloudflareDetected ? 'cloudflare' : 'node')
      state.target = target
      state.resolved = {
        config: state.mergedConfig,
        configPath: state.configPath,
        project: state.project,
        target,
        get agents() {
          return state.agents
        },
      }
      if (target === 'cloudflare') {
        if (!cloudflareDetected) {
          throw stackless(
            new Error(
              '[amond] target is \'cloudflare\' but @cloudflare/vite-plugin is not in the Vite plugin array. ' +
              'Install @cloudflare/vite-plugin and add it after amond():\n\n' +
              '  import { cloudflare } from \'@cloudflare/vite-plugin\';\n' +
              '  import { amond, amondWorkerConfig } from \'@amond-ai/agent-vite\';\n' +
              '  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })]\n',
            ),
          )
        }
        // Belt-and-suspenders ordering check against the RESOLVED array:
        // the sibling's config-resolving plugin ('vite-plugin-cloudflare')
        // and amond's core plugin are both normal-enforce, so their resolved
        // order mirrors config-hook execution order.
        const amondIndex = resolved.plugins.findIndex(plugin => plugin.name === 'amond')
        const cloudflareIndex = resolved.plugins.findIndex(
          plugin => plugin.name === 'vite-plugin-cloudflare',
        )
        if (cloudflareIndex !== -1 && amondIndex !== -1 && cloudflareIndex < amondIndex) {
          throw cloudflareOrderingError()
        }
        if (!state.cloudflarePrepared && !state.isPreview) {
          throw stackless(
            new Error(
              '[amond] The Cloudflare plugin is present, but amond() could not see it while Vite ' +
              'resolved the config, so amond() configured the Node target instead. Add amond() ' +
              'and cloudflare() as plain entries of the same `plugins` array (not wrapped in ' +
              'a Promise or added by another plugin), with amond() first.',
            ),
          )
        }
        if (!workerConfigSource.customizerInvoked && !state.isPreview) {
          throw stackless(
            new Error(
              '[amond] The Cloudflare plugin is not receiving amond\'s Worker configuration ' +
              '(the generated Worker entry and per-agent Durable Object bindings). Pass ' +
              'amond\'s config customizer to cloudflare():\n\n' +
              '  import { amond, amondWorkerConfig } from \'@amond-ai/agent-vite\';\n' +
              '  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })]\n',
            ),
          )
        }
      }
    },

    resolveId(source) {
      switch (source) {
        case VIRTUAL_APP: {
          const app = state.project?.app
          return app ? normalizePath(app) : undefined
        }
        case VIRTUAL_DB: {
          const db = state.project?.db
          return db ? normalizePath(db) : RESOLVED_DB_STUB
        }
        case VIRTUAL_AGENTS:
          return RESOLVED_AGENTS
        case VIRTUAL_PROVIDERS:
          return RESOLVED_PROVIDERS
        case VIRTUAL_SERVER:
          return bootstrap.server
        case VIRTUAL_WORKER_ENTRY:
          return RESOLVED_WORKER_ENTRY
        default:
          return undefined
      }
    },

    load(id) {
      if (id === RESOLVED_DB_STUB) {
        return 'export default undefined;\n'
      }
      if (id === RESOLVED_AGENTS) {
        return generateScannedAgentsModule(state.agents)
      }
      if (id === RESOLVED_PROVIDERS) {
        return generateProvidersModule(state.project?.providers)
      }
      if (id === RESOLVED_WORKER_ENTRY) {
        // The Cloudflare Worker entry. The sibling plugin points wrangler
        // `main` here (via amondWorkerConfig()) and resolves it through
        // Vite's plugin pipeline in both dev and build; bare imports in
        // the generated code resolve against the user's project root.
        const app = state.project?.app
        if (!app) { throw missingAppEntryError(state.project) }
        return generateCloudflareEntry({
          appEntry: app,
          cloudflareEntry: state.project.cloudflare,
          agents: state.agents,
          providers: state.project.providers,
          tracing: state.project.tracing,
        })
      }
      return undefined
    },

    transform: {
      // Hook-level filters keep the handler out of irrelevant modules
      // entirely (evaluated natively by rolldown); the handler re-checks
      // against the scanned set, which the filters cannot express.
      filter: {
        id: /\.(?:ts|mts|js|mjs)(?:\?|$)/,
        code: /use agent/,
      },
      async handler(code, id) {
        const filePath = id.split('?')[0] ?? id
        if (!isAgentModulePath(filePath)) { return null }
        const scanned = state.agentsByPath.get(normalizePath(filePath))
        if (!scanned || scanned.length === 0) { return null }
        if (!code.includes(AGENT_DIRECTIVE)) { return null }
        return transformUseAgentModule({ code, id, filePath, agents: scanned })
      },
    },

    configureServer(server) {
      if (state.target === 'cloudflare') {
        const supervision = setupCloudflareDevSupervision({
          server,
          state,
          requestRestart,
          updateAgents,
        })
        // Stop supervising when THIS server closes: detach the watcher
        // handler, drop queued refreshes, and settle in-flight refresh work
        // before teardown — a late re-resolution would otherwise regenerate
        // inputs (or log resolution errors) against a project that the
        // server's owner may already be tearing down.
        const originalClose = server.close.bind(server)
        server.close = async () => {
          closedServers.add(server)
          supervision.stop()
          await state.watchQueue.settled()
          await originalClose()
        }
        return
      }
      // Agent code runs in this process and providers resolve API keys from
      // process.env; load the project's .env set (shell values win) so
      // `vite dev` matches `amond run` instead of requiring a shell export.
      const injectedEnv = applyDevEnv({
        mode: server.config.mode,
        envDir: server.config.envDir,
      })
      if (injectedEnv.length > 0) {
        server.config.logger.info(
          `[amond] Loaded ${injectedEnv.length} variable${injectedEnv.length === 1 ? '' : 's'} from the project .env files.`,
        )
      }

      const controller = createNodeDevController({
        server,
        root: state.root,
        explainLoadError: error => explainCloudflareImport(error, importTrace, state.root),
      })

      // Stop the loaded application when THIS server closes so no listeners
      // or store handles leak. Bound per server instance (not a plugin-level
      // hook) because server.restart() builds the new server — re-running
      // this hook with a fresh controller — before closing the old one.
      const originalClose = server.close.bind(server)
      server.close = async () => {
        closedServers.add(server)
        await controller.close()
        await state.watchQueue.settled()
        await originalClose()
      }

      const rescan = (): Promise<void> =>
        state.watchQueue.schedule(async () => {
          let agents: AgentScanResult[]
          try {
            agents = await scanAgents({
              sourceRoot: state.project.sourceRoot,
              agents: state.project.agents,
            })
          }
          catch (error) {
            // Keep the previous set: a duplicate identity or a module
            // mid-edit shouldn't tear the app down. A later fix re-scans.
            server.config.logger.error(
              `[amond] Agent scan failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return
          }
          if (!agentSetChanged(state.agents, agents)) { return }
          updateAgents(agents)
          invalidateAgentsModule(server)
          controller.scheduleReload()
        })

      server.watcher.on('all', (event, file) => {
        const filePath = normalizePath(file)
        if (isAmondConfigPath(filePath, state)) {
          server.config.logger.info('[amond] amond.config changed; restarting the dev server.')
          requestRestart(server)
          return
        }
        // Marked-set watch: any source-module event re-checks directive
        // prologues; a marked-set change regenerates virtual:amond/agents.
        if (
          (event === 'add' || event === 'change' || event === 'unlink') &&
          isAgentModulePath(filePath) &&
          isWithinDirectory(filePath, normalizePath(state.project.sourceRoot))
        ) {
          void rescan()
        }
        // Reload when the change touches the loaded application graph
        // (Vite has already invalidated the file's module nodes).
        if (moduleGraphHasFile(server, filePath)) {
          controller.scheduleReload()
        }
      })

      controller.start()

      // Install after Vite's internal middlewares so transform/HMR
      // endpoints keep working; everything else is the application's.
      return () => {
        server.middlewares.use((req, res) => {
          // Swallow Chrome DevTools' well-known probe: an app with a
          // catch-all route would otherwise route browser noise into user
          // code (potentially an agent invocation).
          if (req.url?.startsWith(CHROME_DEVTOOLS_PROBE_PATH)) {
            res.statusCode = 404
            res.end()
            return
          }
          controller.handleRequest(req, res)
        })
      }
    },

    buildEnd(error) {
      // A failed Node build gets the import-chain diagnostic appended:
      // rolldown's own error names the offending specifier, not the route
      // to it. (The build error itself already propagates; this is
      // supplementary context on stderr.)
      if (!error || state.target !== 'node') { return }
      const explanation = explainCloudflareImport(error, importTrace, state.root)
      if (explanation) { console.error(`[amond] ${explanation}`) }
    },

    configurePreviewServer(server) {
      // Cloudflare preview is fully owned by the sibling plugin (it runs
      // workerd over the built Worker output); amond contributes nothing.
      if (state.target === 'cloudflare') { return }
      return configureNodePreview(server)
    },
  }

  return [
    corePlugin,
    markdownImportPlugin(),
    importTrace.plugin,
    amondDependencyResolverPlugin(resolverState),
    cloudflareAgentsResolverPlugin(state),
  ]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Cloudflare dev supervision. The sibling plugin runs workerd, serves the
 * app, and owns the wrangler config end to end — it watches the user's
 * authored wrangler file (its `configPath`) and restarts itself on edits.
 * amond's only dev job is reacting to structural project changes:
 *
 * - A changed agent set (agent file add/remove, directive change, identity
 *   change, module move) or changed entry modules (`app.ts`/`cloudflare.ts`
 *   discovery) restarts the dev server. The restart re-runs amond's `config`
 *   hook (fresh scan) and the sibling's config resolution, which re-invokes
 *   `amondWorkerConfig()` with the new Durable Object bindings and Worker
 *   entry — the same treatment the sibling gives its own config changes.
 * - An authored wrangler config appearing or disappearing restarts the dev
 *   server (the sibling's watcher covers only `change` events on files that
 *   existed at resolution time).
 * - `amond.config.*` changes restart the dev server (project re-resolution).
 * - Body edits regenerate nothing; the sibling's own module invalidation
 *   serves them.
 *
 * Failures during re-scanning (mid-edit syntax, duplicate identities) are
 * logged and leave the last good state in place; the next successful edit
 * recovers.
 */
function setupCloudflareDevSupervision(options: {
  server: ViteDevServer
  state: AmondPluginState
  requestRestart: (server: ViteDevServer) => void
  updateAgents: (agents: AgentScanResult[]) => void
}): { stop: () => void } {
  const { server, state, requestRestart, updateAgents } = options
  const logger = server.config.logger

  let stopped = false

  const refresh = (): Promise<void> =>
    state.watchQueue.schedule(async () => {
      if (stopped) { return }
      // The project root itself is gone (deleted out from under the dev
      // server, or torn down while watcher events were still queued).
      // There is nothing to supervise — and every queued unlink would
      // re-log a misleading resolution error — so stop.
      if (!fs.existsSync(state.root)) {
        stop()
        return
      }
      let project: ResolvedAmondProject
      try {
        project = resolveAmondProject({
          root: state.root,
          config: state.mergedConfig,
          configPath: state.configPath,
        })
      }
      catch (error) {
        logger.error(`[amond] Project re-resolution failed: ${formatWatchError(error)}`)
        return
      }
      if (!project.app) {
        logger.error(missingAppEntryError(project).message)
        return
      }
      let agents: AgentScanResult[]
      try {
        agents = await scanAgents({ sourceRoot: project.sourceRoot, agents: project.agents })
      }
      catch (error) {
        // Keep the previous set: a duplicate identity or a module mid-edit
        // shouldn't tear the app down. A later fix re-scans.
        logger.error(`[amond] Agent scan failed: ${formatWatchError(error)}`)
        return
      }
      if (stopped) { return }
      const structuralChange =
        project.app !== state.project.app ||
        project.cloudflare !== state.project.cloudflare ||
        agentSetChanged(state.agents, agents)
      state.project = project
      updateAgents(agents)
      if (structuralChange) {
        logger.info('[amond] The agent set or entry modules changed; restarting the dev server.')
        requestRestart(server)
      }
    })

  const normalizedRoot = normalizePath(state.root)
  const onWatchEvent = (event: string, file: string): void => {
    if (stopped) { return }
    const filePath = normalizePath(file)
    // Never react to workerd/wrangler local state (miniflare SQLite and
    // friends can live under the source root when sourceRoot == root).
    if (filePath.startsWith(`${normalizedRoot}/.wrangler/`)) { return }
    if (isAmondConfigPath(filePath, state)) {
      logger.info('[amond] amond.config changed; restarting the dev server.')
      requestRestart(server)
      return
    }
    // An authored wrangler config appearing or disappearing is a
    // structural change the sibling cannot see: its config watcher covers
    // only `change` events on files that existed at resolution time.
    // (Edits to an existing file stay the sibling's job.)
    if (
      (event === 'add' || event === 'unlink') &&
      AUTHORED_WRANGLER_BASENAMES.some(basename => filePath === `${normalizedRoot}/${basename}`)
    ) {
      logger.info(
        `[amond] ${path.basename(filePath)} was ${event === 'add' ? 'created' : 'removed'}; restarting the dev server.`,
      )
      requestRestart(server)
      return
    }
    // Source-module events re-check directive prologues and entry
    // discovery; refresh() restarts only on structural change.
    if (
      (event === 'add' || event === 'change' || event === 'unlink') &&
      isAgentModulePath(filePath) &&
      isWithinDirectory(filePath, normalizePath(state.project.sourceRoot))
    ) {
      void refresh()
    }
  }
  server.watcher.on('all', onWatchEvent)

  const stop = (): void => {
    stopped = true
    server.watcher.off('all', onWatchEvent)
  }
  return { stop }
}

function formatWatchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a cloudflare plugin entry precedes amond's core plugin in the raw
 * user plugin array (nested arrays flattened; promise entries skipped —
 * `configResolved` re-validates against the final array).
 */
function cloudflarePluginPrecedesAmond(plugins: UserConfig['plugins'], corePlugin: Plugin): boolean {
  const flattened = flattenPluginOptions(plugins)
  const cloudflareIndex = flattened.findIndex(plugin => isCloudflarePluginName(plugin.name))
  const amondIndex = flattened.indexOf(corePlugin)
  return cloudflareIndex !== -1 && amondIndex !== -1 && cloudflareIndex < amondIndex
}

/** The `cloudflare` provider is the Workers AI binding — a Cloudflare-target concept. */
function cloudflareProviderOnNodeError(): Error {
  return stackless(
    new Error(
      `[amond] The 'cloudflare' provider is not available on the Node target: ` +
      `it dispatches through the Workers AI binding (env.AI), which only exists ` +
      `on Cloudflare. Remove 'cloudflare' from the providers list, or build for ` +
      `the Cloudflare target. To reach the same models from Node over HTTP, list ` +
      `'cloudflare-workers-ai' or 'cloudflare-ai-gateway' instead (authenticated ` +
      `via CLOUDFLARE_API_KEY / CLOUDFLARE_ACCOUNT_ID).`,
    ),
  )
}

/** Parity with the legacy Cloudflare build: db.ts is a Node-target concept. */
function dbOnCloudflareError(): Error {
  return stackless(
    new Error(
      `[amond] Custom persistence (db.ts) is not supported on the Cloudflare target. ` +
      `Cloudflare agents use Durable Object SQLite automatically. ` +
      `Remove the db.ts file or move it outside the source root.`,
    ),
  )
}

/**
 * Warn when the discovered config file has same-directory siblings that the
 * basename priority silently loses to it — a stray `amond.config.js` next to an
 * `amond.config.ts` is a support ticket waiting to happen.
 */
function amondConfigAmbiguityWarning(configPath: string | undefined): string | undefined {
  if (!configPath) { return undefined }
  const configDir = path.dirname(configPath)
  const siblings = AMOND_CONFIG_BASENAMES.map(basename => path.join(configDir, basename)).filter(
    candidate => fs.existsSync(candidate),
  )
  if (siblings.length <= 1) { return undefined }
  return (
    `[amond] Multiple amond config files found (${siblings.map(sibling => path.basename(sibling)).join(', ')}); ` +
    `using ${path.basename(configPath)}. Delete the others to avoid surprises.`
  )
}

/** Warning lines for user-set Vite config paths that amond's returned config overrides. */
function enforcedConfigWarnings(userConfig: UserConfig, enforcedPaths: string[]): string[] {
  const overridden = enforcedPaths.filter(dottedPath => definedAtPath(userConfig, dottedPath))
  if (overridden.length === 0) { return [] }
  return [
    `[amond] The following Vite config options are overridden by amond():\n${overridden
      .map(dottedPath => `  - ${dottedPath}`)
      .join('\n')}`,
  ]
}

function definedAtPath(value: unknown, dottedPath: string): boolean {
  let current: unknown = value
  for (const segment of dottedPath.split('.')) {
    if (current === null || typeof current !== 'object') { return false }
    current = (current as Record<string, unknown>)[segment]
  }
  return current !== undefined
}

function generateScannedAgentsModule(agents: readonly AgentScanResult[]): string {
  // One import per module file; one entry per agent export.
  const filePaths = [...new Set(agents.map(agent => normalizePath(agent.filePath)))]
  const varByPath = new Map(
    filePaths.map((filePath, index) => [filePath, `__amond_agent_module_${index}__`]),
  )
  const imports = filePaths
    .map(filePath => `import * as ${varByPath.get(filePath)} from ${JSON.stringify(filePath)};`)
    .join('\n')
  const entries = agents
    .map(
      agent =>
        `\t{ identity: ${JSON.stringify(agent.identity)}, agent: ${varByPath.get(normalizePath(agent.filePath))}[${JSON.stringify(agent.exportName)}] },`,
    )
    .join('\n')
  return `// Generated by @amond-ai/agent-vite — the scanned 'use agent' agent set.\n${imports}\nexport const scannedAgents = [\n${entries}\n];\n`
}

function agentSetChanged(
  previous: readonly AgentScanResult[],
  next: readonly AgentScanResult[],
): boolean {
  if (previous.length !== next.length) { return true }
  return previous.some(
    (agent, index) =>
      agent.filePath !== next[index]?.filePath ||
      agent.exportName !== next[index]?.exportName ||
      agent.identity !== next[index]?.identity,
  )
}

function invalidateAgentsModule(server: ViteDevServer): void {
  for (const environment of Object.values(server.environments)) {
    const moduleNode = environment.moduleGraph.getModuleById(RESOLVED_AGENTS)
    if (moduleNode) { environment.moduleGraph.invalidateModule(moduleNode) }
  }
}

function moduleGraphHasFile(server: ViteDevServer, filePath: string): boolean {
  for (const environment of Object.values(server.environments)) {
    const modules = environment.moduleGraph.getModulesByFile(filePath)
    if (modules && modules.size > 0) { return true }
  }
  return false
}

/**
 * Reject a build output directory that identifies the project root or source
 * root — or any ancestor of them — including through path aliases. The build
 * empties the output directory, so such a configuration deletes the project
 * before writing anything.
 */
function assertSafeBuildOutDir(root: string, sourceRoot: string, outDir: string): void {
  const canonicalOut = normalizePath(canonicalizePath(path.resolve(root, outDir)))
  const guarded: [string, string][] = [
    [root, 'project root'],
    [sourceRoot, 'source root'],
  ]
  for (const [directory, label] of guarded) {
    const canonical = normalizePath(canonicalizePath(directory))
    if (isWithinDirectory(canonical, canonicalOut)) {
      throw stackless(
        new Error(
          `[amond] build.outDir "${outDir}" resolves to "${canonicalOut}", which is or contains the ${label} "${canonical}". The build empties the output directory, so this would delete the project. Point build.outDir somewhere outside the project sources (e.g. "dist").`,
        ),
      )
    }
  }
}

/**
 * Whether a watched file is the project's amond config: the discovered config
 * file, or — when none was discovered at startup — any `amond.config.*`
 * candidate appearing at the project root (its creation must also restart).
 */
function isAmondConfigPath(filePath: string, state: AmondPluginState): boolean {
  if (state.configPath) { return filePath === normalizePath(state.configPath) }
  return AMOND_CONFIG_BASENAMES.some(
    basename => filePath === normalizePath(path.join(state.root, basename)),
  )
}

function containsCloudflarePlugin(plugins: UserConfig['plugins']): boolean {
  return flattenPluginOptions(plugins).some(plugin => isCloudflarePluginName(plugin.name))
}

function flattenPluginOptions(plugins: PluginOption[] | undefined): Plugin[] {
  const found: Plugin[] = []
  const visit = (option: PluginOption): void => {
    if (!option || typeof option !== 'object') { return }
    if (Array.isArray(option)) {
      for (const entry of option) { visit(entry) }
      return
    }
    // Skip promises: async plugin factories resolve during Vite config
    // resolution; configResolved re-detects against the final array.
    if (typeof (option as PromiseLike<unknown>).then === 'function') { return }
    if (typeof (option as Plugin).name === 'string') { found.push(option as Plugin) }
  }
  if (plugins) { visit(plugins) }
  return found
}

/** `@cloudflare/vite-plugin` registers `vite-plugin-cloudflare` (+ `:suffixed`) plugins. */
function isCloudflarePluginName(name: string | undefined): boolean {
  return (
    name === 'vite-plugin-cloudflare' || (name?.startsWith('vite-plugin-cloudflare:') ?? false)
  )
}

function missingAppEntryError(project: ResolvedAmondProject): Error {
  const suggestedPath = path.join(path.relative(project.root, project.sourceRoot) || '.', 'app.ts')
  return stackless(
    new Error(
      `[amond] No app entry found. app.ts is the application's route map and the only required file.\n\n` +
      `Create ${suggestedPath} with:\n\n` +
      `  import { Hono } from 'hono';\n` +
      `  export default new Hono().get('/', (c) => c.text('Hello from amond'));\n\n` +
      `(or set \`app\` in amond.config.ts to an existing entry module).`,
    ),
  )
}

/**
 * Locate the bootstrap modules next to this file — TypeScript sources when
 * running from the repo (tests), bundled .mjs in the published package.
 * Returned paths are Vite-normalized so they match module-graph ids.
 */
function resolveBootstrapPaths(): { server: string, entry: string } {
  return {
    server: locateBootstrapModule('node-server'),
    entry: locateBootstrapModule('node-entry'),
  }
}

function locateBootstrapModule(basename: string): string {
  const packageDir = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [
    path.join(packageDir, 'bootstrap', `${basename}.ts`),
    path.join(packageDir, 'bootstrap', `${basename}.mjs`),
  ]) {
    if (fs.existsSync(candidate)) { return normalizePath(candidate) }
  }
  throw new Error(`[amond] Unable to locate the bundled bootstrap module "${basename}".`)
}
