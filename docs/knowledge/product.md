# Product Guide

What `amond/agent` is for, who it serves, and where it stands today. Read it before proposing a
feature, so the proposal fits the decisions already recorded.

## Vision

Run coding-agent harnesses as agents, in sandbox containers, on Cloudflare.

`amond/agent` is derived from [Flue](https://github.com/withastro/flue) and built on
[`amond/harness`](https://github.com/amond-ai/harness), which already runs a coding-agent turn
inside a sandbox and survives a dropped socket. Flue's code supplies what an agent *is*, how a
request, schedule, or event starts one, and how a session stays durable. The harness supplies the
turn itself. The result ships under the amond name: `@amond-ai/agent`, `@amond-ai/agent-vite`,
and the `amond` CLI.

## Target users

- **TypeScript developers** who want to deploy a coding agent such as Claude Code as a durable,
  addressable agent on Cloudflare, without writing the agent loop themselves.
- **Teams already using `@amond-ai/harness-*`** who need the framework layer above a single turn:
  routing, durable submissions, persistence, and a build that produces a deployable Worker.

## Core problems

1. The framework layer planned in ADR-0001 and ADR-0002 was still mostly stubs, while Flue already
   ships agent modules, an HTTP surface, durable submissions, persistence, channels, and a Vite
   build for Cloudflare ([ADR-0003](../adr/0003-build-on-flue-with-ai-sdk-harness.md)).
2. Flue runs its model loop in the host process through Pi, with no seam around it. A coding-agent
   harness has to run inside a sandbox, with the host consuming `HarnessV1StreamPart`s.
3. Flue's names belong to withastro. Users must install and import amond names only, so Flue's
   code ships renamed in source from this repository
   ([ADR-0004](../adr/0004-ship-flue-as-amond-packages.md)).

## Core features

| Feature | Source | Status |
| --- | --- | --- |
| Agent modules (`'use agent'`), routing, durable submissions, persistence | Flue runtime, shipped as `@amond-ai/agent` | Planned: import and rename ([#20](https://github.com/amond-ai/agent/issues/20)) |
| Vite build to Cloudflare Durable Objects | Flue Vite plugin, shipped as `@amond-ai/agent-vite` | Planned: import and rename (#20) |
| `amond` CLI and `amond.config.ts` | Flue CLI, shipped as `amond` | Planned: import and rename (#20) |
| One sandbox for Flue's tools and the harness, plus a Cloudflare provider | Flue `Sandbox` extending `Experimental_SandboxSession` | Planned ([#15](https://github.com/amond-ai/agent/issues/15)) |
| Agent-loop seam in Flue's session layer | Refactor of Flue's `session.ts` | Planned ([#16](https://github.com/amond-ai/agent/issues/16)) |
| Agent turns through the AI SDK harness, Claude Code first | `HarnessV1` via `@amond-ai/harness-claude-code` | Planned ([#17](https://github.com/amond-ai/agent/issues/17)) |
| Pi removed, Cloudflare end-to-end example | Flue runtime | Planned ([#18](https://github.com/amond-ai/agent/issues/18)) |

## Key product decisions

- **Flue's code, our packages.** Flue's runtime, Vite plugin, CLI, SDK, and React packages move
  into `packages/` with their history, renamed in source. Upstream changes are ported by
  cherry-pick, and `vendor/flue` is a read-only reference to `withastro/flue`.
- **One brand in the API.** The `flue` command becomes `amond`, `flue.config.ts` becomes
  `amond.config.ts`, `FLUE_*` becomes `AMOND_*`, `virtual:flue/*` becomes `virtual:amond/*`, and
  `Flue<Name>Agent` becomes `Amond<Name>Agent`. Flue's name appears only in attribution.
- **Flue's agent model.** Agents are `'use agent'` modules. Flue's durable submissions and
  persistence replace the filesystem layout and durable contract of ADR-0001 and ADR-0002.
- **Cloudflare first.** Each agent runs as a Durable Object, and each harness turn runs in a
  Cloudflare Sandbox container. Node is the development target.
- **The AI SDK harness replaces Pi.** Every agent turn runs in a sandbox container, and the agent
  is the harness itself rather than a host-side loop.
- **The user keeps the deploy config.** `wrangler.jsonc`, including the Sandbox container, stays
  with the user.

## Constraints

- Users install and import amond names only. Flue's copyright and license stay in `NOTICE`.
- Other platforms are out of scope until the Cloudflare path ships.
- `@ai-sdk/harness` is experimental. Its static `node:fs` and `node:path` imports must be verified
  under `nodejs_compat` on Workers.
- Every turn needs a sandbox container, which adds cold-start latency and container cost.

## Status and success criteria

**Pre-alpha. The direction is decided and the migration has not started.** Nothing is published
to npm yet. The packages that predate ADR-0003 (`amond`, `agent-core`, `agent-durable`,
`agent-durable-cloudflare`) are retiring in #18. The harness adapter packages are reassessed once
the agent-loop seam exists.

The first usable milestone is reached when:

- Flue's packages build, lint, and test in this repository under amond names.
- A Claude Code agent turn runs through the AI SDK harness inside a Cloudflare Sandbox container.
- Pi is removed, and a Cloudflare end-to-end example deploys with `vite build && wrangler deploy`.
