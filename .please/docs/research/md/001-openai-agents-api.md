---
id: 001
title: "OpenAI Agents API"
url: "https://developers.openai.com/api/docs/guides/agents-api/overview"
date: 2026-09-16
summary: "Research on the OpenAI Agents API, which exposes the Codex harness as a managed API — OpenAI owns sessions, orchestration, context compaction, and recovery, while the application supplies tools and picks an execution environment (none / openai_hosted / self_hosted). It is in beta (`OpenAI-Beta: agents=v1`), supports US data residency only, and is not ZDR-eligible."
tags: [openai, agents-api, managed-agents, hosted-agents]
published: { repo: chatbot-pf/memex, id: 124, at: 2026-09-17 }
---

# OpenAI Agents API

## Overview

The Agents API **exposes the Codex harness as a managed API operated by OpenAI**. In the documentation's own words:

> The Agents API gives your application access to the Codex harness through an OpenAI-managed API. OpenAI manages sessions, orchestration, context compaction, and recovery while your application provides tools and chooses its execution environment.

The split of responsibility is explicit.

| What OpenAI owns | What your application owns |
| --- | --- |
| session, orchestration (the model/tool loop), context compaction, recovery | providing tools, choosing the environment, running function tools, receiving events |

The problem it solves is "not writing the harness yourself." Previously you called the Responses API for the model and had to implement the tool loop, conversation state, context compaction, and retries in your own application; the Agents API moves that entire loop server-side. Agents can execute code inside a sandbox, edit files, connect to MCP servers, and produce artifacts.

**Relationship to the Responses API**: the docs never state outright that it is "built on top of Responses," but the API-key permission requirements in the quickstart reveal the relationship — session operations need `api.agents.read` / `api.agents.write`, while **model inference needs `api.responses.write`**. So the Agents API has its own resource plane (`/v1/agents/sessions`), but inference is billed and executed through the Responses permission boundary.

**Relationship to the Agents SDK**: none of the five pages reviewed mention the Agents SDK (the open-source Python/JS SDK). Instead the overview points to a runtime comparison page: "For a runtime comparison, see the [Agents overview](https://developers.openai.com/api/docs/guides/agents#compare-agent-runtimes)" (outside the scope of this research). For context, the sidebar places **Agent Builder under a "Legacy APIs" section**, and the Assistants API is reduced to a migration guide.

## Core concepts / resource model

The overview presents four core concepts.

- **Agent** — the model, instructions, tools, and MCP servers. The set of things the agent can use.
- **Environment** — an optional sandbox or computer where file access, skill loading, and command execution happen.
- **Session** — "A durable instance of an agent that works on tasks and responds to input." A **durable instance** of an agent that performs tasks and responds to input.
- **Events and items** — the inputs sent to the agent and the output produced during the session.

The architecture page splits the same picture three ways, by who executes what.

- **Harness** — the OpenAI-hosted Codex instance that runs the model and tool loop and maintains the session.
- **Environment** — can be a remote sandbox, your laptop, a Docker container, or an AWS Lambda function.
- **Application server** — your code that submits tasks, receives events, and handles function tools. If you supply the environment, you manage its lifecycle too.

### Session / Turn / Item / Event

- A **turn** is one cycle of work inside a session. **Sending a message to an idle session starts a new turn; sending one during an active turn steers that turn.** It matters that the same endpoint carries both meanings.
- Turns run **asynchronously**. You follow progress via streaming or webhooks.
- **Events** are live progress; **items** are the saved messages and tool calls (including completed responses). Retrieve them after the fact with `sessions.items.list()`.

### Reusing and overriding the agent resource

An agent configuration can be passed inline at session creation, or saved via `client.beta.agents.create()` and reused by `agent_id`. **The session holds the conversation and the work; the saved agent holds the reusable settings.**

Passing both `agent_id` and `agent` overrides settings for that session only. A caveat is spelled out:

> Supplied objects and arrays replace the entire field rather than merging with the saved value. For example, supplying `tools` replaces the saved tool list.

In other words, it is **whole-field replacement, not a merge**. Credentials are kept separate from the saved configuration, in [vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).

## Quickstart flow

Goal: a coding assistant that writes `tree.py`, runs it, and prints a directory tree.

### 0. Prerequisites

