import type {
  DurableRuntime,
  SessionEvent,
  SessionRecord,
  SessionStep,
  StartSpec,
} from './index'

/**
 * The in-memory runtime — the reference implementation, the test double, and what `amond dev`
 * runs. It is a first-class implementation rather than a mock: the local loop and the deployed
 * one differ in where state lives, not in what the contract means.
 *
 * State is lost when the process exits. That is the one thing it does not promise.
 */
export function createMemoryRuntime(): DurableRuntime {
  const records = new Map<string, SessionRecord<unknown>>()
  const steps = new Map<string, SessionStep<unknown>>()

  async function drive<TState>(
    id: string,
    state: TState,
    event?: SessionEvent,
  ): Promise<SessionRecord<TState>> {
    const step = steps.get(id) as SessionStep<TState> | undefined
    if (!step) {
      throw new Error(`no step registered for session ${id}`)
    }

    let current = state
    // Delivered once: the event belongs to the resume that woke this loop, not to the steps
    // that follow it.
    let pending = event
    for (;;) {
      let outcome
      try {
        outcome = await step(current, pending)
        pending = undefined
      }
      catch (cause) {
        return settle(id, { status: 'failed', state: current, error: String(cause) })
      }

      current = outcome.state
      if (outcome.kind === 'continue') {
        continue
      }
      return outcome.kind === 'wait'
        ? settle(id, { status: 'waiting', state: current, waitingOn: outcome.event })
        : settle(id, { status: 'done', state: current })
    }
  }

  function settle<TState>(
    id: string,
    next: Omit<SessionRecord<TState>, 'id' | 'updatedAt'>,
  ): SessionRecord<TState> {
    const record = { ...next, id, updatedAt: Date.now() } satisfies SessionRecord<TState>
    records.set(id, record as SessionRecord<unknown>)
    return record
  }

  return {
    async start<TState>(spec: StartSpec<TState>) {
      if (records.has(spec.id)) {
        return records.get(spec.id) as SessionRecord<TState>
      }
      steps.set(spec.id, spec.step as SessionStep<unknown>)
      return drive(spec.id, spec.initialState)
    },

    async resume<TState>(id: string, event: SessionEvent) {
      const record = records.get(id) as SessionRecord<TState> | undefined
      if (!record) {
        throw new Error(`unknown session ${id}`)
      }
      if (record.status !== 'waiting') {
        return record
      }
      if (record.waitingOn !== event.name) {
        return record
      }
      return drive(id, record.state, event)
    },

    async get<TState>(id: string) {
      return records.get(id) as SessionRecord<TState> | undefined
    },
  }
}
