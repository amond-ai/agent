/// <reference path="../types/skill-md.d.ts" />
/// <reference path="../types/markdown-md.d.ts" />

export { ToolTimeoutError } from './abort.ts'
// The standard model-facing tools, one factory per tool. Compose them in a
// SandboxFactory's `tools` list to add, drop, or swap tools without
// rebuilding the set; omit `tools` entirely for the framework default.
export {
  createBashTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from './agent.ts'
export {
  type AgentHandleDispatchRequest,
  type AgentInstanceHandle,
  type AgentReadOptions,
  type AgentReply,
  AgentRunError,
  init,
  type InitOptions,
} from './agent-client.ts'
// The live conversation projection protocol (`init().read`'s onEvent, the
// SDK's updates view). The canonical record schema stays internal.
export type { ConversationStreamChunk } from './conversation-public.ts'
export {
  AgentInstanceExistsError,
  AgentInstanceNotFoundError,
  AmondError,
  AttachmentNotAvailableError,
  DelegationDepthExceededError,
  FileNotFoundError,
  InstrumentationAlreadyInstalledError,
  OperationFailedError,
  SandboxDiedError,
  SandboxOperationUnsupportedError,
  SessionBusyError,
  SessionNotFoundError,
  SkillDefinitionValidationError,
  SkillNotRegisteredError,
  SubagentNotDeclaredError,
  SubmissionAbortedError,
  SubmissionConflictError,
  SubmissionInterruptedError,
  SubmissionRetryExhaustedError,
  SubmissionTimeoutError,
  ToolInputValidationError,
  ToolNameConflictError,
  ToolOutputSerializationError,
  ToolOutputValidationError,
  type ToolValidationIssue,
  type ValidationIssue,
} from './errors.ts'
export { IMAGE_DATA_OMITTED } from './event-redaction.ts'
export type {
  AmondExecutionContext,
  AmondExecutionInterceptor,
  AmondExecutionOperation,
} from './execution-interceptor.ts'
export { useAgentFinish } from './hooks/use-agent-finish.ts'
export { useAgentStart } from './hooks/use-agent-start.ts'
export { useDataWriter } from './hooks/use-data-writer.ts'
export { useDelivery } from './hooks/use-delivery.ts'
export { useDispatchMessage } from './hooks/use-dispatch-message.ts'
export { useInitialData } from './hooks/use-initial-data.ts'
export { useInstruction } from './hooks/use-instruction.ts'
export { defineMcpConnection, useMcpConnection } from './hooks/use-mcp-connection.ts'
export { useModel, type UseModelOptions } from './hooks/use-model.ts'
export { type StateSetter, usePersistentState } from './hooks/use-persistent-state.ts'
export { useResponseFinish } from './hooks/use-response-finish.ts'
export { useResponseStart } from './hooks/use-response-start.ts'
export { useSandbox, type UseSandboxOptions } from './hooks/use-sandbox.ts'
export { useSkill } from './hooks/use-skill.ts'
export { defineSubagent, GeneralSubagent, useSubagent } from './hooks/use-subagent.ts'
export { useTool } from './hooks/use-tool.ts'
export { type AmondInstrumentation, instrument } from './instrumentation.ts'
export type { JsonValue } from './json-snapshot.ts'
export type {
  McpAuth,
  McpConnection,
  McpConnectionDefinition,
  McpToolAnnotations,
  McpTransport,
} from './mcp.ts'
export { createMcpConnection } from './mcp.ts'
export type {
  AgentAppendMessage,
  AgentFinishContext,
  AgentResponseToolCall,
  AgentSignalAppend,
  AgentStartContext,
  ResponseFinishContext,
  ResponseMetadataCallback,
  ResponseStartContext,
} from './message-output.ts'
export type { AmondObservationSubscriber } from './observation.ts'
export { ResultUnavailableError } from './result.ts'
export type { ChannelRouteDefinition } from './runtime/channel-routes.ts'
export { createChannelRouter } from './runtime/channel-routes.ts'
export { type AmondEventSubscriber, observe } from './runtime/events.ts'
export { type AgentInstanceInfo, dispatch, getAgentInstance } from './runtime/amond-app.ts'
export { isDynamicModel, setProvider } from './runtime/providers.ts'
export type { AgentIdentityBinding } from './runtime/registration.ts'
export { __amondBindAgentModule } from './runtime/registration.ts'
export {
  bash,
  // Deprecated alias for sandboxFromDriver.
  createSandboxSessionEnv,
  type OrphanedExecSettlement,
  // Deprecated alias for SandboxDriver.
  type SandboxApi,
  type SandboxDriver,
  sandboxFromDriver,
} from './sandbox.ts'
export { defineSkill } from './skill-definition.ts'
export { defineTool } from './tool.ts'
export type {
  Agent,
  AgentDispatchRequest,
  AgentFunction,
  AgentProps,
  AgentRuntimeConfig,
  AgentStatics,
  AmondEvent,
  AmondEventContext,
  AmondFs,
  AmondHarness,
  AmondLogger,
  AmondObservation,
  AttachedAgentEvent,
  BashFactory,
  BashLike,
  CallHandle,
  CompactionConfig,
  DeliveredAttachment,
  DeliveredMessage,
  DeliveredMessageInput,
  DispatchReceipt,
  DurabilityConfig,
  FileStat,
  LlmAssistantMessage,
  LlmImageContent,
  LlmMessage,
  LlmTextContent,
  LlmThinkingContent,
  LlmTool,
  LlmToolCall,
  LlmToolResultMessage,
  LlmTurnPurpose,
  LlmUserMessage,
  ModelRequest,
  ModelRequestInfo,
  ModelRequestInput,
  ModelResponse,
  PackagedSkillDirectory,
  PackagedSkillFile,
  PromptDocument,
  PromptImage,
  PromptModel,
  PromptOptions,
  PromptResponse,
  PromptResultResponse,
  PromptUsage,
  Sandbox,
  SandboxFactory,
  SandboxRunOptions,
  SandboxToolFactory,
  SandboxToolFactoryOptions,
  // Deprecated aliases for Sandbox, SandboxToolFactory, and
  // SandboxToolFactoryOptions.
  SessionEnv,
  SessionToolFactory,
  SessionToolFactoryOptions,
  ShellOptions,
  ShellResult,
  Skill,
  SkillDefinition,
  SkillOptions,
  SkillReference,
  SubagentDefinition,
  TaskOptions,
  ThinkingLevel,
  ToolContext,
  ToolDefinition,
  ToolInput,
  ToolInputSchema,
  ToolOutput,
  ToolOutputSchema,
  ToolRunEnvelope,
  ToolStep,
} from './types.ts'

// Note: the `Fetchable` interface for user-authored `app.ts` entries lives at
// `@amond-ai/agent/routing`, not on the root barrel.
//
// Note: createAmondContext, bashFactoryToSandbox, and the
// AmondContextConfig/AmondContextInternal types are intentionally NOT re-exported
// here. They are internal runtime helpers consumed exclusively by the generated
// server entry point — see `@amond-ai/agent/internal`. User agent code should not
// need to import any of them directly.
//
// Note: `build`, `dev`, and the build/dev/env helpers live in `amond`,
// not this barrel — import them from there if you're driving the build
// programmatically.
