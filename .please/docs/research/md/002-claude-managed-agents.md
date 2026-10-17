---
id: 002
title: "Claude Managed Agents"
url: "https://platform.claude.com/docs/en/managed-agents/quickstart"
date: 2026-09-16
summary: "Anthropic's managed agent harness, built around four resources — agent, environment, session, and event — that runs the agent loop server-side in a sandbox for long-running work. Sessions persist their state server-side and are observable and steerable through an SSE event stream; as of 2026-09 the product is in beta."
tags: [anthropic, claude, managed-agents, hosted-agents]
published: { repo: chatbot-pf/memex, id: 125, at: 2026-09-17 }
---

# Claude Managed Agents

> Pages consulted (all under `platform.claude.com/docs/en/managed-agents/*`): quickstart, overview,
> events-and-streaming, tools, vaults. Only content **verified on those five pages** is recorded here.
> The rendered HTML exposes just one language tab, so the `.md` source of each page was fetched
> directly in order to quote the TypeScript tab.

## 1. Overview

Anthropic frames two ways of building with Claude:

| | Messages API | Claude Managed Agents |
| --- | --- | --- |
| What it is | Direct model prompting access | Pre-built, configurable agent harness that runs in managed infrastructure |
| Best for | Custom agent loops and fine-grained control | Long-running tasks and asynchronous work |

The problem Managed Agents solves is removing the need to build the agent loop, tool execution, and
runtime yourself. From the overview: *"Instead of building your own agent loop, tool execution, and
runtime, you get a fully managed environment where Claude can read files, run commands, browse the
web, and run code securely."* The harness ships with built-in performance optimizations such as
prompt caching and compaction.

Workloads the docs call out as a good fit:

- **Long-running execution** — minutes to hours, with many tool calls
- **Cloud infrastructure** — secure sandboxes with pre-installed packages and network access
- **Self-hosted execution** — sandboxes on infrastructure you control, for compliance or data residency
- **Minimal infrastructure** — no need to build your own agent loop, sandbox, or tool execution layer
- **Stateful sessions** — persistent filesystems and conversation history across multiple interactions
- **Scheduled execution** — recurring runs on a cron schedule (scheduled deployments)

The relationship to the Agent SDK is **not stated** on any of the five pages fetched (not in docs).
The axis the documentation actually contrasts is Messages API (write your own loop) vs. Managed
Agents (managed harness); separately, the `ant` CLI and the per-language SDKs (`@anthropic-ai/sdk`
and others) appear as the clients that manipulate Managed Agents resources. The product is also
available on Claude Platform on AWS, with stated differences in feature availability and session
behavior.

## 2. Core resource model

The four concepts presented identically by both quickstart and overview:

| Concept | Description (verbatim) |
| --- | --- |
| **Agent** | The model, system prompt, tools, MCP servers, and skills |
| **Environment** | Configuration for where sessions run: an Anthropic-managed cloud sandbox, or a self-hosted sandbox on your own infrastructure |
| **Session** | A running agent instance within an environment, performing a specific task and generating outputs |
| **Events** | Messages exchanged between your application and the agent (user turns, tool results, status updates) |

How they relate, within what the docs confirm:

- An `agent` is created once and **reused across many sessions by ID**. The response carries both
  `id` and `version`, and `ant apply` records the ID in `claude-lock.json` — so an **agent definition
  is a versioned resource**.
- An `environment` is likewise created once and referenced by ID. `config.type` is either `cloud`
  (Anthropic-managed) or a self-hosted sandbox, and it specifies settings such as `networking`.
- A `session` is created referencing an `agent` plus an `environment_id`, and carries a `title`.
- An `event` is an append-only record belonging to a session. Events flow in both directions and are
  persisted server-side.
- `vault` / `credential` are authentication primitives separate from the four above. **A vault is
  workspace-scoped** and is referenced as a parameter at session creation. From the docs: *"you can
  manage your product at the `agent` resource granularity and your users at the `session` resource
  granularity."*
- Other concepts visible in the sidebar: permission policies, Agent Skills, session budgets, webhooks,
  define outcomes, memory store, multiagent orchestration, scheduled deployments, MCP tunnels, and
  dreaming (research preview). These fell outside the scope of this pass and were not examined in detail.

