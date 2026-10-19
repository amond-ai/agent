# Architecture

This document maps the `amond-ai/agent` repository: what each part does, where to start reading,
and what the code deliberately does not do. It describes the repository as it is today. The
decisions behind it live in [`docs/adr/`](docs/adr/index.md).

## Bird's-eye overview

`amond/agent` runs coding-agent harnesses such as Claude Code as durable agents, in sandbox
containers, on Cloudflare. The repository is in the middle of a change of base, so it holds two
architectures at once.

**What the code is today.** Ten packages in two groups. Five were imported from Flue v2.3.0
with their history and renamed in source (ADR-0004). They are `@amond-ai/agent` (the runtime),
`@amond-ai/agent-vite` (the Vite plugin), `amond` (the CLI), `@amond-ai/agent-sdk` (the client),
and `@amond-ai/agent-react` (React hooks). The other five were built to ADR-0001 and ADR-0002, and
three of them retire. An agent in the imported packages is a `'use agent'` module. The `amond()`
Vite plugin scans for those modules, and `vite build` turns them into a Node server or, with
`cloudflare({ config: amondWorkerConfig() })`, a Cloudflare Worker with one Durable Object class
per agent. Turns still run through Flue's host-side Pi agent loop.

```text
vite.config.ts                        vite build                         deployed target
amond()                               ┌──────────────────────┐
cloudflare({ config:        ──────►   │ agent-vite           │  ──►   Node server, or Worker +
  amondWorkerConfig() })              │ scan 'use agent'     │        Durable Object per agent
'use agent' modules            ─────► │ modules, emit entry  │        (runtime: @amond-ai/agent)
                                      └──────────────────────┘
clients: @amond-ai/agent-sdk ──► @amond-ai/agent-react (useAmondAgent)
CLI: amond init | run | docs | add | update
```

The ADR-0001 build step, `amond build` over an `agent/` tree, is retired with the old `amond`
package. `createHandlers`, the Cloudflare durable runtime, and both harness adapters still throw
`not implemented`.

