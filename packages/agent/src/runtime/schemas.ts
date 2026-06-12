import * as v from 'valibot';

export const MAX_IMAGE_DATA_LENGTH = 14 * 1024 * 1024;

const DirectAgentImageSchema = v.object({
	type: v.literal('image'),
	data: v.pipe(
		v.string(),
		v.maxLength(
			MAX_IMAGE_DATA_LENGTH,
			`Image data exceeds the ${MAX_IMAGE_DATA_LENGTH} character limit.`,
		),
	),
	mimeType: v.string(),
});

export const DirectAgentPayloadSchema = v.object({
	message: v.string(),
	images: v.optional(v.array(DirectAgentImageSchema)),
});

export const ErrorEnvelopeSchema = v.object({
	error: v.object({
		type: v.string(),
		message: v.string(),
		details: v.string(),
		dev: v.optional(v.string()),
		meta: v.optional(v.record(v.string(), v.unknown())),
	}),
});

export const AgentInvocationResponseSchema = v.object({
	result: v.unknown(),
	streamUrl: v.string(),
	offset: v.string(),
});

export const WorkflowInvocationResponseSchema = v.object({
	result: v.unknown(),
	_meta: v.object({ runId: v.string() }),
});

export const WorkflowAdmissionResponseSchema = v.object({
	status: v.literal('accepted'),
	runId: v.string(),
});

export const WorkflowRouteParamSchema = v.object({ name: v.string() });
export const WorkflowInvocationQuerySchema = v.object({
	wait: v.optional(v.literal('result')),
});
export const AgentRouteParamSchema = v.object({ name: v.string(), id: v.string() });