REST paths per resource: `/v1/agents`, `/v1/environments`, `/v1/sessions`,
`/v1/sessions/{id}/events`, `/v1/sessions/{id}/events/stream`, `/v1/vaults`,
`/v1/vaults/{id}/credentials`.

## 3. Quickstart flow (TypeScript)

### 0) Install

```bash
brew install anthropics/tap/ant
```

```bash
npm install @anthropic-ai/sdk
```

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

Beta header: *"Managed Agents API requests require the `managed-agents-2026-04-01` beta header, except
memory store endpoints, which use `agent-memory-2026-07-22` instead. The SDK sets the correct beta
header automatically."*

### 1) Create an agent

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

const agent = await client.beta.agents.create({
  name: 'Coding Assistant',
  model: 'claude-opus-5',
  system: 'You are a helpful coding assistant. Write clean, well-documented code.',
  tools: [
    { type: 'agent_toolset_20260401' },
  ],
})

console.log(`Agent ID: ${agent.id}, version: ${agent.version}`)
```

Via the CLI the same definition is expressed as a **markdown file with frontmatter**, applied with
`ant apply coding-assistant.md` — that is, Anthropic itself offers a file-based agent definition
path as a first-class option:

```markdown
---
name: Coding Assistant
model: claude-opus-5
tools:
  - type: agent_toolset_20260401
---

You are a helpful coding assistant. Write clean, well-documented code.
```

### 2) Create an environment

```typescript
const environment = await client.beta.environments.create({
  name: 'quickstart-env',
  config: {
    type: 'cloud',
    networking: { type: 'unrestricted' },
  },
})

console.log(`Environment ID: ${environment.id}`)
```

The CLI side uses `environment.yaml`:

```yaml
name: quickstart-env
config:
  type: cloud
  networking:
    type: unrestricted
```

### 3) Create a session

```typescript
const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environment.id,
  title: 'Quickstart session',
})

console.log(`Session ID: ${session.id}`)
```

### 4) Send a message and stream events

```typescript
const stream = await client.beta.sessions.events.stream(session.id)

// Send the user message after the stream opens
await client.beta.sessions.events.send(session.id, {
  events: [
    {
      type: 'user.message',
      content: [
        {
          type: 'text',
          text: 'Create a Python script that generates the first 20 Fibonacci numbers and saves them to fibonacci.txt',
        },
      ],
    },
  ],
})

// Process streaming events
for await (const event of stream) {
  if (event.type === 'agent.message') {
    for (const block of event.content) {
      if (block.type === 'text') {
        process.stdout.write(block.text)
      }
    }
  }
  else if (event.type === 'agent.tool_use') {
    console.log(`\n[Using tool: ${event.name}]`)
  }
  else if (event.type === 'session.status_idle') {
    console.log('\n\nAgent finished.')
    break
  }
}
```

**Ordering matters**: *"Only events emitted after the stream is opened are delivered, so open the
stream before sending events to avoid a race condition."*

## 4. Execution model

### What's happening (the quickstart's five steps, verbatim)

1. **Provisions a sandbox:** Your environment configuration determines how it's built.
2. **Runs the agent loop:** Claude determines which tools to use based on your message.
3. **Runs tools:** File writes, bash commands, and other tool calls run inside the sandbox.
4. **Streams events:** You receive real-time updates as the agent works.
5. **Goes idle:** The agent emits a `session.status_idle` event when it has nothing more to do.

### Persistence

The key sentence from the overview: *"Claude Managed Agents is stateful by design: sessions are
long-running, resume cleanly after pauses, and store conversation history, sandbox state, and outputs
server-side."*

- Storage location: **Anthropic's servers**. What is stored: conversation history, sandbox state, outputs.
- Resumption: *"resume cleanly after pauses"* — explicitly stated.
- History: *"Event history is persisted server-side and can be fetched in full."*
  (`client.beta.sessions.events.list(session.id)`)
- Deletion: APIs exist for deleting sessions and deleting uploaded files.
- Because of this statefulness, it is **not eligible for Zero Data Retention (ZDR) or a HIPAA BAA**.

### Event stream structure

- Event type strings follow a `{domain}.{action}` convention. The exceptions are the stream-only delta
  preview events `event_start` and `event_delta`.
- **Outbound (what you send)**: `user.*` events, such as `user.message` and `user.interrupt`, start
  and steer the session. `system.message` appends
  system-level context that applies to the accompanying turn and all subsequent turns.
- **Inbound (what you receive)**: session events, span events, and agent events. Concrete types
  confirmed in the body text: `agent.message`, `agent.tool_use`, `agent.tool_result` (which carries an
  `is_error` field), `session.status_idle`, and `session.error`.
- Every persisted event carries a `processed_at` timestamp. On events you send, `processed_at` is null
  while the event is still queued behind earlier events. The exceptions are `user.define_outcome`,
  `user.custom_tool_result`, and `user.tool_result`, which are processed on receipt and echoed back
  with `processed_at` already populated.
- **Interrupting**: send `user.interrupt`, then a `user.message` to redirect. The call returns as soon
  as the events are queued, and a model response in progress stops immediately, but the interrupt can
  take longer to apply while tool calls are running, during which the session stays `running`. The
  interrupted turn ends with `session.status_idle` and a `stop_reason` of `end_turn` — *"there is no
  stop reason specific to interruption."*
- **Lossless reconnect recipe** (the three steps the docs spell out): ① open a new stream → ② list the
  full event history to seed a set of seen event IDs → ③ tail the live stream, skipping any events
  already seen. Preview events (`event_start`/`event_delta`) carry no top-level `id`, so filter them
  out first:

```typescript
const seenEventIds = new Set()
const stream = await client.beta.sessions.events.stream(session.id)

