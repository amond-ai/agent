# ADR-0001: Define agents through the filesystem, not a code API

## Status

Accepted

## Date

2026-09-15

## Context

This repository builds an agent framework on top of `@amond-ai/harness-*`, which already runs a
Claude Code turn inside a sandbox and survives reconnects. The framework's job is the layer above:
how a person or an agent declares what an agent *is*, and how that declaration reaches a handler
deployable to Cloudflare Workers or Vercel.

Two constraints shape the answer.

**The primary author is an agent, not a person.** The expected workflow is an agent creating and
editing other agents. That makes the unit of change the thing that matters: an agent editing a
file whose whole purpose is one concern edits it safely, while an agent editing a function body
inside a larger composition has to read and preserve surrounding logic it did not write.

**Two nearby frameworks chose differently, and both are instructive.** Flue (withastro) exposes a
React-like hooks API (`useModel`, `useTool`, `useSandbox`) over Pi, the harness behind OpenClaw.
eve (Vercel) is filesystem-first — `agent/instructions.md` plus TypeScript tools, skills, channels
and schedules — over the AI SDK harness. Flue optimises for composition; eve optimises for a
layout that can be read, diffed and regenerated a piece at a time.

## Decision Drivers

- The primary author of an agent is another agent, so the unit of change has to be a file rather
  than a region inside one.
- Instructions must be editable by someone who does not read TypeScript.
- Adding a tool, skill or schedule must not require editing a shared registry that concurrent
  edits would collide on.
- The harness is chosen explicitly, so at least one typed entry point is unavoidable.

## Decision

Agents are defined by a directory layout. Markdown carries instructions, TypeScript carries
behaviour, and one optional `agent.ts` carries the choices that must be typed.

```text
agent/
  instructions.md      # the agent's instructions
  agent.ts             # optional: harness adapter, model, policy
  tools/*.ts           # one tool per file, default-exported
  skills/<name>/SKILL.md
  schedules/*.ts       # cron-triggered entry points
  channels/*.ts        # event-triggered entry points
```

The loader resolves this tree into a runnable agent. A file's path is its meaning, so adding a tool
is adding a file and nothing else — no registry to update, no import list to keep in sync.

`agent.ts` exists because the harness is chosen explicitly (`harness: claudeCode({ ... })` or
`codex({ ... })`), and a choice that decides which adapter runs belongs in typed code rather than
in a string in a config file. Everything the filesystem can express stays in the filesystem.

Instructions live in Markdown rather than in a TypeScript string because that is what the
harnesses themselves consume — Claude Code reads `.claude/`, eve reads `agent/instructions.md` —
and a Markdown file is editable by someone who does not read TypeScript.

## Consequences

### Positive

- One concern per file, so an agent regenerating a tool rewrites one file and cannot disturb
  another.
- Adding a tool, skill or schedule is adding a file — nothing else changes.
- The layout is inspectable without running anything: `ls agent/tools` is the tool list.
- Instructions are editable without TypeScript knowledge.

### Negative

- Conditional composition ("attach this tool only when a flag is set") has no natural home in a
  directory. It has to be expressed in `agent.ts` or inside the tool itself, which is less direct
  than a hooks API makes it.
- The loader is a real component with its own failure modes — a mistyped filename is a runtime
  discovery problem, where a code API would have been a compile error.
- The convention is now an API. Renaming a directory is a breaking change.

### Neutral

- Convergence with eve's layout makes the two frameworks comparable and lowers the cost of reading
  eve's examples, at the price of looking derivative.
- Type safety concentrates at the `agent.ts` and tool boundaries rather than spreading across the
  whole definition.

## Alternatives Considered

- **Code hooks (Flue's model)**: strongest composition and type inference, and conditional
  construction is natural. Rejected because the change unit is a function body rather than a file,
  which is the wrong shape for an agent-authored codebase — the property this framework optimises
  for.
- **Single declarative config (`agent.config.ts`)**: the whole agent visible at once, which reads
  well for a person. Rejected because every addition edits one shared file, making concurrent
  agent edits collide, and because it caps dynamic behaviour without buying back the
  file-granularity we wanted.
- **Full abstraction over the harness**: declare capabilities and let the framework pick the
  harness. Rejected separately in the same discussion — harness differences are load-bearing at
  this stage, and hiding them would either leak or over-constrain. The harness is chosen
  explicitly.

## References

- [Flue — why Flue](https://flueframework.com/docs/guide/why-flue/) — built on Pi, the harness behind OpenClaw
- [Flue — building agents](https://flueframework.com/docs/guide/building-agents/) — the hooks API
- [vercel/eve](https://github.com/vercel/eve) — filesystem-first layout
- [`@amond-ai/harness-*`](https://github.com/amond-ai/harness) — the turn layer this sits on

---

**Created**: 2026-09-15
**Author**: Minsu Lee
**Last Updated**: 2026-09-15
