# Architecture

This document maps the `amond-ai/agent` repository: what each part does, where to start reading,
and what the code deliberately does not do. It describes the repository as it is today. The
decisions behind it live in [`docs/adr/`](docs/adr/index.md).

## Bird's-eye overview

`amond/agent` runs coding-agent harnesses such as Claude Code as durable agents, in sandbox
containers, on Cloudflare. The repository is in the middle of a change of base, so it holds two
architectures at once.

**What the code is today.** Six packages built to ADR-0001 and ADR-0002. An agent is a directory,
`agent/`, holding Markdown instructions, a typed config, and one module per tool, schedule, or
channel. The `amond build` command resolves that directory into a static manifest module and one
entry point per platform. At runtime the entry point hands the manifest to `createHandlers`, which
would route requests and cron firings through a durable runtime to a harness adapter. Only the
build half works. `createHandlers`, the Cloudflare durable runtime, and both harness adapters throw
`not implemented`.

```text
agent/                         amond build (Node, has fs)              platform (no fs)
├── instructions.md   ──┐
├── agent.ts            │      loader.ts ──► emit.ts ──► build.ts     .amond/cloudflare.ts
├── tools/*.ts          ├──►   AgentTree     strings     staged swap  .amond/vercel.ts
├── schedules/*.ts      │                                     │              │
├── channels/*.ts       │                                     ▼              ▼
└── skills/*/SKILL.md ──┘                              .amond/manifest.ts ─► createHandlers
                                                                             (not implemented)
```

