---
title: Deploy Agents on Render
description: Run the amond Node server as a long-running Render web service.
lastReviewedAt: 2026-07-21
---

amond's Node target is a long-running HTTP server, not a serverless function, so it deploys to Render as a web service that stays up between requests. This guide covers the Render-specific setup; the build itself is the same `node` target described in [Deploy Agents on Node.js](/docs/ecosystem/deploy/node/) — `npx vite build` (with the `amond()` plugin in `vite.config.ts`) produces `dist/server.mjs`, which you start with `node dist/server.mjs`.

## Deploy

Render reads a Blueprint — a `render.yaml` at the repo root — to provision the service as code. An amond web service is a Node runtime with the build and start commands from the Node guide:

```yaml title="render.yaml"
services:
  - type: web
    name: amond-agents
    runtime: node
    plan: free
    buildCommand: npm ci && npx vite build
    startCommand: node dist/server.mjs
    healthCheckPath: /health
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false
```

- `buildCommand` compiles the amond Node target. The build externalizes your dependencies rather than bundling them, so `node_modules` must be present at runtime — `npm ci` installs them, and `vite` plus `@amond-ai/agent-vite` must be available to the build command.
- `startCommand` runs the generated server, which binds the `PORT` Render injects and serves agent conversations at whatever paths `app.ts` mounts them.
- `healthCheckPath` lets Render verify each deploy before shifting traffic to it — but only if your application defines that route (see [Health and streaming](#health-and-streaming)).

Push the file and create a Blueprint from the Render Dashboard (**New > Blueprint**). Render prompts for any `sync: false` secrets and deploys. To auto-deploy on every push, set `autoDeployTrigger: commit` on the service (this replaces the deprecated `autoDeploy` field).

The example Blueprint uses `plan: free`, so first deploys cost nothing. Free web services spin down after 15 minutes without inbound traffic, and the next request pays a cold start — about a minute — while the Node process restarts. In-memory conversation and submission state is also lost across that restart. For agents that see sporadic production traffic, move to `starter` or higher to keep the service warm, and add Postgres for durable recovery.

## Environment and secrets

The built server reads only the environment present when it starts — it does not load `.env` — so configuration lives in Render environment variables, set in the Dashboard or declared in `render.yaml`. amond needs the API key for your model provider, plus an optional model specifier:

| Variable                               | Purpose                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Authenticates calls to your model provider. Use the name your provider expects.                         |
| `MODEL_SPECIFIER`                      | Optional default model, e.g. `anthropic/claude-sonnet-4-6`, if your app reads one from the environment. |

Declare secret values with `sync: false` so they stay out of the Blueprint — Render prompts for them on first deploy and stores them on the service. Non-secret values like a model specifier can carry a literal `value`:

```yaml
envVars:
  - key: MODEL_SPECIFIER
    value: anthropic/claude-sonnet-4-6
  - key: ANTHROPIC_API_KEY
    sync: false
```

Render ignores `sync: false` variables when updating an existing Blueprint, so rotate those secrets from the Dashboard.

## Persistence

The Node target keeps canonical agent conversations and accepted submissions in memory by default. That state is lost on every restart, deploy, and free-plan spin-down.

For durable process or host replacement, add a Render Postgres database to the Blueprint and wire its connection string into the web service with `fromDatabase`. A shared database does not enable active-active ownership of one agent instance: route each instance to one live Node process and avoid overlapping owners during replacement.

```yaml title="render.yaml"
databases:
  - name: amond-db
    plan: basic-256mb

services:
  - type: web
    name: amond-agents
    runtime: node
    plan: free
    buildCommand: npm ci && npx vite build
    startCommand: node dist/server.mjs
    healthCheckPath: /health
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: amond-db
          property: connectionString
      - key: ANTHROPIC_API_KEY
        sync: false
```

`fromDatabase` supplies the database's internal connection string — the one Render recommends for services in the same account and region, since it stays on the private network.

amond ships no packaged Postgres adapter. Have your coding agent [build one](/docs/guide/database/#adapters-for-external-databases) as `db.ts`, wrapping your configured `pg` pool and reading `DATABASE_URL`:

```bash
amond add database https://node-postgres.com/
```

amond discovers `db.ts` at build time and wires it into the generated server — schema creation, canonical conversation streams, immutable attachments, and durable submission state are handled by the adapter. See [Database](/docs/guide/database/) for the adapter contract and alternatives. Note that a `free` Postgres database expires 30 days after creation; use a `basic-256mb` or larger plan for anything you intend to keep.

## Health and streaming

amond does not generate a `/health` route. If you set `healthCheckPath`, define the matching route in `app.ts` — otherwise the check never passes and Render holds the deploy back. Drop `healthCheckPath` if you don't want a health gate.

Agent conversations are served through long-lived `GET` reads on the conversation URL (long-poll/SSE). Render imposes no fixed idle timeout and allows a request to run up to 100 minutes. Instance replacement can still close connections, so retain the admission's `streamUrl` and `offset` and resume the conversation stream rather than holding one blocking request open. The server's `SIGTERM` shutdown delay (default 30s, up to 300s via `maxShutdownDelaySeconds`) governs graceful shutdown. See the [Streaming Protocol](/docs/reference/streaming-protocol/).

## Going further

- **Scheduled agents.** Model periodic tasks as a Render cron job that calls the deployed application's authenticated agent endpoint — a `POST` to the agent's conversation URL with a `kind: 'signal'` message. Calling the deployed application avoids rebuilding and starting a second runtime for every fire. Render runs at most one instance of a given cron job at a time and stops a run after 12 hours. See [Schedules](/docs/guide/schedules/).
- **Background workers.** For continuous, queue-driven delivery, add a `type: worker` service. A worker has no public port; it runs `node dist/server.mjs` (or a custom entry), makes attached agent requests and waits for results, or has application code call `dispatch(...)` for asynchronous delivery identified by the receipt's `submissionId`.

## References

- [Blueprint YAML reference](https://render.com/docs/blueprint-spec) — official `render.yaml` field reference: `type`, `runtime`, `buildCommand`, `startCommand`, `healthCheckPath`, `envVars` with `sync: false`, `autoDeployTrigger`, `databases`, and `fromDatabase`.
- [Free instances](https://render.com/docs/free) — official spin-down (15 min), cold-start, and free-Postgres expiry (30 days) behavior.
- [Connect to Render Postgres](https://render.com/docs/postgresql-creating-connecting) — official internal vs. external connection string guidance.
- [Cron jobs](https://render.com/docs/cronjobs) — official scheduling rules: UTC, standard cron syntax, single active run, 12-hour max.
- [Background workers](https://render.com/docs/background-workers) — official guide to no-public-port worker services.
- [Real-time AI chat infrastructure](https://render.com/articles/real-time-ai-chat-websockets-infrastructure) — Render's own write-up of the 100-minute max request duration and persistent-connection model for streaming.