// Stream is open and buffering. List history before tailing live.
for await (const event of client.beta.sessions.events.list(session.id)) {
  seenEventIds.add(event.id)
}

// Tail live events, skipping anything already seen
for await (const event of stream) {
  // Preview events (event_start/event_delta) carry no top-level id
  if (event.type === 'event_start' || event.type === 'event_delta') {
    continue
  }
  if (seenEventIds.has(event.id)) {
    continue
  }
  seenEventIds.add(event.id)
  // ...
}
```

- The transport is SSE (`accept: text/event-stream`, `/events/stream`).
- **Webhook event types are separate from the stream's**, and some of their names differ (for example,
  `session.status_idled` rather than `session.status_idle`).

## 5. Tools

### Built-in tools (`agent_toolset_20260401`)

| Tool | Name | Description |
| --- | --- | --- |
| Bash | `bash` | Execute bash commands in a shell session |
| Read | `read` | Read a file from the sandbox filesystem |
| Write | `write` | Write a file to the sandbox filesystem |
| Edit | `edit` | Perform string replacement in a file |
| Glob | `glob` | Fast file pattern matching using glob patterns |
| Grep | `grep` | Text search using regex patterns |
| Web fetch | `web_fetch` | Fetch content from a URL |
| Web search | `web_search` | Search the web for information |

- Including the toolset enables all of them by default. Entries in the `configs` array are identified
  by `name`; `type` is optional (the server infers it from `name`).
- **Disabling one tool**: `{"name": "web_fetch", "enabled": false}`
- **Allowlist style**: `default_config` sets the baseline for every tool, and per-tool `configs`
  entries override it.

```json
{
  "type": "agent_toolset_20260401",
  "default_config": { "enabled": false },
  "configs": [
    { "name": "bash", "enabled": true },
    { "name": "read", "enabled": true },
    { "name": "write", "enabled": true }
  ]
}
```

- **Domain restrictions**: `allowed_domains` or `blocked_domains` on `web_search`/`web_fetch`. A listed
  domain covers that host and all of its subdomains. A `web_fetch` call to a URL its lists do not
  permit returns an error result to the agent (`is_error: true` on the `agent.tool_result` event, with
  content naming the error code `url_not_allowed`), while `web_search` omits results its lists do not
  permit. `web_fetch` also accepts `max_content_tokens`, and `web_search` accepts `user_location`.
- Each config entry can set a `permission_policy` that controls whether the tool's calls run without
  confirmation, require confirmation, or are evaluated individually by the server (details live on the
  Permission policies page, not fetched in this pass).
- **Large tool output handling**: when a tool output exceeds 100,000 characters (about 25,000 tokens),
  it is automatically written to a file in the sandbox; the model receives a truncated preview with the
  file path and can read the full content from there.

```typescript
const agent = await client.beta.agents.create({
  name: 'Coding Assistant',
  model: 'claude-opus-5',
  tools: [
    {
      type: 'agent_toolset_20260401',
      configs: [{ name: 'web_fetch', enabled: false }]
    }
  ]
})
```

### Custom tools

*"Claude Managed Agents also supports custom, user-defined tools. Your application executes these
tools separately and returns the results to Claude, which uses them to continue the task."*
Results are returned via the `user.custom_tool_result` event (which is on the list of events processed
on receipt).

### MCP

To give the agent tools from an MCP server you use the **MCP connector** rather than the toolset
(separate page). A vault's MCP credentials are keyed by `mcp_server_url`, so when the agent connects
to a server at that URL at session runtime, the token is injected automatically. MCP tunnels are in a
more limited research preview even within the beta.

### Secrets (vault / credential)

- A **vault** is the collection of `credentials` associated with an end user. It has a `display_name`
  and optional arbitrary `metadata` (for example `external_user_id`), used to map it back to your own
  user records.
- Workspace-scoped → any API key with workspace access can reference it when creating a session.
  **To revoke access, delete the vault or the credential.**
- Two credential categories:
  - **MCP credentials** (`mcp_oauth`, `static_bearer`): keyed by `mcp_server_url`; the token is injected
    automatically when the agent connects to that server. With `mcp_oauth`, supplying a `refresh` block
    means Anthropic refreshes the access token on your behalf when it expires.
    `refresh.token_endpoint_auth.type` is one of `none`, `client_secret_basic`, or `client_secret_post`.
  - **Environment variables** (`environment_variable`): keyed by `secret_name` and **stored in the
    sandbox only as an opaque placeholder**. When the agent initiates an outbound request, the
    placeholder is substituted with the real secret **at egress**. *"The agent never sees the secret
    value."* Not yet supported with self-hosted sandboxes.
- `token`, `access_token`, `refresh_token`, `client_secret`, and `secret_value` are treated as
  sensitive, write-only fields and **are never returned in API responses**.

```typescript
const vault = await client.beta.vaults.create({
  display_name: 'Alice',
  metadata: { external_user_id: 'usr_abc123' },
})
console.log(vault.id) // "vlt_01ABC..."
```

```typescript
const bearerCredential = await client.beta.vaults.credentials.create(vault.id, {
  display_name: 'Linear API key',
  auth: {
    type: 'static_bearer',
    mcp_server_url: 'https://mcp.linear.app/mcp',
    token: 'lin_api_your_linear_key',
  },
})
```

## 6. Limits / pricing / beta status

**Beta status — confirmed.**

- *"Claude Managed Agents is in beta."* All endpoints require the `managed-agents-2026-04-01` beta
  header (memory store endpoints use `agent-memory-2026-07-22` instead). The SDK sets it automatically.
- Access is **enabled by default for all API accounts**. All you need is an API key plus the beta header.
- *"Behaviors may be refined between releases to improve outputs."* — behavior may change between releases.
- Even within the beta, **MCP tunnels and dreaming are in a more limited research preview** and require
  a separate access request.

**Limits — what was confirmed.**

- **Not eligible** for ZDR or a HIPAA BAA (because statefulness is a design premise). In exchange, you
  can delete sessions and delete uploaded files through the API at any time.
- Tool output beyond 100,000 characters (about 25,000 tokens) is offloaded to a file, with a truncated
  preview given to the model.
- `environment_variable` credentials are not supported with self-hosted sandboxes.
- Rate limits are linked to a separate reference page
  (`/managed-agents/reference#rate-limits`), which **was not fetched in this pass, so the concrete
  numbers are unverified**. A separate session budgets feature also exists.

