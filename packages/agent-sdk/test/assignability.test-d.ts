import type { FlueEvent as RuntimeFlueEvent, PromptResponse as RuntimePromptResponse } from '@flue/runtime';
import type { AgentPromptResponse, FlueEvent as SdkFlueEvent } from '../src/index.ts';

// `turn_request` is in-process only (`observe()` subscribers and exporters);
// it is never persisted to durable streams or served over HTTP, so the SDK
// wire union deliberately omits it.
const _: SdkFlueEvent = {} as Exclude<RuntimeFlueEvent, { type: 'turn_request' }>;
void _;

// Direct-agent prompts (`?wait=result`) always resolve with the runtime
// `PromptResponse`; the SDK duplicates the shape so it must stay assignable.
const _prompt: AgentPromptResponse = {} as RuntimePromptResponse;
void _prompt;
