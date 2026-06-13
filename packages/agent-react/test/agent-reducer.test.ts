import type { AttachedAgentEvent, LlmMessage } from '@flue/sdk';
import { describe, expect, it } from 'vitest';
import { emptyAgentState, reduceAgentEvent } from '../src/agent-reducer.ts';

const base = {
	v: 1 as const,
	instanceId: 'instance-1',
	timestamp: '2026-06-12T00:00:00.000Z',
};

function snapshot(
	type: 'message_start' | 'message_update' | 'message_end',
	message: LlmMessage,
	extra: Partial<AttachedAgentEvent & { submissionId?: string }> = {},
): AttachedAgentEvent & { submissionId?: string } {
	return { ...base, type, message, eventIndex: 1, ...extra } as AttachedAgentEvent & {
		submissionId?: string;
	};
}

describe('reduceAgentEvent()', () => {
	it('uses message snapshots and ignores paired deltas when streaming text', () => {
		const started = reduceAgentEvent(
		emptyAgentState,
		snapshot('message_start', { role: 'assistant', content: [] }, { turnId: 'turn-1' }),
		);
		const delta = reduceAgentEvent(started, {
			...base,
			type: 'text_delta',
			text: 'ignored',
			eventIndex: 2,
			turnId: 'turn-1',
		});
		const updated = reduceAgentEvent(
			delta,
			snapshot(
				'message_update',
				{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
				{ eventIndex: 3, turnId: 'turn-1' },
			),
		);

		expect(delta).toBe(started);
		expect(updated.messages).toEqual([
			{
				id: 'turn:turn-1',
				role: 'assistant',
				metadata: undefined,
				parts: [{ type: 'text', text: 'hello', state: 'streaming' }],
			},
		]);
	});

	it('is idempotent when a snapshot is redelivered', () => {
		const event = snapshot(
			'message_end',
			{ role: 'assistant', content: [{ type: 'text', text: 'done' }] },
			{ turnId: 'turn-1' },
		);
		const once = reduceAgentEvent(emptyAgentState, event);
		const twice = reduceAgentEvent(once, event);

		expect(twice.messages).toHaveLength(1);
		expect(twice.messages).toEqual(once.messages);
	});

	it('establishes deterministic messages from a truncated update window', () => {
		const state = reduceAgentEvent(
			emptyAgentState,
			snapshot(
				'message_update',
				{ role: 'assistant', content: [{ type: 'text', text: 'partial' }] },
				{ turnId: 'turn-9', eventIndex: 40 },
			),
		);

		expect(state.messages[0]?.id).toBe('turn:turn-9');
	});

	it('reconciles tools while preserving results across final snapshots', () => {
		const message = {
			role: 'assistant' as const,
			content: [{ type: 'toolCall' as const, id: 'tool-1', name: 'search', arguments: { q: 'flue' } }],
		};
		let state = reduceAgentEvent(
			emptyAgentState,
			snapshot('message_update', message, { turnId: 'turn-1' }),
		);
		state = reduceAgentEvent(state, {
			...base,
			type: 'tool',
			toolName: 'search',
			toolCallId: 'tool-1',
			isError: false,
			result: ['result'],
			durationMs: 1,
			eventIndex: 2,
		});
		state = reduceAgentEvent(state, snapshot('message_end', message, { turnId: 'turn-1' }));

		expect(state.messages[0]?.parts[0]).toMatchObject({
			type: 'dynamic-tool',
			state: 'output-available',
			output: ['result'],
		});
	});

	it('reconciles receipt-before-echo without matching message text', () => {
		let state = reduceAgentEvent(emptyAgentState, {
			type: 'local_send_submitted',
			localId: 'local-1',
			message: 'same',
		});
		state = reduceAgentEvent(state, {
			type: 'local_send_admitted',
			localId: 'local-1',
			submissionId: 'submission-1',
		});
		state = reduceAgentEvent(
			state,
			snapshot(
				'message_end',
				{ role: 'user', content: 'same' },
				{ submissionId: 'submission-1' },
			),
		);

		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]?.id).toBe('submission:submission-1:user:0');
	});

	it('reconciles echo-before-receipt by dropping the optimistic duplicate', () => {
		let state = reduceAgentEvent(emptyAgentState, {
			type: 'local_send_submitted',
			localId: 'local-1',
			message: 'hello',
		});
		state = reduceAgentEvent(
			state,
			snapshot(
				'message_end',
				{ role: 'user', content: 'hello' },
				{ submissionId: 'submission-1' },
			),
		);
		expect(state.messages).toHaveLength(2);
		state = reduceAgentEvent(state, {
			type: 'local_send_admitted',
			localId: 'local-1',
			submissionId: 'submission-1',
		});

		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]?.id).toBe('submission:submission-1:user:0');
	});

	it('keeps another local submission pending when one submission becomes idle', () => {
		let state = reduceAgentEvent(emptyAgentState, {
			type: 'local_send_submitted',
			localId: 'local-1',
			message: 'first',
		});
		state = reduceAgentEvent(state, {
			type: 'local_send_admitted',
			localId: 'local-1',
			submissionId: 'submission-1',
		});
		state = reduceAgentEvent(state, {
			type: 'local_send_submitted',
			localId: 'local-2',
			message: 'second',
		});
		state = reduceAgentEvent(state, {
			type: 'idle',
			eventIndex: 10,
			timestamp: base.timestamp,
			v: 1,
			instanceId: base.instanceId,
			submissionId: 'submission-1',
		});

		expect(state.status).toBe('submitted');
		expect(state.pendingSends).toEqual([{ localId: 'local-2' }]);
	});

	it('reconciles assistant activity that arrives before admission', () => {
		let state = reduceAgentEvent(emptyAgentState, {
			type: 'local_send_submitted',
			localId: 'local-1',
			message: 'hello',
		});
		state = reduceAgentEvent(
			state,
			snapshot(
				'message_update',
				{ role: 'assistant', content: [{ type: 'text', text: 'working' }] },
				{ submissionId: 'submission-1', turnId: 'turn-1' },
			),
		);
		state = reduceAgentEvent(state, {
			type: 'local_send_admitted',
			localId: 'local-1',
			submissionId: 'submission-1',
		});

		expect(state.status).toBe('streaming');
	});

	it('removes optimistic content when admission fails', () => {
		let state = reduceAgentEvent(emptyAgentState, {
			type: 'local_send_submitted',
			localId: 'local-1',
			message: 'hello',
		});
		state = reduceAgentEvent(state, {
			type: 'local_send_failed',
			localId: 'local-1',
			error: new Error('offline'),
		});

		expect(state.messages).toEqual([]);
		expect(state.status).toBe('error');
		expect(state.error?.message).toBe('offline');
	});
});
