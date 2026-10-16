# ADR-0003: Build on a Flue fork, run turns through the AI SDK harness, ship to Cloudflare first

## Status

Accepted — supersedes ADR-0001 and ADR-0002

## Date

2026-10-16

## Context

ADR-0001 and ADR-0002 set out to build the framework layer ourselves: a filesystem-first agent
definition, our own durable contract with platform adapters, and our own `amond` CLI. A month in,
that layer is still mostly stubs — `createHandlers()`, `claudeCode()`, `codex()` and
`createCloudflareRuntime()` all throw, and `amond dev` is not implemented — while the turn layer
underneath it (`@amond-ai/harness-*`) is working and published.

Flue (withastro/flue, Apache-2.0, 2.3.0) already ships most of what that layer was going to be: agent
modules, an HTTP surface, durable submissions with leases and replay, persistence adapters, channels,
and a Vite build with two targets, Node and Cloudflare. On Cloudflare each agent is a Durable Object
backed by its embedded SQLite, and `@cloudflare/sandbox` is already a supported sandbox.

What Flue does not fit is the turn layer. It drives Pi (`@earendil-works/pi-agent-core`) directly:
`session.ts` constructs Pi's `Agent`, consumes its event stream, and runs the model loop in the host
process with Flue's own tools acting on Flue's `Sandbox`. There is no seam around the loop — Pi types
reach about twenty runtime files plus the Vite plugin and CLI. The AI SDK harness spec
(`@ai-sdk/harness`, `HarnessV1`) inverts that: the agent loop (Claude Code, Codex) runs inside the
sandbox and the host consumes `HarnessV1StreamPart`s, answering custom tool calls with
`submitToolResult`. `@amond-ai/harness-claude-code` already exports a `HarnessV1`
(`createClaudeCode`), and `@amond-ai/harness-sandbox` already implements `HarnessV1SandboxProvider`.

The sandbox layer has three overlapping shapes: Flue's `Sandbox` (`exec`, file operations, `cwd`,
`resolvePath`), the AI SDK's `Experimental_SandboxSession` (`run`, `spawn`, `read*`/`write*`, extended
with ports by `HarnessV1NetworkSandboxSession`), and `@amond-ai/sandbox`, which keeps its own shape
because it needs process reattachment. No official AI SDK sandbox provider exists for Cloudflare, and
`@amond-ai/harness` keeps its Cloudflare provider inside a consuming app rather than as a package.

## Decision Drivers

- Reach a deployable agent on one platform before generalising across platforms.
- Reuse the working, published `@amond-ai/harness-*` turn layer rather than a second agent loop.
- Run the coding-agent harnesses (Claude Code first) as the agent, not a model loop we maintain.
- One sandbox object should serve both the framework's tools and the harness.
- Stop maintaining framework infrastructure that an upstream project already maintains.

## Decision

1. **Flue is the base, as a fork.** Fork withastro/flue into `amond-ai/flue` and point
   `vendor/flue` at the fork. Swapping the agent loop means editing Flue's runtime internals, so
   depending on published `@flue/*` packages is not enough. The loop-seam refactor (decision 3) lands
   as its own behaviour-preserving commit so it can be offered upstream.
2. **Cloudflare is the first deployment target.** Agents run as Flue's Durable Objects; harness turns
   run in Cloudflare Sandbox containers reached through `@amond-ai/harness-transport-cloudflare`.
   Node stays a development target. Other platforms are out of scope until Cloudflare ships.
3. **The AI SDK harness replaces Pi.** Extract an agent-loop seam in Flue's session layer, implement
   it with `HarnessAgent` / `HarnessV1` (Claude Code via `@amond-ai/harness-claude-code` first), then
   remove Pi entirely. Flue concepts map onto the harness: custom tools become harness user tools,
   compaction becomes `doCompact`, steering becomes `experimental_steer`, and conversation records
   are built from `HarnessV1StreamPart`s. Every agent turn therefore runs in a sandbox container.
