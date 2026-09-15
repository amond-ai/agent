# agent

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Define an agent with files, run it on the harness of your choice, deploy it to Cloudflare or
Vercel.

`amond/agent` is a TypeScript agent framework built on
[`amond/harness`](https://github.com/amond-ai/harness), which already runs a coding-agent turn
inside a sandbox and survives a dropped socket. This repository is the layer above it: what an
agent *is*, how a schedule or an event starts one, and how a session stays alive across the days
between a question and its answer.

Three things shape it, and each is written down as a decision rather than assumed:

- **The filesystem is the definition.** Instructions are Markdown, tools are one file each,
  schedules and channels are entry points in their own directories. The expected author is
  another agent, and a file is a change unit an agent can rewrite without disturbing its
  neighbours ([ADR-0001](./docs/adr/0001-filesystem-first-agent-definition.md)).
- **The harness is chosen, not hidden.** `claudeCode({ ... })` or `codex({ ... })` is something
  you write. Harness differences decide what a turn costs and what it can be interrupted at, so
  burying them would leak or over-constrain.
- **Durability is ours, adapters are theirs.** A narrow contract — start, wait, resume, settle —
  with Cloudflare Workflows and Vercel Workflow behind it, so no platform's beta status becomes
  this framework's public API
  ([ADR-0002](./docs/adr/0002-durable-execution-contract.md)).

## Status

**Pre-alpha — the contracts are in place, most implementations are not.** The durable contract
and its in-memory runtime work and are tested. The harness adapters, the Cloudflare adapter and
the CLI are scaffolding with typed surfaces and no bodies; they throw rather than return
something plausible, on purpose. Nothing is published to npm yet.

## Packages

| Package | What it does |
| --- | --- |
| `amond` | The CLI: `init` an agent tree, `dev` it locally, `build` it into deployable handlers. |
| `@amond-ai/agent-core` | The contract — the filesystem layout, the harness seam, and the handlers a platform invokes. |
| `@amond-ai/agent-durable` | The durable execution contract, plus the in-memory runtime every adapter is verified against. |
| `@amond-ai/agent-durable-cloudflare` | Cloudflare Workflows behind that contract. |
| `@amond-ai/agent-harness-claude-code` | The Claude Code adapter, over `@amond-ai/harness-claude-code`. |
| `@amond-ai/agent-harness-codex` | A second adapter, unpublished — it exists to keep the harness seam honest before 1.0. |

## What an agent looks like

```text
agent/
  instructions.md           # what the agent is for
  agent.ts                  # the harness, the model, the policy
  tools/
    search-issues.ts        # one tool per file, default-exported
  skills/
    triage/SKILL.md
  schedules/
    nightly.ts              # cron-triggered
  channels/
    slack.ts                # event-triggered
```

Adding a tool is adding a file. There is no registry to update and no import list to keep in
sync — which is the point, because the thing editing these files is usually an agent.

## Why the filesystem is not read at runtime

A Worker has no `fs`, so scanning `tools/` when a request arrives is not portable. `amond build`
walks the tree on your machine and emits a manifest whose imports are static; that manifest is
what deploys. The filesystem is the authoring surface, the manifest is the deployed one, and the
CLI is the seam between them.

The build emits **handlers**, not deployment artifacts. `wrangler.jsonc`, `vercel.json` and cron
registration stay yours — a framework that owns your deploy config has to chase two platforms'
release notes forever, and you lose the escape hatch the first time you need it.

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
