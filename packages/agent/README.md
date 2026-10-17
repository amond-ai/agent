# @amond-ai/agent

The amond agent runtime: a programmable TypeScript harness for autonomous agents.

```sh
npm install @amond-ai/agent
```

An agent is a function. Compose the harness it needs with hooks, then return its instructions.

```ts
// src/agents/triage.ts
'use agent'
import { useModel, useSandbox, useSkill, useTool } from '@amond-ai/agent'
import { local } from '@amond-ai/agent/node'
import triage from '../skills/triage/SKILL.md'
import { openIssue, searchCode } from '../tools/github.ts'

export function Triage() {
  useModel('anthropic/claude-sonnet-4-6')
  useSandbox(local())
  useSkill(triage)
  useTool(openIssue)
  useTool(searchCode)

  return `
Triage a bug report end to end: reproduce the bug,
diagnose the root cause, and attempt a fix.`
}
```

## What it provides

- **Hooks** — `useModel`, `useSandbox`, `useSkill`, `useTool`, `useSubagent`, `useInstruction`,
  `useMcpConnection`, `usePersistentState`, and lifecycle hooks such as `useAgentStart`
  and `useResponseFinish`.
- **Definitions** — `defineTool`, `defineSkill`, `defineSubagent`, and `defineMcpConnection`.
- **Runtime functions** — `dispatch`, `getAgentInstance`, `observe`, and `createChannelRouter`.
- **Entry points** — `@amond-ai/agent/node` and `@amond-ai/agent/cloudflare` for each deploy
  target, plus `/config`, `/routing`, `/adapter`, and `/telemetry`.

## Use it

- Build and serve agents with Vite through [`@amond-ai/agent-vite`](../agent-vite).
- Run an agent from the terminal with the [`amond` CLI](../cli).
- Talk to a deployed agent with [`@amond-ai/agent-sdk`](../agent-sdk) or
  [`@amond-ai/agent-react`](../agent-react).
- Read the guides with `amond docs read <page>` once the documentation pages ship.

## Attribution

Derived from [Flue](https://github.com/withastro/flue), licensed under Apache-2.0.
See `NOTICE`.
