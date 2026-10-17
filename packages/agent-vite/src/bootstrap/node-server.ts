/**
 * The Node application bootstrap, loaded through the Vite graph as
 * `virtual:amond/server`.
 *
 * This is the CLI's generated-entry template
 * (packages/cli/src/lib/build-plugin-node.ts `generateRuntimeEntryPoint`)
 * ported to a real, testable module. Instead of codegen splices it consumes
 * amond's virtual modules: the user's app (`virtual:amond/app`), the optional
 * persistence adapter (`virtual:amond/db`), and the scanned `'use agent'` set
 * (`virtual:amond/agents`).
 *
 * The registered agent set comes from the scan — `createAgentRouter()`
 * mounts in app.ts are pure routers over it. There are no workflows and no
 * channel-handler registry on this surface: mounting is the dispatch.
 */
import { scannedAgents } from 'virtual:amond/agents'
import userApp from 'virtual:amond/app'
import userPersistenceAdapter from 'virtual:amond/db'
// Registers the configured (or default) provider set; user `setProvider()`
// calls in app.ts win over it regardless of evaluation order.
import 'virtual:amond/providers'
import type { Agent } from '@amond-ai/agent'
import type {
  AmondAgentRegistration,
  AssembledNodeAgentRuntime,
  PersistenceAdapter,
} from '@amond-ai/agent/internal'
import {
  adapterInUseByLiveRuntime,
  assembleNodeAgentRuntime,
  connectPersistenceAdapter,
  createInstrumentationOwner,
  installDevLifecycleLogger,
  runWithInstrumentationOwner,
} from '@amond-ai/agent/internal'
import { sqlite } from '@amond-ai/agent/node'
import { serve } from '@hono/node-server'
import type {
  AmondNodeServer,
  LoadAmondNodeApplicationOptions,
  LoadedAmondNodeApplication,
  StartAmondNodeServerOptions,
} from '../types.ts'

export type {
  AmondNodeActivityLease,
  AmondNodeServer,
  LoadAmondNodeApplicationOptions,
  LoadedAmondNodeApplication,
  StartAmondNodeServerOptions,
} from '../types.ts'

/** Build the identity-keyed registration records from the scanned agent set. */
function createAgentRegistrations(): AmondAgentRegistration[] {
  return scannedAgents.map(({ identity, agent }) => ({
    identity,
    agent: agent as Agent,
  }))
}