4. **Flue's sandbox extends the AI SDK sandbox.** Flue's `Sandbox` becomes an extension of
   `Experimental_SandboxSession` — the AI SDK shape plus the operations Flue's tools need (`cwd`,
   `resolvePath`, `stat`, `readdir`, `rm`, `mkdir`, `exists`) — so the same object is handed to the
   harness as its `sandboxSession`. A Cloudflare provider is added to `amond-ai/harness` as a
   package (`@amond-ai/sandbox-cloudflare`), and `@amond-ai/harness-sandbox` adapts it to
   `HarnessV1SandboxProvider`.
5. **Flue's agent model and durability replace ours.** Agents are Flue `'use agent'` modules. Flue's
   durable submissions replace the contract from ADR-0002. `packages/core`, `packages/durable`,
   `packages/durable-cloudflare` and the `amond` build CLI are retired; the harness adapter packages
   are reassessed once the seam exists.

## Consequences

### Positive

- Durable execution, persistence, routing, channels and the Cloudflare build come from a maintained
  project instead of stubs we would have to finish.
- The agent is the harness itself, so Claude Code's tools, permissions and session handling are used
  as shipped rather than re-implemented in a host-side loop.
- The `@amond-ai/harness-*` packages become the turn layer of a real framework instead of a
  standalone library.
- One sandbox object serves both Flue's tools and the harness.

### Negative

- We own a fork of a fast-moving project. Upstream changes to `session.ts` (6,000+ lines) will
  conflict with the seam until it is accepted upstream, if ever.
- Every turn needs a sandbox container, which adds cold-start latency and container cost; Flue's
  in-Durable-Object model loop is gone.
- Flue features built on Pi lose their meaning or need re-mapping: the model provider registry
  (Workers AI, AI Gateway), `thinkingLevel`, and Pi-specific message types.
- `@ai-sdk/harness` is experimental and moving quickly (1.0.87 pinned by `@amond-ai/harness`, 1.0.153
  latest). Its entry points import `node:fs` and `node:path` statically, which must be verified under
  `nodejs_compat` on Workers.
- Cloudflare-first reverses ADR-0002's equal-portability driver, and Flue's `'use agent'` directive
  is a Vite build transform — the kind of consumer-bundler requirement ADR-0002 set out to avoid.

### Neutral

- ADR-0001's filesystem-first layout is dropped in favour of Flue's module model. The concern behind
  it — agents authoring agents — is still open and can be revisited as a layer that generates Flue
  agent modules.
- Node remains available because Flue keeps it as a target; it is simply not the deployment priority.

## Alternatives Considered

- **Depend on published `@flue/*` and land a loop seam upstream first**: cleaner long term and no
  fork to maintain. Rejected for now because the swap is blocked on upstream review of a large
  refactor; the seam commit is kept upstreamable so this path stays open.
- **Copy Flue's packages into this repository**: the simplest edit loop. Rejected because it makes
  pulling upstream fixes a manual merge with no shared history.
- **Keep Pi behind the seam as an in-Durable-Object option**: avoids a container for lightweight
  agents. Rejected to keep a single execution model while the harness path is unproven; the seam
  makes adding a second loop kind later an adapter, not a redesign.
- **Replace Pi with the AI SDK `Agent` interface, using `ToolLoopAgent` for in-Worker agents**: no Pi
  dependency, two loop kinds. Rejected for the same reason as above.
- **Continue ADR-0001 and ADR-0002 as written**: no fork and no dependency on Flue's direction.
  Rejected because it means building durability, routing and a build pipeline that Flue already
  ships.

## References

- [withastro/flue](https://github.com/withastro/flue) — vendored at `vendor/flue`
- [`@ai-sdk/harness`](https://www.npmjs.com/package/@ai-sdk/harness) — `HarnessV1`, `HarnessAgent`,
  `HarnessV1SandboxProvider`
- [`@amond-ai/harness`](https://github.com/amond-ai/harness) — `createClaudeCode`, the sandbox
  contract, the Cloudflare transport
- [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/)
- ADR-0001 (0001-filesystem-first-agent-definition.md) — superseded
- ADR-0002 (0002-durable-execution-contract.md) — superseded

---

**Created**: 2026-10-16
**Author**: Minsu Lee
**Last Updated**: 2026-10-16
