export type { BackoffOptions, LiveMode } from '@durable-streams/client'
// Stream errors surfaced by observation/wait iteration. These classes are
// owned by @durable-streams/client; only the ones reachable through SDK reads
// are re-exported.
export {
  DurableStreamError,
  FetchBackoffAbortError,
  FetchError,
  StreamClosedError,
} from '@durable-streams/client'
export type {
  AgentAbortResult,
  AmondClient,
  CreateAmondClientOptions,
  HttpClientOptions,
  RequestHeaders,
} from './client.ts'
export { createAmondClient } from './client.ts'
export { AmondApiError } from './http.ts'
export type {
  AmondConversationHistoryBeforeOptions,
  AmondConversationHistoryOptions,
  AmondConversationHistoryPage,
  AmondConversationMessage,
  AmondConversationPart,
  AmondConversationSettlement,
  AmondConversationSnapshot,
  AmondConversationState,
} from './public/conversation.ts'
// The conversation `updates` wire union is not stable application API, but
// first-party presenters (the CLI) reduce it directly, so the type is
// exported for them. Application code should consume materialized
// `AmondConversationState` via `observe()` rather than handling chunks.
export type { ConversationStreamChunk } from './public/conversation-stream.ts'
export type {
  AgentConversationObservation,
  AgentConversationObservationPhase,
  AgentConversationObservationSnapshot,
  AgentConversationObserveOptions,
  ConversationLiveMode,
} from './public/observe.ts'
export type { AgentReadOptions, AgentReadResult } from './public/read.ts'
export { type AgentSubmissionReply, readSubmissionReply } from './public/reply.ts'
export type {
  AgentPromptOptions,
  AgentSendResult,
  DeliveredAttachment,
  DeliveredDocumentAttachment,
  DeliveredImageAttachment,
  DeliveredMessage,
} from './public/send.ts'
export {
  type AgentWaitOptions,
  AmondExecutionError,
  type AmondExecutionFailure,
  type AmondExecutionTarget,
} from './public/settle.ts'
export type { AmondEventStream, AmondStreamOptions } from './public/stream.ts'
export type { PromptUsage } from './types.ts'
