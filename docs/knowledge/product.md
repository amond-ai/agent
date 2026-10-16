# Product Guide

What `amond/agent` is for, who it serves, and where it stands today. Read it before proposing a
feature, so the proposal fits the decisions already recorded.

## Vision

Define an agent with files, run it on the harness of your choice, and deploy it to Cloudflare or
Vercel.

`amond/agent` is a TypeScript agent framework built on
[`amond/harness`](https://github.com/amond-ai/harness), which already runs a coding-agent turn
inside a sandbox and survives a dropped socket. This repository is the layer above it: what an
agent *is*, how a schedule or an event starts one, and how a session stays alive across the days
between a question and its answer.

## Target users

- **Agents that author agents.** The primary author of an agent definition is another agent. A
  change unit has to be one file that can be rewritten without disturbing its neighbours
  ([ADR-0001](../adr/0001-filesystem-first-agent-definition.md)).
- **TypeScript developers** who deploy agents to Cloudflare Workers or Vercel and want to keep
  ownership of their own deploy config.
- **Non-TypeScript contributors** who edit an agent's instructions in Markdown.

## Core problems

1. Code-API agent frameworks make the change unit a function body, which is the wrong shape for an
   agent-authored codebase.
2. Schedule- and event-driven agents and long-lived sessions need durable execution, and the two
   target platforms' durable primitives are not symmetric
   ([ADR-0002](../adr/0002-durable-execution-contract.md)).
3. Adopting one platform's durable SDK directly would make its beta status and roadmap this
   framework's public API, and could impose a build-time transform on users' bundlers.

## Core features

| Feature | Package | Status |
| --- | --- | --- |
| Filesystem agent layout (`instructions.md`, `agent.ts`, `tools/`, `skills/`, `schedules/`, `channels/`) | `@amond-ai/agent-core` | Contract typed, loader not implemented |
| Durable execution contract: start, wait, resume, settle | `@amond-ai/agent-durable` | Contract and in-memory runtime implemented and tested |
| Cloudflare Workflows adapter | `@amond-ai/agent-durable-cloudflare` | Scaffolding, throws |
| Claude Code harness adapter | `@amond-ai/agent-harness-claude-code` | Scaffolding, throws |
| Codex harness adapter (unpublished spike that keeps the harness seam honest) | `@amond-ai/agent-harness-codex` | Scaffolding, throws |
| CLI: `amond init`, `amond dev`, `amond build` | `amond` | Scaffolding, throws |
| Vercel Workflow adapter | not yet created | Planned |

## Key product decisions

- **The filesystem is the definition.** Adding a tool is adding a file. There is no registry to
  update and no import list to keep in sync.
- **The filesystem is not read at runtime.** `amond build` walks the tree locally and emits a
  manifest with static imports. The filesystem is the authoring surface, the manifest is the
  deployed one.
- **The build emits handlers, not deployment artifacts.** `wrangler.jsonc`, `vercel.json` and cron
  registration stay with the user.
- **The harness is chosen, not hidden.** `claudeCode({ ... })` or `codex({ ... })` is written
  explicitly in `agent.ts`.
- **Durability is ours, adapters are theirs.** A narrow contract with platform adapters behind it.
  The in-memory runtime is a first-class implementation and the shared test target for every
  adapter.

## Constraints

- No build-time code transformation may be imposed on a consumer's bundler.
- Cloudflare and Vercel must be equally deployable. Neither may become a second-class target.
- The durable contract and the directory convention are public API. Changing either after 1.0 is a
  breaking change for every agent.
- Unimplemented surfaces throw rather than return something plausible.

## Status and success criteria

**Pre-alpha.** Nothing is published to npm yet.

The first usable milestone is reached when:

- `amond init` scaffolds an agent tree, and `amond dev` runs it locally on the in-memory runtime.
- `amond build` emits a static manifest and the platform handlers.
- The Claude Code adapter runs a real turn through `@amond-ai/harness-claude-code`.
- The Cloudflare adapter passes the same shared suite as the in-memory runtime.
