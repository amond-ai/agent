---
title: Database
description: Configure where amond durably stores agent conversations, from the in-memory default to SQLite, Postgres, and beyond.
lastReviewedAt: 2026-07-21
---

amond durably stores agent conversations in a database, configured with a single file: `db.ts`. This guide covers what amond stores, how the `db.ts` entry module works, the in-memory default and its limits, the built-in `sqlite()` adapter, and building an adapter for Postgres or any other backend.

One note up front: the database is a **Node.js** concern. On the Cloudflare target, every agent conversation is a Durable Object with its own built-in SQLite storage — there is nothing to configure, and a `db.ts` file is rejected at build time. See [Cloudflare](/docs/guide/cloudflare-target/) for how storage works there.

## What amond stores

An amond database stores the runtime's own durable state — not your application's business data. Three kinds of records live there:

- **Canonical conversations.** Each agent conversation is one append-only stream of records: user messages, assistant output, tool calls and results, compaction, and recovery facts. This stream is the single source of truth — every later turn, every reconnecting client, and every crash recovery rebuilds its picture of the conversation by reading it back.
- **Accepted submissions.** When a prompt or `dispatch(...)` input is accepted, amond records it durably _before_ processing begins, along with claims and leases that track which process owns the work. These rows are what make accepted work recoverable after an interruption instead of silently lost.
- **Persisted state.** Every [`usePersistentState`](/docs/guide/agent-hooks/#persisted-state) write is recorded in the conversation's stream, which is how state survives restarts for the life of the conversation.

Attachment payloads (images and other binary inputs) are stored alongside the conversation as immutable records that the canonical stream references.

amond does _not_ store sandbox files and installed dependencies (see [Sandboxes](/docs/guide/sandboxes/)), external API side effects, provider credentials, or your application's own data. A durable database does not make a sandbox durable, and a durable workspace does not preserve conversation history — they are separate concerns. When a tool writes to your application's database, amond stores only the record that the tool was called and what it returned.

## The `db.ts` entry module

To choose a database, create a `db.ts` file in your project's [source directory](/docs/guide/project-layout/#source-directory) and default-export a persistence adapter:

```ts title="src/db.ts"
import { sqlite } from '@amond-ai/agent/node';

export default sqlite('./data/amond.db');
```

Like `app.ts`, the `db.ts` entry is discovered by convention — `vite dev`, `vite build`, and `amond run` all resolve it from the source root (`.amond/`, `src/`, or the project root) and connect it at startup. To place it somewhere else, set the `db` path in your config file; see [Configuration](/docs/reference/configuration/#db).

Because the module is ordinary TypeScript, the adapter can read connection strings from the environment, construct a driver pool, and export whatever the situation calls for. amond calls the adapter's `migrate()` once at boot to create or verify its tables, then awaits `connect()` — so an unreachable or misconfigured database fails at startup, not in the middle of your first conversation.

Standalone scripts using [`start()`](/docs/guide/building-agents/#standalone-scripts) don't go through the build, so they don't pick up `db.ts` — pass the adapter directly via the `db` option instead.

## The in-memory default

Without a `db.ts`, amond runs on in-memory SQLite. Everything works — conversations, persisted state, recovery within the process lifetime — but **a restart loses everything**: every conversation, every accepted submission, every piece of state. Fine for development; in production, acceptable only for genuinely disposable agents.

The development commands soften this default:

| Command      | Without `db.ts`                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `vite dev`   | A cache file (`node_modules/.cache/amond/dev.db`) — history survives code reloads, resets when the dev server cold-starts. |
| `amond run`   | A cache file (`node_modules/.cache/amond/run.db`) — never reset, so `--id` continues conversations across invocations.     |
| `vite build` | In-memory — the deployed server keeps state only for the process lifetime.                                                |

With a `db.ts`, all three use your adapter, so development runs against the same storage shape as production.

## The built-in `sqlite()` adapter

The `sqlite()` adapter ships with the runtime and needs no extra dependencies — it runs on Node's built-in `node:sqlite` module. Point it at a file path for storage that survives restarts:

```ts title="src/db.ts"
import { sqlite } from '@amond-ai/agent/node';

export default sqlite('./data/amond.db');
```

The adapter creates the file (and any missing parent directories) on first boot and opens it in WAL mode. Calling `sqlite()` with no argument — or with `':memory:'` — gives you the same in-memory database as the default.

A file-backed SQLite database covers a single-host deployment: it survives process restarts and redeploys on the same machine, but not the loss of the host itself. When state must survive host loss, or multiple replicas need to share it, use an external database.

## Adapters for external databases

amond ships no packaged adapters for external databases. Your coding agent builds one from scratch as project source, following a [blueprint](/docs/cli/add/) — a Markdown implementation guide rather than a package installer. Pass the documentation URL of the backend you want to use:

```sh
amond add database https://www.postgresql.org/docs/current/
```

The generated adapter follows a **bring-your-own-driver** design: it implements amond's storage contract in a `db.ts` you own, but it never picks, bundles, or configures a database driver for you. The adapter wraps your configured driver — typically a `query` function, a `transaction` function, and a `close` function — so you keep full control of driver choice, pooling, TLS, and credentials, and amond coexists with however your application already talks to its database.

The contract is described under [Writing a custom adapter](#writing-a-custom-adapter) below. Treat the [Data Persistence API](/docs/reference/data-persistence-api/) as the specification the generated code must meet.

There are no migrations to run by hand with any adapter. `migrate()` provisions amond's tables idempotently on first boot, reuses them on restart, and stamps a format version — a database written by an incompatible amond version refuses to start rather than corrupting state.

A shared database does **not** enable active-active scaling. A durable external database lets a replacement process recover accepted work and lets replicas share conversation state, but each agent conversation still needs exactly one live Node owner at a time. See [Durability](/docs/guide/durability/#nodejs-recovery) for the ownership rules and what recovery actually replays.

## Writing a custom adapter

Whether your coding agent generates it or you write it by hand, an adapter implements the storage contract. An adapter is an object with `connect()` (returning the three stores — submissions, conversation streams, and attachments), plus optional `migrate()` and `close()`; the types live in `@amond-ai/agent/adapter`:

```ts
import type { PersistenceAdapter } from '@amond-ai/agent/adapter';

export default {
  migrate() {
    /* create or verify backing storage */
  },
  connect() {
    return { submissionStore, conversationStreamStore, attachmentStore };
  },
  close() {
    /* release connections */
  },
} satisfies PersistenceAdapter;
```

The contract has strict atomicity and ordering requirements — idempotent admission, fenced producer claims, append-only streams — so treat the [Data Persistence API](/docs/reference/data-persistence-api/) as the specification, and run the contract test suites from `@amond-ai/agent/test-utils` against your implementation. They are the acceptance tests the built-in adapters pass.

## Choosing a database

| Situation                                      | Choice                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Local development                              | The defaults — add `db.ts` only to develop against production storage |
| Single-host Node deployment                    | File-backed `sqlite()`                                                |
| State must survive host loss, or many replicas | A custom adapter for that database, with one live owner routed per conversation |
| Cloudflare deployment                          | Nothing to configure — Durable Object SQLite is automatic             |
| Any external database                          | A custom `PersistenceAdapter`, generated with `amond add database <url>` |

## Next steps

- [Durability](/docs/guide/durability/) — what recovery replays after an interruption, and the one-live-owner rule.
- [Data Persistence API](/docs/reference/data-persistence-api/) — the full adapter and store contracts.
- [`amond add`](/docs/cli/add/) — fetching the database blueprint for your backend.
- [Deploy Agents on Node.js](/docs/ecosystem/deploy/node/) — provisioning a database alongside your server.
- [Project Layout](/docs/guide/project-layout/) — where `db.ts` and the other entry modules live.
