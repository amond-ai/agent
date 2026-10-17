/**
 * Attribute keys for the native Cloudflare tracing adapter.
 *
 * `gen_ai.*` keys follow the OpenTelemetry GenAI semantic conventions where
 * they exist (Development status — centralizing them here keeps spec churn a
 * one-file edit; none of these constants are exported from the package). The
 * key set deliberately mirrors an OpenTelemetry adapter's projection so an amond
 * agent reads the same across OTel backends and the Cloudflare dashboard —
 * restricted to the scalar subset Workers `Span.setAttribute` accepts
 * (array-typed keys like `gen_ai.response.finish_reasons` are omitted rather
 * than JSON-encoded under an array-typed name).
 *
 * amond-specific keys live under `amond.*`. The `cloudflare.agents.*` namespace
 * belongs to Cloudflare's agents SDK and is not emitted here.
 */
export const ATTR = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  responseId: 'gen_ai.response.id',
  conversationId: 'gen_ai.conversation.id',
  compacted: 'gen_ai.conversation.compacted',
  agentName: 'gen_ai.agent.name',
  requestStream: 'gen_ai.request.stream',
  reasoningLevel: 'gen_ai.request.reasoning.level',
  maxTokens: 'gen_ai.request.max_tokens',
  temperature: 'gen_ai.request.temperature',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
  cacheReadTokens: 'gen_ai.usage.cache_read.input_tokens',
  cacheCreationTokens: 'gen_ai.usage.cache_creation.input_tokens',
  toolName: 'gen_ai.tool.name',
  toolCallId: 'gen_ai.tool.call.id',
  toolType: 'gen_ai.tool.type',
  errorType: 'error.type',
  serverAddress: 'server.address',
  serverPort: 'server.port',
  openaiApiType: 'openai.api.type',
} as const

export const AMOND_ATTR = {
  /**
   * The agent instance id, same key an OpenTelemetry adapter uses. Deliberately
   * not `gen_ai.agent.id`: the semconv reserves that for hosted-agent
   * identifiers on the *client* invoke_agent variant (and recommends against
   * in-memory instance ids); amond's agent spans are the in-process variant.
   */
  instanceId: 'amond.instance.id',
  submissionId: 'amond.submission.id',
  operationId: 'amond.operation.id',
  operationKind: 'amond.operation.kind',
  turnId: 'amond.turn.id',
  taskId: 'amond.task.id',
  toolOrigin: 'amond.tool.origin',
  turnPurpose: 'amond.turn.purpose',
  finishReason: 'amond.response.finish_reason',
  usageTotalTokens: 'amond.usage.total_tokens',
  /** Recognized cancellation — a control path, never counted as an error. */
  canceled: 'amond.canceled',
  /**
   * Stamped on spans the adapter force-closes because their terminal event
   * never arrived (value names the close path, e.g. `settlement`). Absent on
   * every normally-closed span, so backends can measure lost primary closes.
   */
  forcedClose: 'amond.span.forced_close',
  recoveryOperation: 'amond.recovery.operation',
  recoveryOutcome: 'amond.recovery.outcome',
  /** Phase of an `amond.coordinator` span; new phases extend this, not the span name. */
  coordinatorPhase: 'amond.coordinator.phase',
} as const