export async function loadAmondNodeApplication(
  options: LoadAmondNodeApplicationOptions = {},
): Promise<LoadedAmondNodeApplication> {
  const runtimeEnv = options.env ?? process.env
  const isLocalMode = options.local === true
  const instrumentationOwner = createInstrumentationOwner()
  let devLifecycle: ReturnType<typeof installDevLifecycleLogger> | undefined
  let persistenceAdapter: PersistenceAdapter | undefined
  let assembled: AssembledNodeAgentRuntime | undefined
  try {
    return await runWithInstrumentationOwner(instrumentationOwner, async () => {
      devLifecycle = isLocalMode ? installDevLifecycleLogger() : undefined

      // ─── Persistence ──────────────────────────────────────────────
      // Custom persistence from db.ts, or the Node default — in-memory
      // SQLite, process lifetime. Under local dev, AMOND_DEV_SQLITE_PATH
      // points the default at a disk file so conversation history
      // survives reloads (the dev server resets that file on each cold
      // start); ignored outside local mode, so deployed Node stays
      // in-memory. Either way connect() is awaited once at startup so an
      // unreachable or misconfigured database fails at boot, not inside
      // the first request.
      const adapter: PersistenceAdapter =
        userPersistenceAdapter !== undefined
          ? (userPersistenceAdapter as PersistenceAdapter)
          : sqlite(
              isLocalMode && runtimeEnv.AMOND_DEV_SQLITE_PATH
                ? runtimeEnv.AMOND_DEV_SQLITE_PATH
                : undefined,
            )
      const stores = await connectPersistenceAdapter(
        adapter,
        userPersistenceAdapter !== undefined ? 'db.ts' : 'the default sqlite adapter',
      )
      persistenceAdapter = adapter

      // ─── Runtime assembly ─────────────────────────────────────────
      // The scan IS the registration: every 'use agent' module joins the
      // app, replacing any previous registration wholesale (reload-safe).
      // The shared assembly wires registration → coordinator → dispatch
      // queue → runtime seed → startup reconciliation; it seeds the
      // runtime before the application is installed into its listener,
      // so routers mounted during app.ts evaluation read the
      // configuration when requests arrive.
      const runtime = await assembleNodeAgentRuntime({
        agents: createAgentRegistrations(),
        adapter,
        stores,
        env: runtimeEnv,
        devMode: isLocalMode,
      })
      assembled = runtime
      const { activityGate } = runtime

      // ─── App composition ──────────────────────────────────────────
      // The user's app.ts default export owns the entire request
      // pipeline; we just verify it exposes a fetch method.
      const amondApp = userApp
      if (!amondApp || typeof amondApp.fetch !== 'function') {
        throw new Error(
          '[amond] app.ts default export must be a Hono app or an object with a fetch(request) method.',
        )
      }

      let disposing: Promise<void> | undefined
      return {
        fetch: (request: Request, env?: unknown) => amondApp.fetch(request, env),
        enterActivity() {
          return activityGate.enter()
        },
        pauseAdmissions() {
          activityGate.pause()
        },
        async stop(timeoutMs = 30_000) {
          if (disposing) { return disposing }
          disposing = (async () => {
            const errors: unknown[] = []
            try {
              // Coordinator shutdown, runtime reset, adapter close.
              await runtime.close(timeoutMs)
            }
            catch (error) {
              errors.push(error)
            }
            try {
              await instrumentationOwner.dispose()
            }
            catch (error) {
              errors.push(error)
            }
            devLifecycle?.dispose()
            if (errors.length === 1) { throw errors[0] }
            if (errors.length > 1) { throw new AggregateError(errors, '[amond] Node application shutdown failed.') }
          })()
          return disposing
        },
        closeSync() {
          devLifecycle?.dispose()
        },
      } satisfies LoadedAmondNodeApplication
    })
  }
  catch (error) {
    const cleanupErrors: unknown[] = []
    try {
      // close() covers the coordinator AND the adapter; before assembly the
      // connected adapter is closed directly — unless a still-serving
      // application owns the same instance (a cached db.ts module hands
      // every dev reload the same adapter).
      if (assembled) { await assembled.close() }
      else if (persistenceAdapter?.close && !adapterInUseByLiveRuntime(persistenceAdapter)) { await persistenceAdapter.close() }
    }
    catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    try {
      await instrumentationOwner.dispose()
    }
    catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    devLifecycle?.dispose()
    if (cleanupErrors.length) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        '[amond] Node application startup failed.',
      ) 
    }
    throw error
  }
}

export async function startAmondNodeServer(
  options: StartAmondNodeServerOptions = {},
): Promise<AmondNodeServer> {
  const application = await loadAmondNodeApplication(options)
  const port = options.port ?? 3000
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const server = serve(
    {
      fetch: application.fetch,
      port,
      ...(options.hostname ? { hostname: options.hostname } : {}),
      serverOptions: { requestTimeout: 0 },
    },
    () => {
      if (!options.quiet) { console.log(`[amond] Server listening on http://localhost:${port}`) }
      options.onReady?.()
      resolveReady()
    },
  ) as import('node:http').Server
  const onServerError = (error: Error) => rejectReady(error)
  const onAbort = () => {
    server.closeAllConnections()
    server.close()
    rejectReady(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  server.once('error', onServerError)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) { onAbort() }
  try {
    await ready
  }
  catch (error) {
    server.closeAllConnections()
    server.close()
    await application.stop()
    throw error
  }
  finally {
    server.off('error', onServerError)
    options.signal?.removeEventListener('abort', onAbort)
  }
  let stopping: Promise<void> | undefined
  return {
    async stop() {
      if (stopping) { return stopping }
      stopping = (async () => {
        const errors: unknown[] = []
        const httpClosed = new Promise<void>(resolve =>
          server.close((error) => {
            if (error) { errors.push(error) }
            resolve()
          }),
        )
        try {
          await application.stop()
        }
        catch (error) {
          errors.push(error)
        }
        server.closeAllConnections()
        await httpClosed
        if (errors.length === 1) { throw errors[0] }
        if (errors.length > 1) { throw new AggregateError(errors, '[amond] Node server shutdown failed.') }
      })()
      return stopping
    },
    closeSync() {
      server.closeAllConnections()
      server.close()
      application.closeSync()
    },
  }
}
