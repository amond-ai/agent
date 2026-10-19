---
title: Channels
description: Receive verified provider events into agent conversations, and reply through the provider's own SDK.
lastReviewedAt: 2026-07-21
---

A **channel** connects an external provider — Slack, GitHub, Stripe — to your agents: verified HTTP ingress that authenticates each incoming delivery and hands your code the provider's native payload to route into agent conversations with [`dispatch(...)`](/docs/guide/building-agents/#dispatch). Channels are inbound-only; outbound provider calls stay in your application, written against the provider's own SDK. This guide covers adding a channel to a project, the channel module and its mount in `app.ts`, delivering provider events into conversations, reading those deliveries inside the agent, outbound behavior through provider SDKs, and the channel catalog.

## Adding a channel

amond ships no provider-specific channel packages. Every channel is built from scratch as project source by your coding agent, following a [blueprint](/docs/cli/add/) — a Markdown implementation guide rather than a package installer. Pass the provider's webhook documentation URL:

```sh
amond add channel https://api.slack.com/events-api
```

The guide walks the agent through the same shape every channel shares: verified ingress written as project code, the provider's own SDK for **outbound** calls your application makes, and narrow application-owned tools. For Slack the result is one new module, `src/channels/slack.ts`, exporting the configured `channel` and the SDK `client` (`@slack/web-api`), plus a mount in `app.ts` and a reply tool bound into the target agent. Every channel follows the same split: amond owns the route mounting and dispatch, your channel module owns verification, and outbound behavior stays in your application through the provider's established SDK ([below](#use-provider-sdks)).

Provider credentials are ordinary secrets — for Slack, `SLACK_SIGNING_SECRET` for inbound verification and `SLACK_BOT_TOKEN` for outbound calls. Supply them like any other secret; see [Provider credentials](/docs/guide/models/#provider-credentials).

## The channel module

A channel module declares one route per protocol surface. Each handler verifies the request against the provider's secret, answers protocol handshakes such as Slack's URL verification itself, and dispatches into an agent only for authenticated deliveries. Handlers receive the Hono context `c`:

```ts title="src/channels/slack.ts"
import { dispatch } from '@amond-ai/agent';
import type { Handler } from 'hono';
import { Assistant } from '../agents/assistant.ts';
import { verifySlackSignature } from './slack-signature.ts';

const events: Handler = async (c) => {
  // Verify against the exact raw bytes before parsing anything.
  const rawBody = await c.req.text();
  if (!(await verifySlackSignature(c.req.raw.headers, rawBody, process.env.SLACK_SIGNING_SECRET!))) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const payload = JSON.parse(rawBody);
  if (payload.type === 'url_verification') return c.json({ challenge: payload.challenge });
  if (payload.type !== 'event_callback') return c.body(null, 200);
  if (payload.event.type !== 'app_mention') return c.body(null, 200);

  const event = payload.event;
  const thread = {
    teamId: payload.team_id,
    channelId: event.channel,
    threadTs: event.thread_ts ?? event.ts,
  };

  await dispatch(Assistant, {
    id: `slack:v1:${thread.teamId}:${thread.channelId}:${thread.threadTs}`,
    // Slack redelivers events whose acknowledgement was slow or lost; the
    // event id names the delivery, so a retry never runs a second turn.
    idempotencyKey: payload.event_id,
    // Recorded once, when this delivery creates the conversation.
    initialData: {
      channelId: thread.channelId,
      threadTs: thread.threadTs,
      startedBy: event.user,
    },
    message: {
      kind: 'signal',
      type: 'slack.app_mention',
      body: event.text,
      attributes: { eventId: payload.event_id },
    },
  });
  return c.body(null, 200);
};

export const channel = {
  // Served at POST /channels/slack/events (with the mount below).
  routes: [{ method: 'POST', path: '/events', handler: events }],
};
```

`verifySlackSignature` is the application-owned verification helper the blueprint generates for the provider. The handler filters the events the application cares about, chooses the receiving conversation, and dispatches a normalized message. Everything in the `dispatch(...)` call is covered in [Delivering into a conversation](#delivering-into-a-conversation) below, except `idempotencyKey` — that is the redelivery convention, covered next.

Channels share a few conventions:

- **Routes are declared.** Each entry in `routes` publishes one method and path (`/events`, `/interactions`, …); omit a route and it does not exist. Most providers need a single `POST /webhook`.
- **Return the provider's expected acknowledgement.** A handler returns a Hono response; some surfaces (like Slack slash commands or Discord interactions) have a protocol that reads the acknowledgement body, so return exactly what the provider documents.
- **Acknowledge quickly.** `dispatch(...)` resolves as soon as the message is durably admitted — the agent runs asynchronously. Providers retry slow acknowledgements, so admit the work and return rather than awaiting agent output in the handler.
- **Deliveries can repeat.** Providers retry failed requests and may deliver an event more than once; channel handlers are stateless and do not deduplicate. Pass the provider's redelivery-stable id as the dispatch `idempotencyKey` — `idempotencyKey: payload.event_id` for Slack events — and a redelivered event converges on the original submission instead of running a second turn: same receipt (marked `deduplicated: true`), at most one answer. The key names the delivery, not the outcome, and reusing it with a different payload rejects with a 409 `submission_conflict`. Carrying the id in signal `attributes` as well keeps it visible for tracing.

## Mounting

A channel serves HTTP only where `app.ts` mounts it. Pass the channel's declared routes to `createChannelRouter(...)` from `@amond-ai/agent` — a pure, mountable sub-router serving the routes relative to the mount point:

```ts title="src/app.ts"
import { createChannelRouter } from '@amond-ai/agent';
import { channel as slack } from './channels/slack.ts';

app.route('/channels/slack', createChannelRouter(slack.routes));
// Slack's Events API endpoint is now POST /channels/slack/events
```

`/channels/<provider>` is a convention, not a requirement — the suffixes shift with whatever mount you choose, and the URL you register with the provider is the mount plus the suffix. The dispatch-target agent needs no mount of its own: the `'use agent'` directive registers it, and registration is all `dispatch(...)` requires. See [Dispatch-only agents](/docs/guide/routing/#dispatch-only-agents) in the Routing guide for how channel mounts sit alongside the rest of the route map.

Unlike agent mounts, channel routes need no additional authentication middleware for the provider traffic itself — verification against the provider's secret is the authentication, and it happens inside the channel handler before anything is dispatched.

## Delivering into a conversation

The `dispatch(...)` call in a channel handler makes three decisions: which conversation receives the event, what the message says, and what the conversation is about.

### The conversation id

Every delivery dispatched to the same `id` lands in the same durable conversation, so the id determines which events share history. For conversation-shaped providers — a Slack thread, a GitHub issue, a Teams chat — the natural mapping is one agent conversation per provider destination. Derive a canonical, collision-free id from the destination's identifying fields, as the handler above does:

```ts
const id = `slack:v1:${teamId}:${channelId}:${threadTs}`; // "slack:v1:T0123:C0456:1721760000.123456"
```

The id identifies the conversation; it does not authorize access to it — protect mounted conversations as described in [Protecting your agents](/docs/guide/routing/#protecting-your-agents). Avoid parsing destination fields back out of the id: prefer passing structured facts through `initialData` (below).

Event-feed providers — Stripe, Shopify, Notion, Resend — have no inherent conversation shape, so there is no destination to derive the id from. Choose the id from the event yourself: per customer, per order, per occurrence — the same choice a [schedule](/docs/guide/schedules/) makes.

### Signals

Channel deliveries are dispatched as `kind: 'signal'` messages, not `kind: 'user'`. A Slack thread or GitHub issue is a multi-participant surface the agent joins as one member — a `user` message would present every participant as the agent's own user, where a signal carries the event with its metadata intact:

- `type` — a namespaced event name you choose (`'slack.app_mention'`, `'github.issue_comment.created'`).
- `body` — the message content, a plain string.
- `attributes` — a string-to-string map of structured facts your verified handler attaches: sender, delivery id, resource identifiers.

Keep short-lived provider capabilities — interaction tokens, `response_url` values — out of the dispatched message: signals enter model context and durable history, and those values belong only in immediate request handling. The full message shape is [`DeliveredMessage`](/docs/reference/agent-api/#deliveredmessage) in the Agent API.

### Creation data

`initialData` is recorded once, when the dispatch creates the conversation, and ignored by every later send. It carries the facts that define what the conversation _is_ — the thread, the repository, the ticket — as opposed to what each message _says_. When the agent declares an `initialData` schema static, the value is validated at admission, so a creating dispatch that omits or malforms it fails instead of seeding a broken conversation. See [Passing data to the agent](/docs/guide/agent-hooks/#passing-data-to-the-agent).

## Reading deliveries in the agent

Two hooks read these inputs inside the agent: [`useInitialData()`](/docs/reference/agent-hooks-api/#useinitialdata) returns the creation data, and [`useDelivery()`](/docs/reference/agent-hooks-api/#usedelivery) returns the message currently in front of the model as the same `DeliveredMessage` the channel dispatched:

```ts title="src/agents/assistant.ts"
'use agent';
import { useDelivery, useInitialData, useModel, useTool } from '@amond-ai/agent';
import * as v from 'valibot';
import { replyInThread } from '../channels/slack.ts';

export function Assistant() {
  useModel('anthropic/claude-sonnet-4-6');

  const data = useInitialData<v.InferOutput<typeof Assistant.initialData>>();
  useTool(replyInThread(data));

  const delivery = useDelivery();
  const eventId = delivery.kind === 'signal' ? delivery.attributes?.eventId : undefined;

  return 'You participate in one Slack thread. Reply with the reply_in_slack_thread tool when a response is called for.';
}

Assistant.initialData = v.object({
  channelId: v.string(),
  threadTs: v.string(),
  startedBy: v.optional(v.string()),
});
```

Because the schema static is required here, a conversation cannot exist without valid creation data, and no `undefined` narrowing is needed. Both hooks give _code_ the same access the model has: the thread facts bind the reply tool without the model choosing a destination, and signal `attributes` carry identifiers your tools can trust because verified channel code attached them — the authorization pattern covered in [Protect access](/docs/guide/tools/#protect-access) in the Tools guide.

## Use provider SDKs

Channels are ingress-only: amond has no outbound messaging API, no reply routing, and no send-message abstraction over providers. Outbound behavior belongs to your application, written against the provider's own SDK — the blueprint installs one and exports a configured client from the channel module:

```ts title="src/channels/slack.ts"
import { WebClient } from '@slack/web-api';

export const client = new WebClient(process.env.SLACK_BOT_TOKEN);
```

Application code calls the client directly, with the provider's full documented surface. OAuth installation flows, token storage, and rotation are likewise application concerns, outside the channel module. To let the _model_ act on the provider, wrap exactly the actions the application needs as [tools](/docs/guide/tools/), binding the destination in trusted code:

```ts title="src/channels/slack.ts"
import { defineTool } from '@amond-ai/agent';
import * as v from 'valibot';

export function replyInThread(ref: { channelId: string; threadTs: string }) {
  return defineTool({
    name: 'reply_in_slack_thread',
    description: 'Reply in the Slack thread bound to this conversation.',
    input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
    async run({ data }) {
      const result = await client.chat.postMessage({
        channel: ref.channelId,
        thread_ts: ref.threadTs,
        text: data.text,
      });
      return { output: { ts: result.ts ?? null } };
    },
  });
}
```

The model selects the reply text; it cannot select the workspace, the thread, the credential, or the Web API method — those are fixed by the factory argument the agent supplied from its creation data. Avoid generic provider tools that expose arbitrary destinations or API methods unless the application has an explicit authorization design for them.

Because the SDK is the provider's own, everything it documents is available without waiting for framework support — Slack's assistant status and streaming-reply APIs, Octokit's full GitHub surface, Stripe's typed event handling — from tools, from [event hooks](/docs/guide/agent-hooks/#event-hooks), or from any other application code.

## Building a channel for any provider

amond does not publish per-provider channel packages. Pass a documentation URL and the channel blueprint guides your coding agent through the same shape for any provider — verified ingress as project source, the provider's SDK for outbound, narrow application-owned tools:

```sh
amond add channel https://developers.provider.example/webhooks
```

A channel is an object with declarative routes, so you can also write one by hand. `createChannelRouter(routes)` from `@amond-ai/agent` builds the mountable sub-router that serves them:

```ts title="src/channels/acme.ts"
import type { Handler } from 'hono';

const webhook: Handler = async (c) => {
  const rawBody = await c.req.text();
  // Verify the provider's signature against the raw bytes before parsing,
  // then dispatch into an agent exactly like the Slack channel above.
  return c.body(null, 200);
};

export const channel = {
  routes: [{ method: 'POST', path: '/webhook', handler: webhook }],
};
```

```ts title="src/app.ts"
import { createChannelRouter } from '@amond-ai/agent';
import { channel as acme } from './channels/acme.ts';

app.route('/channels/acme', createChannelRouter(acme.routes));
```

Verify signatures against the exact unconsumed request body, keep every route suffix a non-empty path beginning with `/`, and test both valid and invalid signatures along with the provider's protocol handshakes. Channels model verified HTTP delivery; long-lived sockets, polling loops, and provider-managed background transports stay in application-owned infrastructure.

## Next steps

- [Routing](/docs/guide/routing/) — the `app.ts` route map that channel mounts live in.
- [Agents](/docs/guide/building-agents/#dispatch) — `dispatch(...)`, receipts, and the other ways to reach an agent.
- [Tools](/docs/guide/tools/#protect-access) — binding trusted identifiers so the model can act without selecting destinations.
- [Agent API](/docs/reference/agent-api/) — `useDelivery()`, `useInitialData()`, and the `DeliveredMessage` shape.
- [`amond add`](/docs/cli/add/) — fetching the channel blueprint for your provider.
