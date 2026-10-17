# @amond-ai/agent-react

React hooks for live amond agent conversations. `@amond-ai/agent-react` manages UI state;
`@amond-ai/agent-sdk` handles HTTP and Durable Streams transport.

```sh
npm install @amond-ai/agent-react @amond-ai/agent-sdk
```

Requires React 18 or later.

## `useAmondAgent()`

The hook observes one agent conversation, addressed by URL: wherever the application's `app.ts`
mounts the agent's routes, plus a conversation id you choose. To start a new conversation, render
the hook with a fresh id.

```tsx
import { useAmondAgent } from '@amond-ai/agent-react'

function Chat({ conversationId }: { conversationId: string }) {
  const agent = useAmondAgent({ url: `/api/agents/triage/${conversationId}` })
  // agent.messages, agent.status, agent.sendMessage(...)
}
```

```ts
function useAmondAgent(options?: UseAmondAgentOptions): UseAmondAgentResult

interface UseAmondAgentOptions {
  url?: string
  client?: AmondClient
  live?: 'sse' | 'long-poll'
}
```

| Option   | Description                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`    | Conversation URL (agent mount URL plus conversation id). Relative URLs resolve against the browser origin. Omit it, together with `client`, to keep the hook dormant.    |
| `client` | Client from `createAmondClient({ url, headers, ... })` for custom auth or transport. Takes precedence over `url`. Memoize it, because a new instance replaces the session. |
| `live`   | Live stream mode. Defaults to `'sse'`; use `'long-poll'` to disable SSE.                                                                                                 |

```ts
interface UseAmondAgentResult {
  messages: AmondConversationMessage[]
  status: AgentStatus
  historyReady: boolean
  error: Error | undefined
  failedSends: FailedSend[]
  settlements: AmondConversationSettlement[]
  sendMessage(message: string, options?: SendMessageOptions): Promise<AgentSendResult>
  refresh(): void
}

type AgentStatus = 'idle' | 'connecting' | 'submitted' | 'streaming' | 'error'
```

| Status       | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `idle`       | Nothing is in flight and no failure is retained. A dormant hook is also `idle`.          |
| `connecting` | The hook is making its initial connection or retrying. `error` holds the latest failure. |
| `submitted`  | A local prompt is being admitted or awaits activity in the observed conversation.        |
| `streaming`  | A submission is active in the observed conversation, including out-of-band work.         |
| `error`      | The latest local submission failed, or a failed send is retained.                        |

### `sendMessage()`

`sendMessage()` adds an optimistic user message and delivers it. It resolves with the admission
receipt when the server admits the prompt, and does not wait for generation. The receipt carries the
`submissionId` to correlate with `settlements`. If admission fails, the optimistic message stays in
`failedSends` so the UI can offer a retry, and the promise rejects. Calling it on a dormant hook
rejects.

To make a retry safe, pass an `idempotencyKey`. Generate and persist the key before you call
`sendMessage()`, so it survives unmounts and reloads.

### `refresh()`

`refresh()` re-runs the history catch-up and resumes live updates. Call it when something outside
the browser, such as a webhook, creates the conversation.

## SSR and lifecycle

On the server, hooks return empty, idle snapshots and connect only after React commits in the
browser. React Strict Mode is supported. Changing `url`, `client`, or `live` replaces the current
session. Unmounting stops local observation but not server-side work.

## Re-exported types

`@amond-ai/agent-react` re-exports these SDK types: `AmondClient`, `AgentSendResult`,
`DeliveredAttachment`, `AmondConversationMessage`, `AmondConversationPart`,
`AmondConversationSettlement`, and `PromptUsage`.

## Attribution

Derived from [Flue](https://github.com/withastro/flue), licensed under Apache-2.0.
See `NOTICE`.