**Pricing — not in docs.** None of the five pages fetched mention pricing or the billing unit for
Managed Agents (session time, sandbox usage, etc.). Only a `Models & pricing` link exists in the top
navigation.

## 7. Implications for `amond-ai/agent`

From the perspective of ADR-0001 (filesystem-first agent definition) and ADR-0002 (durable execution
contract). ADR-0003 has since superseded both, so read these points as inputs to that decision, not as
constraints on the current design.

1. **External validation that file-based agent definition is a first-class path for Anthropic itself.**
   `ant apply coding-assistant.md` applies frontmatter (`name`/`model`/`tools`) plus a body (the system
   prompt) — close to the shape ADR-0001 chose, which differs in one place: ADR-0001 keeps the
   instructions in a plain `instructions.md` with no frontmatter and puts the model and harness in
   `agent.ts`. The environment is split out into
   `environment.yaml`. In other words, **"what it does" (markdown) and "where it runs" (YAML) live in
   separate files**, which is a precedent for not mixing instructions with runtime/sandbox config in a
   single file in our layout either.

2. **The `apply` → remote ID → lockfile pattern.** `ant apply` records the generated `agent.id` and
   `environment.id` in `claude-lock.json`, and the agent response carries a `version`. The file is the
   source of truth, while the deployed resource has an ID and a version. This is a directly usable
   precedent for how a filesystem-first framework connects "declaration file ↔ deployed instance"
   (lockfile plus resource version).

