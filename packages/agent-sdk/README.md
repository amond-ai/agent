# @amond-ai/agent-sdk

The client SDK for talking to deployed amond agents. One client addresses one conversation by URL:
the mount URL of the agent's routes plus a conversation id you choose.

```sh
npm install @amond-ai/agent-sdk
```

```ts
import { createAmondClient } from '@amond-ai/agent-sdk'

const client = createAmondClient({ url: 'https://example.com/agents/triage/ticket-4821' })

const admission = await client.send({
  message: { kind: 'user', body: 'The login page returns a 500.' },
})
const reply = await client.read(admission)
```

## Client methods

- `send()` — start a message delivery and resolve when the server admits it.
- `wait()` and `read()` — wait for a submission to settle and read its reply.
- `observe()` — follow the materialized conversation live.
- `history()` and `historyBefore()` — read conversation history.
- `abort()` — abort the running submission.

`send()` accepts an `idempotencyKey`, so a retry after a network failure converges on the original
submission instead of admitting a duplicate.

## Other exports

- `AmondApiError` and `AmondExecutionError` for failed requests and failed submissions.
- Conversation types such as `AmondConversationMessage` and `AmondConversationSettlement`.
- `readSubmissionReply` for reading a reply from an already-held conversation.

For React apps, use [`@amond-ai/agent-react`](../agent-react), which builds on this package.

## Attribution

Derived from [Flue](https://github.com/withastro/flue), licensed under Apache-2.0.
See `NOTICE`.