**Where it is going.** [ADR-0003](docs/adr/0003-build-on-flue-with-ai-sdk-harness.md) and
[ADR-0004](docs/adr/0004-ship-flue-as-amond-packages.md) supersede the ADR-0001 design. Each agent
runs as a Cloudflare Durable Object, and its turns run through the
AI SDK harness (`HarnessV1`) inside a Cloudflare Sandbox container, instead of through Flue's
host-side Pi loop. The Durable Object runtime is in the repository now; the seam, the harness
turns, and the sandbox are not. The work is tracked in
[#15](https://github.com/amond-ai/agent/issues/15)–[#18](https://github.com/amond-ai/agent/issues/18).
The import itself is [#20](https://github.com/amond-ai/agent/issues/20).

```text
request / cron / event
        │
        ▼
Durable Object per agent  (@amond-ai/agent, imported from @flue/runtime)
        │  durable submission, persistence in the DO's SQLite
        ▼
session ──► agent-loop seam (#16) ──► HarnessV1 turn (#17)
                                           │
                                           ▼
                            Cloudflare Sandbox container (#15)
                            one sandbox shared by Flue's tools and the harness
```

Three of the packages that predate ADR-0003 retire in #18: `agent-core`, `agent-durable`, and
`agent-durable-cloudflare`. The old ADR-0001 `amond` CLI is already retired, and its name now
belongs to the imported CLI. The two harness adapters are reassessed once the agent-loop seam
exists. Do not grow those five; new framework work goes in the imported packages.

## Entry points

Start with the imported packages, which are the product:

- `packages/agent/src/index.ts` — `@amond-ai/agent`, the runtime. `packages/agent/src/cloudflare/`
  and `packages/agent/src/node/` hold the two platform adapters.
- `packages/agent-vite/src/amond-plugin.ts` — the `amond()` Vite plugin.
  `cloudflare-worker-config.ts` holds `amondWorkerConfig()`, and `agent-scan.ts` finds the
  `'use agent'` modules.
- `packages/cli/src/main.ts` — the `amond` CLI. `commands/` holds `init` and `run`, plus `docs`,
  `add`, and `update`, which serve the bundled docs and blueprint index.
- `packages/agent-sdk/src/index.ts` — the client. `packages/agent-react/src/use-agent.ts` —
  `useAmondAgent`, built on the client.

For the contracts of the packages that predate ADR-0003:

- `packages/core/src/index.ts` — `AgentManifest`, `HarnessAdapter`, `TurnSpec`, `TurnOutcome`,
  and `createHandlers`.
- `packages/durable/src/index.ts` — the `DurableRuntime` contract.
  `packages/durable/src/memory.ts` is its only working implementation.

For the direction of the codebase:

- `docs/adr/0003-build-on-flue-with-ai-sdk-harness.md` and
  `docs/adr/0004-ship-flue-as-amond-packages.md` — what replaces the packages above, and why.

For releases:

- `scripts/publish.ts` — publishes the workspace to npm in dependency order. CI and manual
  releases both run it.

## Module structure

### `packages/agent/` — `@amond-ai/agent`

The runtime, imported from `@flue/runtime`. It defines agents, sessions, durable submissions,
conversation persistence, and the tools an agent calls. Subpath exports select the platform:
`./node` for development and `./cloudflare` for Durable Objects. Turns run through Pi
(`@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`) until the agent-loop seam replaces it
(#16–#18). Other dependencies are Hono with `@hono/node-server` for HTTP, valibot for schemas, and
`@modelcontextprotocol/client` for MCP tools.

**Status**: the base of the product. The Pi loop will be replaced behind the seam in #16–#18;
the rest stays.

### `packages/agent-vite/` — `@amond-ai/agent-vite`

The Vite plugin, imported from `@flue/vite`. `amond()` scans for `'use agent'` modules and
generates the entry. On Cloudflare it pairs with `cloudflare({ config: amondWorkerConfig() })` from
`@cloudflare/vite-plugin`, which makes each agent a Durable Object class. The Cloudflare `agents`
SDK is a dependency, and `vite` is a peer. The build is `vite build`.

### `packages/cli/` — `amond`

The CLI, imported from `@flue/cli`, with the `amond` binary. Its commands are `init`, `run`,
`docs`, `add`, and `update`. `docs` serves the pages bundled in `packages/cli/docs`
(`src/lib/docs-pages.ts`). `add` and `update` use the blueprint index that
`scripts/generate-blueprint-index.ts` builds from repo-root `blueprints/`, and fetch blueprint text
from `https://blueprints.amond.ai` (`apps/registry/`); `AMOND_REGISTRY_URL` overrides the registry.

### `packages/agent-sdk/` — `@amond-ai/agent-sdk`

The client for a deployed agent, imported from `@flue/sdk`. It streams conversation state through
`@durable-streams/client`.

### `packages/agent-react/` — `@amond-ai/agent-react`

React hooks over the SDK, imported from `@flue/react`. `useAmondAgent` is the entry point. `react`
(18 or later) and `@amond-ai/agent-sdk` are peer dependencies.

All five packages are at 0.1.0, versioned by release-please, and not yet published.

### `packages/core/` — `@amond-ai/agent-core`

Types only, plus one unimplemented function. It defines what the manifest holds
(`AgentManifest`, `ToolDefinition`, `SkillDefinition`, `ScheduleDefinition`,
`ChannelDefinition`), what `agent/agent.ts` exports (`AgentConfig`), the harness seam
(`HarnessAdapter.runTurn(TurnSpec) → TurnOutcome`), and the handlers a platform invokes
(`AgentHandlers`). A `TurnOutcome` is `done`, `deferred` (a tool the policy defers ended the turn),
or `failed`.

`createHandlers` is the seam between a generated entry point and routing. It throws.

**Status**: retiring in #18.

### `packages/durable/` — `@amond-ai/agent-durable`

The ADR-0002 durable execution contract. A session is driven by a `SessionStep` that returns
`continue`, `wait` (on a named event), or `done`. The runtime stores each outcome as a
`SessionRecord` with status `running`, `waiting`, `done`, or `failed`. The contract exposes
`start`, `resume`, and `get`.

`createMemoryRuntime` is the reference implementation and the test double. It keeps state in
`Map`s, so state is lost when the process exits.

**Status**: retiring in #18. The durable submissions and persistence in `@amond-ai/agent` replace it.

### `packages/durable-cloudflare/` — `@amond-ai/agent-durable-cloudflare`

The planned Cloudflare Workflows adapter for `DurableRuntime`. `createCloudflareRuntime` throws.
`@cloudflare/workers-types` is a peer dependency, and the Workflow binding is typed as `unknown`
so the package does not pin a workers-types version.

**Status**: retiring in #18, never implemented.

### `packages/harness-claude-code/` — `@amond-ai/agent-harness-claude-code`

The planned adapter from `HarnessAdapter` to `@amond-ai/harness-claude-code`'s turn driver, with
`@amond-ai/sandbox` for the sandbox contract. `claudeCode(options)` throws.

**Status**: reassessed once the agent-loop seam (#16) exists. Under ADR-0003 the harness runs
through `HarnessV1`, not through this `HarnessAdapter` interface.

### `packages/harness-codex/` — `@amond-ai/agent-harness-codex`

A second adapter, kept as a spike to test whether `HarnessAdapter` holds for more than one
harness. It is `private: true` and absent from `release-please-config.json`, so it is never
published. `codex(options)` throws.

### `apps/registry/` — `@amond-ai/registry`

The blueprint registry site that `amond add` and `amond update` fetch from, served at
`https://blueprints.amond.ai`. It is an assets-only Cloudflare Worker: `wrangler.jsonc` names
`./dist` and no Worker script. `bun run build` reads repo-root `blueprints/` and writes one
`dist/<slug>.md` per blueprint and kind root, with the JSON frontmatter removed. It derives slugs
with `buildBlueprintIndex` from `packages/cli/src/lib/blueprint-index.ts`, the same function
that writes the CLI's bundled index, so the CLI and the site cannot disagree on a name. An
alias gets no file, because the CLI resolves an alias to its slug before it fetches. An unknown
path returns a plain 404.

The package is `private: true` and absent from `release-please-config.json`, so it is never
published to npm.

### `scripts/`

`publish.ts` publishes the workspace packages to npm in dependency order. It is safe to re-run
after a failed release. The file's header comment explains why it packs with bun and publishes
with the npm CLI.

### `vendor/`

Read-only git submodules for `withastro/flue` and `vercel/eve`, never imported by any package.
`vendor/flue` is the reference for the Flue import and for judging upstream changes. The pinned
revisions are listed in [the tech stack](docs/knowledge/tech-stack.md#upstream-code). Run
`git submodule update --init` to populate them.

### `docs/`

- `adr/` — architecture decision records. ADR-0001 and ADR-0002 are superseded by ADR-0003.
  ADR-0004 supersedes decision 1 of ADR-0003.
- `knowledge/` — product, guidelines, tech stack, and workflow references.
- `specs/` — product specs index.

### Dependency direction

```text
@amond-ai/agent-react ──► @amond-ai/agent-sdk (peer)
amond (CLI) ──► @amond-ai/agent-vite ──► @amond-ai/agent
amond (CLI) ──► @amond-ai/agent

@amond-ai/agent-durable
        ▲            ▲
        │            └── @amond-ai/agent-durable-cloudflare
@amond-ai/agent-core
        ▲            ▲
        │            ├── @amond-ai/agent-harness-claude-code ──► @amond-ai/harness-claude-code, @amond-ai/sandbox
        │            └── @amond-ai/agent-harness-codex
```

Arrows point from a package to what it depends on. The imported packages and the retiring ones do
not depend on each other. `agent-durable` depends on nothing in the workspace, and `agent-core`
never depends on an adapter.

## Architecture invariants

**Unimplemented means it throws.** `createHandlers`, `createCloudflareRuntime`, `claudeCode`, and
`codex` throw `not implemented`. None returns a plausible placeholder, because a shaped fake would
let a build look deployable, or a test pass, while proving nothing. The imported CLI follows the
same rule for a broken install: `amond docs` errors when its docs directory is missing, and
`amond add` and `update` error when the generated blueprint index is empty, rather than print fake
pages.

**The user owns the deploy config.** The Vite plugin generates the Worker entry and Durable Object
classes, but not `wrangler.jsonc`. The README keeps this rule for the Cloudflare Sandbox
container: `wrangler.jsonc`, including the container, stays with the user, so a framework release
cannot rewrite a deployment.

**Durable sessions are idempotent by caller ID.** `start` with an existing ID returns the stored
record without re-running anything. `resume` drives a session only when it is `waiting` on the
same event name, and it passes the event to the first step call only.

**No package pins `@cloudflare/workers-types`.** `agent-durable-cloudflare` takes it as a peer
dependency.

**`vendor/` is never imported or edited.** It is a reference to upstream. Flue code enters the
repository through `git subtree` into `packages/`, and upstream changes are ported by hand
(ADR-0004).

**Do not grow the retiring packages.** New framework work belongs in the packages imported from
Flue. `agent-core`, `agent-durable`, and `agent-durable-cloudflare` are removed in #18.

**Users see amond names only.** The imported packages' brand surfaces are renamed in source: `amond`, `amond.config.ts`, `AMOND_*`, `virtual:amond/*`, `Amond<Name>Agent`. No
publish-time rewrite exists. Flue's name appears only in `NOTICE` and in each imported package's
README.

## API boundaries

Nothing is published to npm yet, and every package is pre-1.0.

**Public**:

- `@amond-ai/agent`: the runtime, through `.` and the subpaths `./node`, `./cloudflare`,
  `./cloudflare/workers-ai`, `./config`, `./tool`, `./adapter`, `./routing`, `./telemetry`,
  `./test-utils`, `./test-utils/conversation-stream`, and `./test-utils/attachment-store`. The
  `./internal` and `./cloudflare/internal` subpaths are for sibling packages.
- `@amond-ai/agent-vite`: `amond()` and `amondWorkerConfig()`. `./internal` serves the CLI.
- `amond`: the `amond` binary and its commands `init`, `run`, `docs`, `add`, and `update`.
- `@amond-ai/agent-sdk`: the client.
- `@amond-ai/agent-react`: `useAmondAgent` and its types.
- `@amond-ai/agent-core`: the manifest, config, harness, and handler types, and `createHandlers`.
- `@amond-ai/agent-durable`: the `DurableRuntime` contract and `createMemoryRuntime`.
- `@amond-ai/agent-durable-cloudflare`: `createCloudflareRuntime`.
- `@amond-ai/agent-harness-claude-code`: `claudeCode`.

**Internal**:

- The `./internal` subpaths above, and the `'use agent'` scanner in `agent-vite`.
- `scripts/`, `vitest.shared.ts`, and `eslint.rules.ts`.

The `agent-core`, `agent-durable`, and `agent-durable-cloudflare` surfaces retire with their
packages. The lasting public surface is the set of amond names that ADR-0004 assigns to Flue's
packages.

## Cross-cutting concerns

**Error handling**: The imported CLI reports a usage error and exits non-zero. In the durable
runtime, a step that throws settles the session as `failed`, with the error stored as a string.

**Configuration**: Shared dependency versions live in the root `package.json` `catalog`, plus
`catalogs.workers-v5` for workers-types. Shared lint overrides live in `eslint.rules.ts`, and
shared coverage settings in `vitest.shared.ts`.

**Build**: Each package builds with tsdown into `dist/`; the imported packages carry a
`tsdown.config.ts`, and the retiring ones run `tsdown src/index.ts --dts`. A user's agent project
builds with `vite build`, through `amond()`. Turborepo runs
`build` after the dependencies' builds, `test` after the package's own build, and `check` after
the dependencies' builds.

**Testing**: Tests sit next to the code as `*.test.ts` and run with Vitest under Bun. Coverage
uses Istanbul, because Bun's JavaScriptCore produces no V8 profile.

**Toolchain**: The imported code moved from Flue's pnpm, Biome, and TypeScript 7 onto bun
workspaces, ESLint, and TypeScript 5.9. A single reformat commit applied the ESLint style, and
some rules stay off for the imported packages. Each package keeps Flue's stricter `tsconfig`
options.

**Release**: release-please with the `node-workspace` plugin versions the packages
from Conventional Commits, the five imported ones at 0.1.0. `scripts/publish.ts` publishes them through npm trusted publishing
with provenance.

**Licensing**: Every package ships `LICENSE` (Apache-2.0) and `NOTICE` alongside `dist/`.

---

_Last updated: 2026-10-17 — after the Flue import and rename (#20)._

_See `docs/adr/` for the decisions behind this structure._