**Where it is going.** [ADR-0003](docs/adr/0003-build-on-flue-with-ai-sdk-harness.md) and
[ADR-0004](docs/adr/0004-ship-flue-as-amond-packages.md) supersede that design. Flue's packages
are imported into `packages/` with their history and renamed in source to amond names. Each agent
becomes a `'use agent'` module that runs as a Cloudflare Durable Object. Its turns run through the
AI SDK harness (`HarnessV1`) inside a Cloudflare Sandbox container, instead of through Flue's
host-side Pi loop. None of this code is in the repository yet. The work is tracked in
[#15](https://github.com/amond-ai/agent/issues/15)–[#18](https://github.com/amond-ai/agent/issues/18)
and [#20](https://github.com/amond-ai/agent/issues/20).

```text
request / cron / event
        │
        ▼
Durable Object per agent  (@amond-ai/agent, from @flue/runtime)
        │  durable submission, persistence in the DO's SQLite
        ▼
session ──► agent-loop seam (#16) ──► HarnessV1 turn (#17)
                                           │
                                           ▼
                            Cloudflare Sandbox container (#15)
                            one sandbox shared by Flue's tools and the harness
```

Four of the packages that predate ADR-0003 retire in #18: `amond`, `agent-core`, `agent-durable`,
and `agent-durable-cloudflare`. The two harness adapters are reassessed once the agent-loop seam
exists. Read all six to understand the current code, not as the place for new features.

## Entry points

Start with the build pipeline, the only path that runs end to end:

- `packages/amond/src/index.ts` — the `amond` CLI. It parses the command and dispatches. Only
  `build` is implemented; `init` and `dev` exit 1.
- `packages/amond/src/build.ts` — `build(cwd)`. It loads `agent/`, emits the output, and swaps it
  into `.amond/`. It is the only CLI code that writes to disk.
- `packages/amond/src/loader.ts` — `loadAgentTree`. It turns an `agent/` directory into an
  `AgentTree` or throws an `AgentTreeError` that names the file at fault.
- `packages/amond/src/emit.ts` — `emitManifestModule` and `emitEntryPoint`. They turn an
  `AgentTree` into the source text of the generated modules.

For the runtime contracts the generated code targets:

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

### `packages/amond/` — the `amond` CLI

Published as `amond`, with the `amond` binary. It implements the ADR-0001 build step. Running on a
machine with a filesystem, it reads the `agent/` tree and emits a manifest in which every import
is static. That way the deployed target never reads a directory.

- `loader.ts` validates the `agent/` layout and resolves it into an `AgentTree`.
- `emit.ts` turns that tree into a manifest module and one entry point per `BUILD_TARGETS`
  member (`cloudflare`, `vercel`).
- `build.ts` writes the output into `.amond/`.
- `tree-fixture.ts` is a test helper that writes a real `agent/` tree into a temp directory.

**Key abstractions**: `AgentTree`, `AgentTreeError`, `BuildTarget`.

**Status**: retiring in #18. The `amond` name passes to the CLI imported from `@flue/cli`.

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

**Status**: retiring in #18. Flue's durable submissions and persistence replace it.

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

### Planned packages

Issue #20 imports Flue's runtime, Vite plugin, CLI, SDK, and React packages, published as
`@amond-ai/agent`, `@amond-ai/agent-vite`, `amond`, `@amond-ai/agent-sdk`, and
`@amond-ai/agent-react`. ADR-0004 maps each Flue package to its new name.

### Dependency direction

```text
@amond-ai/agent-durable
        ▲            ▲
        │            └── @amond-ai/agent-durable-cloudflare
@amond-ai/agent-core
        ▲            ▲
        │            ├── @amond-ai/agent-harness-claude-code ──► @amond-ai/harness-claude-code, @amond-ai/sandbox
        │            └── @amond-ai/agent-harness-codex
      amond  (also depends on agent-durable directly)
```

Arrows point from a package to what it depends on. `agent-durable` depends on nothing in the
workspace, and `agent-core` never depends on the CLI or on an adapter.

## Architecture invariants

**Unimplemented means it throws.** `createHandlers`, `createCloudflareRuntime`, `claudeCode`, and
`codex` throw `not implemented`, and `amond init` and `amond dev` exit 1. None returns a plausible
placeholder, because a shaped fake would let a build look deployable, or a test pass, while
proving nothing.

**The loader never evaluates user code.** `loadAgentTree` stats paths, reads Markdown, and reads the
source text of each entry module to check for a default export. It never
imports a tool, schedule, channel, or `agent.ts`, so a build does not need the user's environment
to report a misplaced file.

**Nothing reads the filesystem at runtime.** The deployed targets have no `fs`. Every directory
walk happens in `amond build`. The generated manifest inlines instructions and skills as literals
and reaches every entry module through a static `import`.

**Emitters return strings; only `build.ts` writes.** `emit.ts` produces source text, so its tests
assert on strings without a temp directory. `build.ts` is the one place in the CLI that touches
the disk.

**A failed build never leaves a half-written `.amond/`.** Output is staged beside the target and
moved into place by rename. The previous build is renamed aside rather than deleted until the new
one is in place.

**The user owns the deploy config.** `amond build` emits handlers only. It never generates
`wrangler.jsonc`, `vercel.json`, or cron registration, so a framework release cannot rewrite a
deployment. The README keeps this rule for the Cloudflare Sandbox container: `wrangler.jsonc`,
including the container, stays with the user.

**Durable sessions are idempotent by caller ID.** `start` with an existing ID returns the stored
record without re-running anything. `resume` drives a session only when it is `waiting` on the
same event name, and it passes the event to the first step call only.

**No package pins `@cloudflare/workers-types`.** `agent-durable-cloudflare` takes it as a peer
dependency, and the generated Cloudflare entry types its `scheduled` argument structurally.

**`vendor/` is never imported or edited.** It is a reference to upstream. Flue code enters the
repository through `git subtree` into `packages/`, and upstream changes are ported by hand
(ADR-0004).

**Do not grow the retiring packages.** New framework work belongs in the packages imported from
Flue. `amond`, `agent-core`, `agent-durable`, and `agent-durable-cloudflare` are removed in #18.

**Users see amond names only.** Once Flue's code is imported, its brand surfaces are renamed in
source: `amond`, `amond.config.ts`, `AMOND_*`, `virtual:amond/*`, `Amond<Name>Agent`. No
publish-time rewrite exists. Flue's name appears only in `NOTICE` and in each imported package's
README.

## API boundaries

Nothing is published to npm yet, and every package is pre-1.0.

**Public** (each package's `exports["."]`, built to `dist/index.mjs` and `dist/index.d.mts`):

- `amond`: the `amond` binary and `main(argv)`.
- `@amond-ai/agent-core`: the manifest, config, harness, and handler types, and `createHandlers`.
- `@amond-ai/agent-durable`: the `DurableRuntime` contract and `createMemoryRuntime`.
- `@amond-ai/agent-durable-cloudflare`: `createCloudflareRuntime`.
- `@amond-ai/agent-harness-claude-code`: `claudeCode`.
- The `agent/` directory layout that `amond build` reads.

**Internal**:

- `loader.ts`, `emit.ts`, and `build.ts` in `packages/amond/`. The package entry exports only
  `main`.
- The shape of the generated `.amond/` files. They carry a `Generated by amond build` header and
  are rebuilt, not edited.
- `scripts/`, `vitest.shared.ts`, and `eslint.rules.ts`.

The surfaces above retire with their packages. The lasting public surface is the set of
amond names that ADR-0004 assigns to Flue's packages.

## Cross-cutting concerns

**Error handling**: A rejected `agent/` tree raises `AgentTreeError`, whose message and `path`
name the file at fault. `amond build` prints it and exits 1. Any other error, such as a permission
error or a full disk, propagates with its stack. The CLI exits 1 with no command and 2 with an
unknown one. In the durable runtime, a step that throws settles the session as `failed`, with the
error stored as a string.

**Configuration**: Shared dependency versions live in the root `package.json` `catalog`, plus
`catalogs.workers-v5` for workers-types. Shared lint overrides live in `eslint.rules.ts`, and
shared coverage settings in `vitest.shared.ts`.

**Build**: Each package builds with `tsdown src/index.ts --dts` into `dist/`. Turborepo runs
`build` after the dependencies' builds, `test` after the package's own build, and `check` after
the dependencies' builds.

**Testing**: Tests sit next to the code as `*.test.ts` and run with Vitest under Bun. Coverage
uses Istanbul, because Bun's JavaScriptCore produces no V8 profile. Loader tests use real
temporary directories through `tree-fixture.ts`, not a mocked `fs`.

**Release**: release-please with the `node-workspace` plugin versions the five published packages
from Conventional Commits. `scripts/publish.ts` publishes them through npm trusted publishing
with provenance.

**Licensing**: Every package ships `LICENSE` (Apache-2.0) and `NOTICE` alongside `dist/`.

---

_Last updated: 2026-10-17 — first version, after ADR-0004 was accepted and before the Flue
import (#20)._

_See `docs/adr/` for the decisions behind this structure._
