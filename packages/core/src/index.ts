/**
 * The agent contract: what a definition is, what a harness adapter must satisfy, and the
 * handlers a platform invokes.
 *
 * ADR-0001 makes the filesystem the definition — `agent/instructions.md`, `tools/*.ts`,
 * `schedules/*.ts`, `channels/*.ts`. Nothing in this package reads that tree. A Worker has no
 * `fs`, so scanning a directory at runtime is not portable; the CLI walks the tree on the
 * developer's machine and emits an `AgentManifest` whose imports are static, and that manifest
 * is what ships. The filesystem is the authoring surface; the manifest is the deployed one.
 */

/** A tool the harness may call. One per file under `tools/`, default-exported. */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string
  readonly description: string
  /** A zod schema, kept opaque here so this package does not pin the caller's zod version. */
  readonly input: unknown
  readonly run: (input: TInput) => Promise<TOutput>
}

/** A skill directory — `skills/<name>/SKILL.md` plus whatever that file references. */
export interface SkillDefinition {
  readonly name: string
  readonly instructions: string
}

/** A cron-triggered entry point. One per file under `schedules/`. */
export interface ScheduleDefinition {
  readonly name: string
  /** Standard five-field cron. The platform adapter registers it; we do not. */
  readonly cron: string
  readonly prompt: (now: Date) => string
}

/** An event-triggered entry point. One per file under `channels/`. */
export interface ChannelDefinition<TEvent = unknown> {
  readonly name: string
  /** Returns the prompt to run, or undefined to ignore this event. */
  readonly accept: (event: TEvent) => string | undefined
}

/**
 * What the CLI emits and a platform deploys: the filesystem layout, resolved, with every
 * import already static.
 */
export interface AgentManifest {
  readonly instructions: string
  readonly tools: readonly ToolDefinition[]
  readonly skills: readonly SkillDefinition[]
  readonly schedules: readonly ScheduleDefinition[]
  readonly channels: readonly ChannelDefinition[]
  readonly harness: HarnessAdapter
}

/**
 * What `agent/agent.ts` default-exports: the choices ADR-0001 keeps in typed code because the
 * filesystem cannot express them. The loader never reads this value — `amond build` emits a
 * static import of the module and the manifest takes its `harness` from here.
 */
export interface AgentConfig {
  readonly harness: HarnessAdapter
}

/**
 * The harness seam. Chosen explicitly in `agent.ts` (ADR-0001) rather than inferred, because
 * harness differences are load-bearing: what a turn costs, what it can be interrupted at, and
 * what a deferred tool means all differ between them.
 */
export interface HarnessAdapter {
  /** Names the harness in every diagnostic this framework emits. */
  readonly id: string
  /**
   * Run one turn to a settled outcome. The adapter owns the sandbox, the transport and the
   * turn loop; this contract sees only what went in and what came out.
   */
  readonly runTurn: (spec: TurnSpec) => Promise<TurnOutcome>
}

export interface TurnSpec {
  readonly prompt: string
  readonly tools: readonly ToolDefinition[]
  readonly instructions: string
  /** Set when this turn continues an earlier one rather than starting fresh. */
  readonly resumeFrom?: string
}

export type TurnOutcome
  = { kind: 'done', text: string, sessionId: string }
    /** A tool the policy defers ends the turn; the same session resumes after an answer. */
    | { kind: 'deferred', sessionId: string, awaiting: string }
    | { kind: 'failed', error: string }

/**
 * The handlers a platform invokes. `amond build` writes a thin entry point per target that
 * re-exports these; the wiring — `wrangler.jsonc`, `vercel.json`, cron registration — stays the
 * user's, per the decision to export handlers rather than generate deployment artifacts.
 */
export interface AgentHandlers {
  /** HTTP entry: channel events arrive here. */
  readonly fetch: (request: Request) => Promise<Response>
  /** Cron entry: the platform passes the firing time. */
  readonly scheduled: (now: Date) => Promise<void>
}

/**
 * Build the handlers for a manifest. The entry point `amond build` emits calls this and
 * re-exports what comes back, so this name is the seam between a generated entry point and the
 * routing behind it.
 *
 * _TODO: route channels and schedules through the durable runtime._
 *
 * Deliberately unimplemented rather than stubbed with a plausible body: handlers that answered
 * every request with a shaped 200 would make a build look deployable while routing nothing.
 */
export function createHandlers(_manifest: AgentManifest): AgentHandlers {
  throw new Error('not implemented')
}
