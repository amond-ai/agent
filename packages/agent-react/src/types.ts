// amond's conversation message types are owned by @amond-ai/agent-sdk and consumed
// directly here — React adds optimistic/local state but does not reinterpret
// canonical part semantics.
export type {
  AmondConversationMessage,
  AmondConversationPart,
  AmondConversationSettlement,
} from '@amond-ai/agent-sdk'
