import { ulid } from 'ulidx';

function generateRunNonce(): string {
	return ulid();
}

export function generateWorkflowRunId(workflowName: string): string {
	if (!workflowName || workflowName.includes(':')) {
		throw new Error(
			'[flue] Workflow names used in run ids must be non-empty and must not contain ":".',
		);
	}
	return `workflow:${workflowName}:${generateRunNonce()}`;
}

export function generateSessionAffinityKey(): string {
	return `aff_${ulid()}`;
}

export function generateOperationId(): string {
	return `op_${ulid()}`;
}

export function generateTurnId(): string {
	return `turn_${ulid()}`;
}
