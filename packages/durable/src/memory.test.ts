import type { SessionEvent, StepOutcome } from './index'
import { describe, expect, it } from 'vitest'
import { createMemoryRuntime } from './memory'

interface Counted { count: number, saw?: string }

/** A step that waits once for `approval`, then finishes — the shape of a deferred tool turn. */
function awaitsApproval() {
  return async (state: Counted, event?: SessionEvent): Promise<StepOutcome<Counted>> => {
    if (event) {
      return { kind: 'done', state: { ...state, saw: String(event.payload) } }
    }
    return { kind: 'wait', state: { ...state, count: state.count + 1 }, event: 'approval' }
  }
}

describe('the in-memory durable runtime', () => {
  it('stops at a wait and names what it is waiting on', async () => {
    const runtime = createMemoryRuntime()

    const record = await runtime.start({
      id: 'session-1',
      initialState: { count: 0 } satisfies Counted,
      step: awaitsApproval(),
    })

    expect(record.status).toBe('waiting')
    expect(record.waitingOn).toBe('approval')
    expect(record.state.count).toBe(1)
  })

  it('delivers the resume event to the step exactly once', async () => {
    const runtime = createMemoryRuntime()
    const seen: (string | undefined)[] = []

    await runtime.start({
      id: 'session-2',
      initialState: { count: 0 } satisfies Counted,
      step: async (state: Counted, event?: SessionEvent) => {
        seen.push(event?.name)
        return event
          ? { kind: 'done', state }
          : { kind: 'wait', state, event: 'approval' }
      },
    })

    const resumed = await runtime.resume<Counted>('session-2', {
      name: 'approval',
      payload: 'granted',
    })

    expect(resumed.status).toBe('done')
    expect(resumed.state.saw).toBe(undefined)
    expect(seen).toEqual([undefined, 'approval'])
  })

  it('carries the event payload into the resumed state', async () => {
    const runtime = createMemoryRuntime()
    await runtime.start({
      id: 'session-3',
      initialState: { count: 0 } satisfies Counted,
      step: awaitsApproval(),
    })

    const resumed = await runtime.resume<Counted>('session-3', {
      name: 'approval',
      payload: 'granted',
    })

    expect(resumed.state.saw).toBe('granted')
  })

  it('ignores an event the session is not waiting on', async () => {
    const runtime = createMemoryRuntime()
    await runtime.start({
      id: 'session-4',
      initialState: { count: 0 } satisfies Counted,
      step: awaitsApproval(),
    })

    const resumed = await runtime.resume<Counted>('session-4', {
      name: 'something-else',
      payload: 'ignored',
    })

    expect(resumed.status).toBe('waiting')
    expect(resumed.waitingOn).toBe('approval')
  })

  it('treats a repeated start of the same id as the same session', async () => {
    const runtime = createMemoryRuntime()
    const spec = {
      id: 'session-5',
      initialState: { count: 0 } satisfies Counted,
      step: awaitsApproval(),
    }

    const first = await runtime.start(spec)
    const second = await runtime.start(spec)

    expect(second.state.count).toBe(first.state.count)
    expect(second.updatedAt).toBe(first.updatedAt)
  })

  it('settles as failed when a step throws, keeping the state it entered with', async () => {
    const runtime = createMemoryRuntime()

    const record = await runtime.start({
      id: 'session-6',
      initialState: { count: 7 } satisfies Counted,
      step: async () => {
        throw new Error('sandbox died')
      },
    })

    expect(record.status).toBe('failed')
    expect(record.error).toContain('sandbox died')
    expect(record.state.count).toBe(7)
  })

  it('rejects a resume of a session it never started', async () => {
    const runtime = createMemoryRuntime()

    await expect(
      runtime.resume('never-started', { name: 'approval', payload: null }),
    ).rejects.toThrow('unknown session')
  })
})