Create an [application API key](https://platform.openai.com/api-keys) and grant `api.agents.read`, `api.agents.write`, and `api.responses.write`.

```bash
export OPENAI_API_KEY="your-api-key"
```

> Keep this key outside the agent's sandbox.

Every request needs the `OpenAI-Beta: agents=v1` header. The SDKs add it automatically; with cURL you must include it yourself.

### 1. Install

```bash
npm install openai
```

### 2. Create the agent, run it, and stream (one single call)

`quickstart.mjs` — session creation, task submission, and progress streaming all happen in **a single request**. The SDK uses the `beta.agents` namespace.

```javascript
import OpenAI from 'openai'

const client = new OpenAI()

const events = await client.beta.agents.sessions.create({
  agent: {
    model: 'gpt-6-astra',
    instructions: 'Write clean code, run it, and report the actual output.',
  },
  environment: { type: 'openai_hosted' },
  input:
    'Create tree.py, a Python script that prints a readable tree of the files in the current directory. Run it and show me the output.',
  stream: true,
})

try {
  for await (const event of events) {
    console.log(JSON.stringify(event))
  }
}
finally {
  events.controller.abort()
}
```

```bash
node quickstart.mjs
```

> **Don't need a sandbox?** Set `environment.type` to `none` for agents that answer questions or call external tools without running commands or working with local files.

### 3. Receiving results — deciding success is not straightforward

This is the point the docs warn about repeatedly.

> Look for `agent.session.turn.completed`, then check the agent's reported execution result. **A completed turn does not guarantee every tool succeeded.** Events ending in `turn.failed`, `turn.cancelled`, or `session.failed` indicate failure or cancellation; **`agent.session.idle` alone does not mean success.**

Also, if the session is waiting on a function result or an environment connection, you must retrieve the session, inspect `required_actions`, and handle it before work can continue.

### 4. Sending a follow-up turn

Save the `session_id` and send an `agent.session.input.message` event to the same session. **Open the event stream before sending follow-up input** so you don't miss the turn's early events.

```javascript
// Pass your saved session ID and message to this helper.
async function sendMessage(client, sessionId, text) {
  await client.beta.agents.sessions.events.create(sessionId, {
    events: [
      {
        type: 'agent.session.input.message',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text,
              },
            ],
          },
        ],
      },
    ],
  })
}
```

To stop a turn in progress, send `agent.session.input.cancel`. The session and its previous work remain.

```javascript
// Pass your saved session ID to this helper.
async function cancelTurn(client, sessionId) {
  await client.beta.agents.sessions.events.create(sessionId, {
    events: [{ type: 'agent.session.input.cancel' }],
  })
}
```

Retrieving saved work:

```javascript
// Pass your saved session ID to this helper.
async function listItems(client, sessionId) {
  return client.beta.agents.sessions.items.list(sessionId, {
    order: 'asc',
    limit: 100,
  })
}
```

### 5. Clean up

```javascript
// Replace the illustrative IDs and URLs below with your own resource values.
import OpenAI from 'openai'

async function deleteSession(client, sessionId) {
  return client.beta.agents.sessions.delete(sessionId)
}

const result = await deleteSession(new OpenAI(), 'sess_123')
console.log(result)
```

Before deleting a session you must [save any files you need](https://developers.openai.com/api/docs/guides/agents-api/environments/files) first.

## Execution model

### Hosted / server-side execution — three environment types

The harness itself **always runs server-side at OpenAI**. What you choose is the *environment*, i.e. where commands and files live.

| `environment.type` | Managed by | Characteristics |
| --- | --- | --- |
| `none` | — | No compute or files. The harness calls the model and uses the configured tools. Remote MCP tools are called directly by the harness. **Built-in Bash / apply-patch tools, workspace files, and executor MCPs are unavailable.** Initial input is required at session creation |
| `openai_hosted` | OpenAI | OpenAI creates and manages a sandbox for the session. You configure packages, initial files, and network access. The harness runs commands in the sandbox directly. Environment templates can be reused across sessions |
| `self_hosted` | You | For when the agent needs your infrastructure, private network, or custom software. Your code starts the environment and connects an **executor** to the session; the executor runs what the harness requests. You manage the connection and lifecycle without forwarding each command. **Provisioning, reconnection, shutdown, and preserving any files are entirely your responsibility** |

A caveat when shutting down self_hosted: "Before stopping compute, coordinate incoming work and confirm that no execution is pending."

### Durability

The docs use **durable explicitly** — "Session: A durable instance of an agent." And:

> The Agents API retains session state so you can continue work across turns without rebuilding the conversation context.

Among what the managed harness provides, these bear directly on durability:

- Summarizing previous work to manage its context window (context compaction)
- **Resuming a session where it left off**
- Steering the agent while it works
- Breaking work into subtasks and delegating to subagents

That said, **the stream itself is not durable**:

> Streams do not replay missed events. After a disconnect, retrieve the session and its saved items to recover the work.

So the unit of durability is the *session + items*, not the *stream*. After a disconnect you retrieve the session and its saved items to recover before retrying.

### Streaming vs webhooks

There are two paths, and you may use both.

- **Streaming** — receive detailed events while the agent works, e.g. output to display in your product.
- **Webhooks** — receive session state changes without holding a stream open. Your handler can retrieve results, run function tools, or manage a self-hosted environment.

Warning: without a function tool handler, **the agent can remain waiting for a result indefinitely.** Failures in your event or lifecycle handlers can also interrupt progress updates or environment management.

### Where state is stored

Session state, the conversation, and saved items are **retained on OpenAI's side**. The application only needs to store the `session_id` alongside its own conversation state. You can delete sessions and published artifacts when you no longer need them.

## Tools

The overview's "Configure managed-harness capabilities" example shows the whole tool surface at once.

```javascript
import OpenAI from 'openai'

const client = new OpenAI()

const session = await client.beta.agents.sessions.create({
  agent: {
    model: 'gpt-6-astra',
    instructions:
      'Use the OpenAI documentation MCP and web search to answer technical questions accurately. Delegate independent research tasks to subagents when useful.',
    tools: [
      { type: 'programmatic_tool_calling' },
      {
        type: 'mcp',
        server_label: 'openai_docs',
        transport: {
          type: 'http',
          server_url: 'https://developers.openai.com/mcp',
        },
      },
      { type: 'web_search' },
    ],
    multi_agent: { enabled: true, max_concurrent_subagents: 4 },
  },
  environment: {
    type: 'self_hosted',
    workspace_directory: '/workspace',
    capability_directories: ['/workspace/capabilities/skills'],
  },
  input: [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'Research how to connect an MCP server to an OpenAI agent, check for recent updates, and summarize the recommended setup.',
        },
      ],
    },
  ],
})

console.log(session.id)
```

**Built-in tools** (those confirmed in the docs)

- `web_search`
- `programmatic_tool_calling`
- **Bash**, **apply-patch** — available only when there is an environment (not available under `environment.type: "none"`)

**Function tools**

The harness calls remote MCP tools directly, but function tools are different: "your code receives each call, runs the function, and returns its result." So a **function tool is a callback loop on the application side**, and without a handler the session stays in a waiting state. The session's `required_actions` is the signal for this.

**MCP support — yes.**

Declare it directly in the agent's `tools` as `{ type: "mcp", server_label, transport: { type: "http", server_url } }`. The harness calls remote MCP tools directly. Separately there is a concept of an "executor MCP," which is only usable when an environment exists.

**Skills / plugins / environment templates**

`environment.capability_directories` (e.g. `["/workspace/capabilities/skills"]`) designates skill directories. "Applying relevant skills and instructions" is in the managed harness's capability list. Details link out to the [Plugins](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins) page (skills, plugins, templates) — outside the scope of this research.

**Multi-agent / subagents**

`multi_agent: { enabled: true, max_concurrent_subagents: 4 }`. The managed harness provides "Breaking work into subtasks and delegating to subagents."

## Limits / pricing / beta status

**Beta**: yes. Every request needs the `OpenAI-Beta: agents=v1` header, and the SDK namespace is `client.beta.agents.*`.

**Pricing** (the full Pricing section from the overview)

> Model usage is billed at the selected model's [API rates](https://developers.openai.com/api/docs/pricing). OpenAI tools use their [standard rates](https://developers.openai.com/api/docs/pricing#built-in-tools), and OpenAI-hosted sandboxes use standard [container rates](https://developers.openai.com/api/docs/pricing#built-in-tools).

So **there is no separate orchestration fee for the Agents API itself in the docs.** It is the sum of model API rates + standard built-in tool rates + (when `openai_hosted`) standard container rates. The concrete unit prices live on the pricing page and were not verified in this research.

**Data residency / retention limits**

> The Agents API currently supports data residency only in the United States and does not support Zero Data Retention (ZDR). **Choosing a self-hosted sandbox does not make the Agents API ZDR-eligible.**

The statement that a self_hosted environment does not confer ZDR eligibility is explicit. It reads as a consequence of the harness and session state remaining at OpenAI.

**Rate limits / caps on session count or lifetime**: **not in the docs** among the five pages reviewed. Sandbox configuration and limits are delegated to the [OpenAI-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted#configure-the-sandbox) page (outside the scope of this research).

**Models**: every example uses `gpt-6-astra`. The list of supported models was not verified.

## Implications for amond-ai/agent

This section was written against ADR-0001 (filesystem-first agent definition) and ADR-0002 (durable execution contract). ADR-0003 has since superseded both, so read the points below as inputs to that decision, not as constraints on the current design.

**1. Separating "agent configuration" from "session" maps precisely onto our loader structure.**
OpenAI separates the saved agent (reusable settings) from the session (conversation + work). Our `agent/` directory tree corresponds to the saved agent; durable turn state corresponds to the session. The override rule in particular — "supplied arrays **replace** the entire field rather than merging" — is a semantic we need to settle in advance for mixing typed settings in `agent.ts` with runtime overrides. Merge semantics get especially ambiguous in a structure where a file *is* the registration, as with `tools/*.ts`, so making "replace" the default is easier to explain.

**2. Defining the unit of durability as "session + saved items" rather than the stream.**
"Streams do not replay missed events. After a disconnect, retrieve the session and its saved items to recover the work." — this is evidence that, in ADR-0002's durable contract (start a turn / resume / wait for an event / record the outcome), **defining resume as re-reading state rather than replaying events** ports better across adapters. Neither Cloudflare Workflows nor Vercel Workflow guarantees client stream replay, so it is worth us stating the same layering explicitly: items are the authoritative store, and the stream is a best-effort view.

**3. The three-way split of `environment.type` is a proven precedent for our `@amond-ai/sandbox` contract.**
`none` / `openai_hosted` / `self_hosted` map to "no compute / vendor-managed / user-managed." We already have e2b, Cloudflare, and local processes behind a sandbox contract, and the lesson here is that **they made `none` a first-class option**. Having a path that does not force a sandbox on question-answering or external-API-calling agents removes both cold start and cost. But we must also express at the capability level that under `none` Bash/apply-patch/workspace files disappear wholesale — you get partial satisfaction where, in a filesystem-first definition, `tools/*.ts` survives while file-manipulation skills die.

**4. `capability_directories` is evidence that filesystem-first definitions work even for a managed harness.**
Even OpenAI passes skills not as an API parameter but as a **directory path inside the environment** (`["/workspace/capabilities/skills"]`). That is the same direction as our ADR-0001 `skills/<name>/SKILL.md` layout, meaning we could adopt the same adapter boundary — "the interface for handing skills to a harness is a directory path" — without friction. For a Codex adapter it may map across almost verbatim.

**5. Success determination and "stuck sessions" belong in the contract.**
The warning the docs repeat twice — `turn.completed` does not mean every tool succeeded, `session.idle` alone does not mean success, and without a function tool handler a session waits forever — is the most expensive failure mode in durable execution. A design that **exposes "what must be done externally for work to proceed" as a queryable field**, as `required_actions` does, is also needed for the "wait for an event" state in our durable contract. We must be able to distinguish, from state alone, a session paused for days awaiting approval from one permanently stalled because a handler is missing.

**Note — what we have not yet verified**: caps on session lifetime, rate limits, and concrete container unit prices. Comparing directly against ADR-0002's figures such as "365 days / 10,000 steps" would require further research on [environments/openai-hosted](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) and the pricing page.

## Reference links

Pages actually fetched during this research (all retrieved as raw markdown via the `.md` suffix):

- [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview)
- [Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
- [Architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture)
- [Run and continue sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [Configuring Agents](https://developers.openai.com/api/docs/guides/agents-api/configuration)

Pages referenced in the documentation but not verified in this research:

- [Events and Items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)
- [Webhooks](https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks)
- [Managing sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage)
- [OpenAI-hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)
- [Self-hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted)
- [Sandbox lifecycle](https://developers.openai.com/api/docs/guides/agents-api/environments/lifecycle)
- [Files and artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files)
- [Function tools](https://developers.openai.com/api/docs/guides/agents-api/tools/functions)
- [MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)
- [Plugins (skills, plugins, templates)](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins)
- [Vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults)
- [Multi-agent](https://developers.openai.com/api/docs/guides/agents-api/multi-agent)
- [Compare agent runtimes](https://developers.openai.com/api/docs/guides/agents#compare-agent-runtimes)
- [Agents API reference](https://developers.openai.com/api/reference/resources/beta/subresources/agents)
- [Pricing](https://developers.openai.com/api/docs/pricing)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data#storage-requirements-and-retention-controls-per-endpoint)

Example applications (showcase):

- [Incident response agent](https://developers.openai.com/showcase/agents-api-sev-bot)
- [Slack bot](https://developers.openai.com/showcase/agents-api-slack-bot)
- [Data analyst](https://developers.openai.com/showcase/agents-api-data-analyst)
- [GitHub issue investigator](https://developers.openai.com/showcase/agents-api-github-issues)
- [Document reviewer](https://developers.openai.com/showcase/agents-api-document-review)