3. **The resumption contract for a durable session is expressed as "append-only event log + idempotent
   replay."** Managed Agents solves resumption not with checkpoints or step memoization but with
   **list event history + tail the stream + dedup by seen ID**. Given that ADR-0002 commits to owning a
   contract that adapts to each platform (Cloudflare Workflows / Vercel Workflow), this "the event log
   *is* the unit of resumption" model is an **observability layer needed independently** of `step.do()`
   memoization. Do not try to collapse the two into one abstraction.

4. **Decide interrupt/steering semantics up front.** In Managed Agents, `user.interrupt` (a) returns as
   soon as it is queued, (b) is delayed in taking effect while a tool call runs, and (c) ends the
   interrupted turn with `stop_reason: end_turn` — **there is no dedicated stop reason distinguishing
   "was interrupted."** For our execution model, where waiting on approvals and webhook resumption are
   first-class, this is a cautionary example. Let's put a termination reason in the contract that can
   distinguish normal completion from termination caused by external intervention.

5. **Secrets are resolved at egress, not in the sandbox.** `environment_variable` credentials leave only
   an opaque placeholder in the sandbox and substitute it at the moment of the outbound request — the
   agent never sees the value. In a framework where the filesystem is the unit of agent definition, that
   guarantee is lost the instant secrets are handled as files or environment variables. It is worth
   pinning down in an ADR that **secret references carry only a name in the definition file, and the
   point of resolution is pushed out to the runtime boundary**.

6. (Secondary) **Default policy for tool enablement.** Building an allowlist via
   `default_config.enabled: false` plus per-tool overrides is a cheap pattern for preventing the
   "a new tool got silently switched on" failure in our workflow, where agents edit agents.

## Reference links

- Quickstart — https://platform.claude.com/docs/en/managed-agents/quickstart
- Overview — https://platform.claude.com/docs/en/managed-agents/overview
- Session event stream — https://platform.claude.com/docs/en/managed-agents/events-and-streaming
- Tools — https://platform.claude.com/docs/en/managed-agents/tools
- Authenticate with vaults — https://platform.claude.com/docs/en/managed-agents/vaults
- (not examined, referenced only) Reference / rate limits — https://platform.claude.com/docs/en/managed-agents/reference
- (not examined) MCP connector — https://platform.claude.com/docs/en/managed-agents/mcp-connector
- (not examined) Permission policies — https://platform.claude.com/docs/en/managed-agents/permission-policies
- (not examined) Cloud environment setup — https://platform.claude.com/docs/en/managed-agents/environments
- (not examined) Self-hosted sandboxes — https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
- (not examined) Session budgets — https://platform.claude.com/docs/en/managed-agents/budgets
- (not examined) Scheduled deployments — https://platform.claude.com/docs/en/managed-agents/scheduled-deployments
- Quickstart example apps — https://github.com/anthropics/claude-quickstarts/tree/main/managed-agents
