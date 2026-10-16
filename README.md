# agent

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Run coding-agent harnesses as Flue agents, in sandbox containers, on Cloudflare.

`amond/agent` is being derived from [Flue](https://github.com/withastro/flue) and built on
[`amond/harness`](https://github.com/amond-ai/harness), which already runs a coding-agent turn
inside a sandbox and survives a dropped socket. Flue's code will supply what an agent *is*, how a
request, schedule or event starts one, and how a session stays durable. The harness supplies the
turn itself.

Five decisions shape it, recorded in
[ADR-0003](./docs/adr/0003-build-on-flue-with-ai-sdk-harness.md) and
[ADR-0004](./docs/adr/0004-ship-flue-as-amond-packages.md):

- **Flue's code, our packages.** Flue's runtime, Vite plugin and CLI will move into this
  repository, be renamed in source and be published as `@amond-ai/agent`, `@amond-ai/agent-vite`
  and `amond`. Upstream changes will be ported by hand; `vendor/flue` is a read-only
  reference.
- **Flue's agent model.** Agents are `'use agent'` modules built with the Vite plugin. Flue's
  durable submissions and persistence replace the filesystem layout and durable contract from
  ADR-0001 and ADR-0002, which are superseded.
- **Cloudflare first.** Each agent runs as a Flue Durable Object, and each harness turn runs in a
  Cloudflare Sandbox container. Node is the development target; other platforms wait until
  Cloudflare ships.
- **The AI SDK harness replaces Pi.** Flue's agent loop moves behind a seam implemented with the
  AI SDK harness spec (`HarnessV1`), starting with Claude Code via `@amond-ai/harness-claude-code`.
  Pi is then removed.
- **One sandbox for Flue and the harness.** Flue's `Sandbox` extends the AI SDK's
  `Experimental_SandboxSession`, so the object Flue's tools use is the one handed to the harness.

## Status

**Pre-alpha — the direction is decided, the migration has not started.** The work is tracked
phase by phase: the sandbox extension and a Cloudflare provider
([#15](https://github.com/amond-ai/agent/issues/15)), the agent-loop seam
([#16](https://github.com/amond-ai/agent/issues/16)), harness-driven turns
([#17](https://github.com/amond-ai/agent/issues/17)), and removing Pi with a Cloudflare
end-to-end example ([#18](https://github.com/amond-ai/agent/issues/18)). Nothing is published to
npm yet.

## Packages

The packages below predate ADR-0003. Those marked *retiring* overlap with Flue and are removed in
[#18](https://github.com/amond-ai/agent/issues/18); the harness adapters are reassessed once the
agent-loop seam exists.

| Package | What it does |
| --- | --- |
| `amond` | *Retiring.* The CLI that resolves an ADR-0001 `agent/` tree into a manifest; Flue's Vite build replaces it. The `amond` name then passes to the CLI imported from Flue (ADR-0004). |
| `@amond-ai/agent-core` | *Retiring.* The ADR-0001 contract — filesystem layout, harness seam, platform handlers. |
| `@amond-ai/agent-durable` | *Retiring.* The ADR-0002 durable contract and its in-memory runtime. |
| `@amond-ai/agent-durable-cloudflare` | *Retiring.* Cloudflare Workflows behind that contract, never implemented. |
| `@amond-ai/agent-harness-claude-code` | The Claude Code adapter, over `@amond-ai/harness-claude-code`. |
| `@amond-ai/agent-harness-codex` | A second adapter, unpublished. |

## What an agent looks like

An agent is a Flue module whose first statement is `'use agent'`. Every exported capitalised
function is an agent; its body calls Flue hooks and returns its instructions. On Cloudflare,
`flue()` and `cloudflare({ config: flueWorkerConfig() })` in `vite.config.ts` turn each agent into
a Durable Object class, and `vite build && wrangler deploy` ships it. `wrangler.jsonc`, including
the Sandbox container, stays yours. See Flue's
[building agents](https://flueframework.com/docs/guide/building-agents/) guide for the hooks.

## Development

```bash
mise install
bun install
bun run build      # tsdown, per package, into dist/
bun run check      # tsc across the workspace
bun run lint
bun run test
```

A package's `exports` point at `dist/`, so a package has to be built before anything resolves it.
`test` depends on its own package's `build`; `check` depends only on its **dependencies'**
builds.

## Releasing

Versions and changelogs are release-please's, driven by
[Conventional Commits](https://www.conventionalcommits.org/) on `main`. Merging the release PR
tags every package it bumped and publishes them through npm's trusted publishing, so each version
carries a provenance attestation tied to this repository and that workflow run.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, commits and pull requests, and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for community standards. Report vulnerabilities
privately through [SECURITY.md](./SECURITY.md), not a public issue.

Decisions live in [`docs/adr/`](./docs/adr). If you are proposing something that changes one of
them, the ADR is the place to start the conversation.

## License

Apache-2.0.
