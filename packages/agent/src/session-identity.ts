const TASK_SESSION_PREFIX = 'task:';
const ACTION_SCOPE_PREFIX = 'action:';
const SESSION_STORAGE_PREFIX = 'agent-session:';

interface SessionStorageIdentity {
	instanceId: string;
	harness: string;
	session: string;
}

function isTaskSessionName(name: string): boolean {
	return name.startsWith(TASK_SESSION_PREFIX);
}

export function assertPublicSessionName(name: string): void {
	if (isTaskSessionName(name)) {
		throw new Error(
			'[flue] Session names beginning with "task:" are reserved for delegated tasks.',
		);
	}
	if (name.startsWith(ACTION_SCOPE_PREFIX)) {
		throw new Error('[flue] Session names beginning with "action:" are reserved for Actions.');
	}
}

export function createTaskSessionName(parentSession: string, taskId: string): string {
	return `${TASK_SESSION_PREFIX}${parentSession}:${taskId}`;
}

export function createSessionStorageKey(
	instanceId: string,
	harness: string,
	session: string,
): string {
	return `${SESSION_STORAGE_PREFIX}${JSON.stringify([instanceId, harness, session])}`;
}

export function createActionScopeName(invocationId: string): string {
	return `${ACTION_SCOPE_PREFIX}${invocationId}`;
}

export function childActionSessionStorageKey(
	parentStorageKey: string,
	action: unknown,
): string | undefined {
	if (!action || typeof action !== 'object') return undefined;
	const { invocationId, session, scope } = action as {
		invocationId?: unknown;
		session?: unknown;
		scope?: unknown;
	};
	if (
		typeof invocationId !== 'string' ||
		typeof session !== 'string' ||
		typeof scope !== 'string' ||
		scope !== createActionScopeName(invocationId)
	) {
		return undefined;
	}
	const parent = parseSessionStorageKey(parentStorageKey);
	if (!parent) return undefined;
	return createSessionStorageKey(parent.instanceId, `${parent.harness}:${scope}`, session);
}

export function childTaskSessionStorageKey(
	parentStorageKey: string,
	task: unknown,
): string | undefined {
	if (!task || typeof task !== 'object') return undefined;
	const { session, taskId } = task as { session?: unknown; taskId?: unknown };
	if (typeof session !== 'string' || typeof taskId !== 'string') return undefined;
	const parent = parseSessionStorageKey(parentStorageKey);
	if (!parent || session !== createTaskSessionName(parent.session, taskId)) return undefined;
	return createSessionStorageKey(parent.instanceId, parent.harness, session);
}

function parseSessionStorageKey(storageKey: string): SessionStorageIdentity | undefined {
	if (!storageKey.startsWith(SESSION_STORAGE_PREFIX)) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(storageKey.slice(SESSION_STORAGE_PREFIX.length));
	} catch {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		value.some((part) => typeof part !== 'string')
	) {
		return undefined;
	}
	return { instanceId: value[0], harness: value[1], session: value[2] };
}
