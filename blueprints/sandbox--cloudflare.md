---
{
  "kind": "sandbox",
  "version": 2,
  "website": "https://developers.cloudflare.com/sandbox",
  "aliases": ["@cloudflare/sandbox"]
}
---

# Add an amond Blueprint: Cloudflare Sandbox

You are an AI coding agent helping a user wire up Cloudflare Sandbox in
their amond project. **This is not a normal adapter.** Read this whole
file before you write or install anything — the right action is very
different depending on what target the project is already on.

## The single most important thing to tell the user

`@cloudflare/sandbox` is a Durable Object that runs Cloudflare's container
platform. **It only works inside a Worker** — it cannot be invoked from a
Node.js process. Because of that, amond treats Cloudflare Sandbox as a
first-class **build target**, not a drop-in adapter file.

If the user is already on the Cloudflare target: there is no project-owned
adapter file to install. Export the Sandbox class from the selected amond source
root's `cloudflare.ts`, declare the binding in `wrangler.jsonc`, and wrap
`getSandbox(env.Sandbox, id)` with `cloudflareSandbox(...)` in the agent. Skip to
["Path A"](#path-a-already-on-the-cloudflare-target) below.

If the user is on the Node target (or hasn't picked yet): adding Cloudflare
Sandbox means **migrating the entire project to deploy on Cloudflare
Workers**. This is a real, multi-step change — Workers, Durable Objects,
`wrangler`, container builds, the lot. Don't pretend it's a single-file
add. Skip to ["Path B"](#path-b-currently-on-the-node-target) and
**confirm with the user before proceeding**.

For other sandbox providers that are reachable from a Node-target amond
project (Daytona, E2B, Modal, Vercel, etc.), see `amond add` for those
adapters instead. They install in one file and don't require a deploy
target change.

## Figure out which path you're on

Before writing anything, look at the user's project to determine the
current target:

1. Check `vite.config.ts` for the `cloudflare()` plugin (from
   `@cloudflare/vite-plugin`) alongside `amond()`, and `amond.config.ts` for
   `target: 'cloudflare'`. Either is a strong signal they're on Cloudflare
   already. (Scripts don't distinguish targets — dev and build are
   `vite dev` / `vite build` on both.)
2. Check for `wrangler.jsonc` / `wrangler.toml` / `wrangler.json` at the
   project root. Cloudflare-targeted amond projects always have one.
3. Check `package.json` for `wrangler`, `agents`, and
   `@cloudflare/vite-plugin`.

If you find clear evidence of the Cloudflare target: **Path A**.

If you find no Cloudflare wiring (no `wrangler.jsonc`, no `wrangler` dep,
no `cloudflare()` plugin in `vite.config.ts`): **Path B** — and
**confirm with the user that they want to migrate** before doing anything.

If you can't tell or it's ambiguous: ask the user directly. Don't guess.

---

## Path A: Already on the Cloudflare target

You don't need an adapter file. amond's runtime package already exports the wiring,
and the deploy guide's "Connecting a remote sandbox" section is the
canonical blueprint. Steer the user there:

> `amond docs read ecosystem/deploy/cloudflare` (section "Connecting a remote sandbox")

The short version, for your reference:

1. Install `@cloudflare/sandbox` in the user's project:

   ```bash
   npm install @cloudflare/sandbox@^0.11.0
   ```

   (Use the user's package manager — `pnpm add`, `yarn add`, etc.)

2. Export the Sandbox class from the user's Cloudflare deployment module.
   Put `cloudflare.ts` in the selected amond source root: `.amond/cloudflare.ts`
   when `.amond/` exists, otherwise `src/cloudflare.ts` when `src/` exists,
   otherwise `<root>/cloudflare.ts`:

   ```ts
   export { Sandbox } from '@cloudflare/sandbox';
   ```

3. Add a Durable Object binding for the sandbox to the user's
   `wrangler.jsonc` at the project root:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [{ "class_name": "Sandbox", "name": "Sandbox" }]
     },
     "migrations": [{ "tag": "v2", "new_sqlite_classes": ["Sandbox"] }],
     "containers": [{ "class_name": "Sandbox", "image": "./Dockerfile" }]
   }
   ```

   Preserve the user's existing top-level migration history and append a new
   uniquely tagged entry. Do not replace deployed migration entries — in
   particular the per-agent `amond-class-Amond<PascalName>Agent` entries for
   the generated agent Durable Object classes. (`wrangler.jsonc` stays
   user-owned; amond's own contributions — the Worker entry and per-agent
   Durable Object bindings — are applied in memory by the
   `amondWorkerConfig()` customizer passed to the Cloudflare Vite plugin.)

4. Add a `Dockerfile` at the project root pinned to the matching
   `@cloudflare/sandbox` version:

   ```dockerfile
   FROM docker.io/cloudflare/sandbox:0.11.0
   ```

   (Replace `0.11.0` with whatever version was actually installed in step
   1 — Cloudflare publishes the base image with the same version tag as
   the npm package.)

5. Use it in an agent. The binding name from `wrangler.jsonc` (`Sandbox`
   above) is the key on the Worker `env`, which you import from
   `cloudflare:workers`. The agent function receives its instance id as
   `{ id }: AgentProps`; pass both to `getSandbox` and wrap the result with
   `cloudflareSandbox`:

   ```ts
   'use agent';
   import { env } from 'cloudflare:workers';
   import { type AgentProps, useModel, useSandbox } from '@amond-ai/agent';
   import { cloudflareSandbox } from '@amond-ai/agent/cloudflare';
   import { getSandbox } from '@cloudflare/sandbox';

   interface Env {
     Sandbox: DurableObjectNamespace;
   }

   export function Assistant({ id }: AgentProps) {
     useModel('anthropic/claude-opus-4-7');
     const { Sandbox } = env as unknown as Env;
     useSandbox(cloudflareSandbox(getSandbox(Sandbox, id)));
     return 'You are a helpful assistant with a full sandbox.';
   }
   ```

   The wrapper is provided by `@amond-ai/agent/cloudflare`, so no
   project-owned adapter file is needed. The `'use agent'` directive is
   what registers the agent; mount its router in `app.ts`
   (`app.route('/agents/<name>', createAgentRouter(Assistant))`, with
   `createAgentRouter` from `@amond-ai/agent/routing`) if it needs an HTTP
   endpoint.

6. Tell the user to put local variables in `.dev.vars` or `.env` and run
   `vite dev` for local development, then `vite build &&
   wrangler deploy --secrets-file .env` to deploy. No new env vars are required just for
   the sandbox itself; auth is the user's normal Cloudflare account auth
   via `wrangler login`.

If the user wants multiple sandbox images (e.g. one for Python, one for
Node), they can declare multiple bindings — see the "Multiple sandboxes"
section of the deploy guide.

---

## Path B: Currently on the Node target

**Stop. Confirm with the user first.**

Adding Cloudflare Sandbox to a project that currently runs on Node is
**not** a one-file change. The sandbox itself is a Cloudflare Containers
Durable Object, which only exists inside a Cloudflare Worker. To use it,
the entire amond project has to change its deploy target from Node to
Cloudflare Workers, which is a substantial migration that includes:

- Adding `cloudflare({ config: amondWorkerConfig() })` (the plugin from
  `@cloudflare/vite-plugin`, the customizer from `@amond-ai/agent-vite`) to
  `vite.config.ts` after `amond()` — that plugin's presence is what selects
  the Cloudflare target; dev and build stay `vite dev` / `vite build`.
- Adding `wrangler`, `@cloudflare/vite-plugin`, and `agents` (Cloudflare's
  Agents SDK) as dependencies.
- Adding a `wrangler.jsonc` with Durable Object bindings, container
  bindings, user-authored migration entries for each agent's generated
  `Amond<PascalName>Agent` class, and an R2 binding if they want persistent
  file storage.
- Adding a `Dockerfile` for the container image.
- Setting up Wrangler authentication (`wrangler login`) and a Cloudflare
  account that has Containers enabled (currently a Workers Paid feature).
- Reviewing any Node-only code in the user's existing agents and
  adapters. Anything that imports from `node:fs`, opens TCP sockets via
  `net`, uses `child_process`, or depends on long-lived background work
  needs rethinking on the Workers runtime.

Before doing any of this, **ask the user**:

1. Are you OK migrating this whole project to deploy on Cloudflare
   Workers? (yes/no)
2. Do you have a Cloudflare account with Containers access? (Containers
   is currently a Workers Paid feature.)

If they say no to either, **stop and recommend an alternative**. Other
sandbox adapters that work from a Node-target amond project include:

- **Daytona** (`amond add sandbox daytona`) — provider-managed sandboxes via
  `@daytona/sdk`.
- **E2B** (`amond add sandbox e2b`) — Firecracker microVMs via the `e2b` package.
- **Modal** (`amond add sandbox modal`) — sandboxes on Modal's serverless platform.
- **Vercel Sandbox** (`amond add sandbox vercel`) — `@vercel/sandbox`.
- **boxd** (`amond add sandbox boxd`) — microVMs via `@boxd-sh/sdk`.
- **exe.dev** (`amond add sandbox exedev`) — SSH-accessed VMs.

These all keep the project on the Node target and don't require a
platform migration.

If the user does say yes to migrating, **do not try to do the whole
migration in one shot**. Direct them at the canonical guide instead:

> `amond docs read ecosystem/deploy/cloudflare`

That document walks through the migration end-to-end:

- Hello-world agent on Cloudflare (`vite dev` with the `cloudflare()`
  plugin in `vite.config.ts`).
- Adding `wrangler.jsonc`, `.env`, and the `cloudflare()` plugin to
  `vite.config.ts`.
- Using amond's default virtual sandbox if the user only needs an in-memory filesystem with built-in shell and file-search tools.
- Adding the Cloudflare Sandbox container at the end (which is the same
  blueprint as Path A above).

Read the guide, then walk the user through it section by section. Don't
short-circuit straight to writing a `wrangler.jsonc` and `Dockerfile`
without first confirming the basics work on the Cloudflare target.

---

## Hard rules

- **Do not** create a `sandboxes/cloudflare.ts` file under any source
  directory. Import `cloudflareSandbox` from `@amond-ai/agent/cloudflare`; no
  project-owned adapter file is needed.
- **Do not** silently migrate a Node-target project to Cloudflare. Always
  confirm first.
- **Do not** invent a Cloudflare account, API token, or `account_id`. The
  user authenticates with `wrangler login` (or `CLOUDFLARE_API_TOKEN` in
  CI); never guess values.
- **Do not** pin the `cloudflare/sandbox:<version>` Docker tag to a
  version different from the `@cloudflare/sandbox` npm package version
  the user actually installed. They have to match.
- The `@cloudflare/sandbox` package is a separate Cloudflare-published dependency the user installs themselves. Don't import from `@amond-ai/agent/internal`.

When updating an existing integration, inspect and compare it against this complete current blueprint, apply every relevant change, and preserve customizations. This blueprint has no primary marked file, so comparison is the durable update path; do not add a marker to an auxiliary or deployment file.

## Upgrade Guide

### Version 1 — 2026-06-14

Initial version.

### Version 2 — 2026-10-20

Pin the `Dockerfile` base image to the `@cloudflare/sandbox` version the install step installs (`0.11.0`, not `0.9.2`). Wire the agent from the Worker `env` and the agent id, as the deploy guide does, instead of importing a project-owned `cloudflareSandboxFactory` module that no step creates. Delete that import from the agent file.

```diff
--- a/Dockerfile
+++ b/Dockerfile
-FROM docker.io/cloudflare/sandbox:0.9.2
+FROM docker.io/cloudflare/sandbox:0.11.0
--- a/src/agents/assistant.ts
+++ b/src/agents/assistant.ts
 'use agent';
+import { env } from 'cloudflare:workers';
-import { useModel, useSandbox } from '@amond-ai/agent';
-import { cloudflareSandboxFactory } from '../cloudflare-sandbox';
+import { type AgentProps, useModel, useSandbox } from '@amond-ai/agent';
+import { cloudflareSandbox } from '@amond-ai/agent/cloudflare';
+import { getSandbox } from '@cloudflare/sandbox';
+
+interface Env {
+  Sandbox: DurableObjectNamespace;
+}
 
-export function Assistant() {
+export function Assistant({ id }: AgentProps) {
   useModel('anthropic/claude-opus-4-7');
-  useSandbox(cloudflareSandboxFactory);
+  const { Sandbox } = env as unknown as Env;
+  useSandbox(cloudflareSandbox(getSandbox(Sandbox, id)));
   return 'You are a helpful assistant with a full sandbox.';
 }
```
