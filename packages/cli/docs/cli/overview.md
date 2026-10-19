---
title: CLI
description: The amond command-line interface — invocation, command catalog, global flags, and exit codes.
lastReviewedAt: 2026-07-21
---

The `amond` CLI ships in the `amond` package as a single `amond` binary. It scaffolds projects, runs one agent module locally, fetches integration blueprints, and reads the documentation bundled with your installed version.

The CLI is not the build tool. Dev servers and production builds are owned by [Vite](/docs/guide/deploy/): `vite dev` and `vite build`, with the `amond()` plugin from `@amond-ai/agent-vite` in `vite.config.ts`.

## Invocation

`amond` requires Node.js 22.19 or newer. [`amond init`](/docs/cli/init/) scaffolds it as a `devDependency`, and the [getting started guide](/docs/guide/getting-started/) installs it alongside `@amond-ai/agent`:

```bash
npm install @amond-ai/agent amond
```

The `amond` bin is then available through your package manager's runner (`npx amond`, `pnpm amond`, `yarn amond`) or from `package.json` scripts:

```bash
npx amond run src/agents/assistant.ts -m "Say hello"
```

## Commands

- [`amond init [directory]`](/docs/cli/init/) — scaffold a starter amond project, prompting for the build target and server setup when flags are omitted.
- [`amond run <path>`](/docs/cli/run/) — run one agent module locally without a server: submit one message, stream the turn, print the reply, exit.
- [`amond add [kind] [name|url]`](/docs/cli/add/) — fetch a blueprint implementation guide for a coding agent to follow; with no arguments, list the available blueprints.
- [`amond update <kind> <name|url>`](/docs/cli/update/) — fetch the same blueprint guide for updating an existing integration.
- [`amond docs [read|search]`](/docs/cli/docs/) — list the bundled documentation pages, print one as markdown, or search them.

Each command page is the reference for that command's arguments, flags, and output. Every command prints its primary payload to stdout and everything else — prompts, streaming output, errors — to stderr, so piping stdout is always safe.

## Global flags

| Flag              | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `--help`, `-h`    | Print usage to stdout and exit 0. Works globally and per command (`amond run --help`). |
| `--version`, `-v` | Print the `amond` version to stdout and exit 0.                                   |

There are no other global flags; every command rejects flags it does not declare.
