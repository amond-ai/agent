/**
 * The durable execution contract an agent session runs against.
 *
 * Deliberately narrower than any platform's workflow surface: it says what an agent session
 * needs — start, wait, resume, settle — and nothing about how a platform provides it. See
 * ADR-0002 for why the contract is owned here rather than borrowed from Cloudflare Workflows
 * or the Vercel Workflow SDK.
 */

/** Where a session is in its life. A session is `waiting` only while `waitingOn` is set. */
export type SessionStatus = 'running' | 'waiting' | 'done' | 'failed'

/** What an adapter stores and returns. `state` is the agent's own resumable state. */
export interface SessionRecord<TState = unknown> {
  readonly id: string
  readonly status: SessionStatus
  readonly state: TState
  /** The event name this session resumes on, set only while `status` is `waiting`. */
  readonly waitingOn?: string
  /** Epoch milliseconds of the last transition. */
  readonly updatedAt: number
  /** Present only when `status` is `failed`. Already redacted by the caller. */
  readonly error?: string
}

/** An event delivered to a waiting session. */
export interface SessionEvent<TPayload = unknown> {
  readonly name: string
  readonly payload: TPayload
}

/**
 * One step of an agent's turn. The runtime calls it with the state it stored, and stores
 * whatever comes back — so a step must be resumable from its input alone.
 *
 * `event` is present only on the first call after a `resume`, carrying what the session was
 * waiting for. Every subsequent call in the same drive loop passes undefined, so a step cannot
 * mistake a replay for a second delivery.
 */
export type SessionStep<TState> = (
  state: TState,
  event?: SessionEvent,
) => Promise<StepOutcome<TState>>

/** What a step asks the runtime to do next. */
export type StepOutcome<TState>
  = { kind: 'continue', state: TState }
    | { kind: 'wait', state: TState, event: string }
    | { kind: 'done', state: TState }

/**
 * The seam every platform adapter satisfies.
 *
 * An adapter is verified against the same suite the in-memory implementation passes, so
 * "works on Cloudflare" and "works in a test" mean the same thing.
 */
export interface DurableRuntime {
  /** Begin a session and drive it until it waits or settles. */
  start: <TState>(spec: StartSpec<TState>) => Promise<SessionRecord<TState>>
  /** Deliver an event to a waiting session and drive it on. Unknown id rejects. */
  resume: <TState>(id: string, event: SessionEvent) => Promise<SessionRecord<TState>>
  /** Read a session without advancing it. Returns undefined for an unknown id. */
  get: <TState>(id: string) => Promise<SessionRecord<TState> | undefined>
}

/** What `start` needs to create a session. */
export interface StartSpec<TState> {
  /** Caller-supplied so a retry of the same trigger does not create a second session. */
  readonly id: string
  readonly initialState: TState
  readonly step: SessionStep<TState>
}

export { createMemoryRuntime } from './memory'
