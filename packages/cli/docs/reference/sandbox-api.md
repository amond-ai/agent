---
title: Sandbox Adapter API
description: The contract for building a sandbox adapter — SandboxFactory, Sandbox, SandboxDriver, the adapter tool factory, and the built-in sandbox factories.
lastReviewedAt: 2026-07-21
---

A sandbox adapter wraps an execution environment — a provider SDK, a container, the host machine, an in-memory emulation — into the factory contract that [`useSandbox(...)`](/docs/reference/agent-hooks-api/#usesandbox) accepts. This page documents that contract: the `SandboxFactory` interface, the `Sandbox` surface an adapter must produce, the helpers that produce it from simpler shapes, the adapter tool factory, and the built-in factories. For choosing and using sandboxes, see the [Sandboxes guide](/docs/guide/sandboxes/); for per-provider setup, see the [E2B](/docs/ecosystem/sandboxes/e2b/) and [Daytona](/docs/ecosystem/sandboxes/daytona/) pages.

**The model never calls this surface.** An agent's model-facing file and shell capabilities are the built-in tools — `read` with offset/limit paging, `edit` string replacement, `grep`, `glob` — built on top of it and documented in [Agent Behavior](/docs/reference/agent-behavior/#built-in-tools). This page is for the two audiences underneath: adapter authors implementing a provider, and application code scripting the environment through [`harness.sandbox`](/docs/reference/agent-api/#harnesssandbox).

All symbols on this page are exported from `@amond-ai/agent`, except `local()` (from `@amond-ai/agent/node`) and `cloudflareSandbox()` (from `@amond-ai/agent/cloudflare`). The former names — `SessionEnv`, `SandboxApi`, `SessionToolFactory`, `createSandboxSessionEnv`, and the factory method `createSessionEnv` — remain available as deprecated aliases. Driver-based adapters keep compiling and running unchanged (`SandboxApi` is `SandboxDriver`, and `createSandboxSessionEnv` calls `sandboxFromDriver`). `SessionEnv` is the same type as `Sandbox`, so a hand-written `SessionEnv` that still implements the former surface (`exec`, `readFileBuffer`, path-string `readFile`/`writeFile`) no longer type-checks and must move to the current `Sandbox` methods.

## `SandboxFactory`

```ts
interface SandboxFactory {
  createSandbox(options: { id: string }): Promise<Sandbox>;
  tools?: SandboxToolFactory;
}
```

The value passed to `useSandbox(...)` or composed into an agent's `sandbox:` config. The factory object itself is cheap to construct — agents build a fresh one on every render. All expensive work belongs inside `createSandbox()`.

- `createSandbox(options)` — builds the environment. Called once per initialized harness — one call per `init()` — and every session and task session of that harness shares the returned sandbox. Re-renders never rebuild the environment. A rejection fails the agent's initialization.
- `options.id` — the agent instance id (`ctx.id`). Multiple harnesses initialized in the same context receive the same `id`, so an adapter that keys provider resources on `id` must tolerate repeated calls with the same value. Keying a provider workspace on `id` is how a conversation gets a durable filesystem across messages and restarts.
- `tools` — optional. When present, replaces the framework's default model-facing tool set for this sandbox. See [`SandboxToolFactory`](#sandboxtoolfactory).

A minimal adapter over a provider SDK, using [`sandboxFromDriver`](#sandboxfromdriverdriver-cwd-options) to supply the generic path and abort plumbing:

```ts
import { sandboxFromDriver, type SandboxDriver, type SandboxFactory } from '@amond-ai/agent';

export function myProvider(client: MyProviderClient): SandboxFactory {
  return {
    async createSandbox({ id }) {
      const sandbox = await client.findOrCreate(id);
      const driver: SandboxDriver = {/* map each SandboxDriver method to the provider SDK */};
      return sandboxFromDriver(driver, '/workspace');
    },
  };
}
```

What the contract deliberately does not include:

- **No teardown verb.** There is no `dispose()` or lifecycle callback. amond connects to what the factory hands it and never creates, reuses, or destroys provider infrastructure on its own — provisioning and deletion belong to the application (typically inside the factory, or in application code around it). An adapter must not call the provider's `delete()`/`terminate()`/`kill()` on the application's behalf.
- **No per-message rebuild.** The environment is resolved once per initialized harness. An adapter cannot observe individual messages or turns.
- **Legacy method name.** Factories implementing the pre-rename `createSessionEnv` still work: the runtime calls it when `createSandbox` is absent (with a one-time deprecation warning). New adapters should implement `createSandbox`.
- **No identity beyond `id`.** The factory receives the instance id and nothing else — no conversation content, no request data. Anything else an adapter needs must be captured in the closure that built the factory.

### `useSandbox` `cwd` scoping

When the agent passes `useSandbox(factory, { cwd })`, the runtime wraps the adapter's sandbox in a scoping layer after `createSandbox()` resolves. The adapter is not involved and must not apply an agent's `cwd` itself:

- The `cwd` value is resolved through the adapter env's own `resolvePath` (so a relative value resolves against the adapter's base directory), then POSIX-normalized.
- The wrapper resolves all relative file paths against the scoped `cwd`, defaults the `workingDirectory` of `run` and `spawn` to it, and resolves a relative per-call `workingDirectory` against it.
- The wrapper exposes only the standard `Sandbox` members. Extra properties an adapter attached to its sandbox (a [native surface](#extending-sandbox)) are not forwarded — agents that need the native surface must not set a `cwd` override on `useSandbox`.

## `Sandbox`

```ts
interface Sandbox extends Experimental_SandboxSession {
  readonly description: string;

  run(options: SandboxRunOptions): Promise<ShellResult>;
  spawn(options: SandboxRunOptions): Promise<SandboxProcess>;

  readFile(options: { path: string; abortSignal?: AbortSignal }): Promise<ReadableStream<Uint8Array> | null>;
  readBinaryFile(options: { path: string; abortSignal?: AbortSignal }): Promise<Uint8Array | null>;
  readTextFile(options: {
    path: string;
    encoding?: string;
    startLine?: number;
    endLine?: number;
    abortSignal?: AbortSignal;
  }): Promise<string | null>;
  writeFile(options: {
    path: string;
    content: ReadableStream<Uint8Array>;
    abortSignal?: AbortSignal;
  }): Promise<void>;
  writeBinaryFile(options: { path: string; content: Uint8Array; abortSignal?: AbortSignal }): Promise<void>;
  writeTextFile(options: {
    path: string;
    content: string;
    encoding?: string;
    abortSignal?: AbortSignal;
  }): Promise<void>;

  stat(path: string): Promise<FileStat>;
  readdir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  cwd: string;
  resolvePath(p: string): string;
}

type SandboxRunOptions = {
  command: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
};

interface SandboxProcess {
  pid?: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  wait(): Promise<{ exitCode: number }>;
  kill(): Promise<void>;
}
```

The agent's live sandbox: the universal environment interface. `Sandbox` extends the AI SDK's `Experimental_SandboxSession` (from `@ai-sdk/provider-utils`) as is, so any sandbox amond builds can be handed to the AI SDK harness with no adapter. `SandboxProcess` stands for the AI SDK's `Experimental_SandboxProcess`, and `SandboxRunOptions` is the session's command options plus amond's `timeoutMs`. `description` is the environment in prose, for the agent's instructions: what kind of sandbox it is and its working directory. Every sandbox mode — virtual, local, remote — implements it, so core logic never branches on mode. The same object is exposed to application code as [`harness.sandbox`](/docs/reference/agent-api/#harnesssandbox), and the standard model-facing tools operate through it. Operations on it are never recorded in the conversation.

Most adapters should not implement this interface by hand: [`sandboxFromDriver`](#sandboxfromdriverdriver-cwd-options) (over a provider SDK) and [`bash()`](#bashfactory) (over a just-bash instance) produce conforming sandboxes from smaller surfaces. The contract below is what those wrappers guarantee, and what a hand-written implementation must reproduce.

### Path semantics

- Paths are POSIX-style, `/`-separated. (`local()` on Windows uses host path semantics.)
- Every file method accepts both absolute and relative paths. Relative paths resolve against `cwd`.
- `cwd` — the environment's working directory, as an absolute path. Workspace discovery (the directory listing, `AGENTS.md`, `.agents/skills/`) and default command execution happen here.
- `resolvePath(p)` — resolves a relative path against `cwd` without touching the filesystem; absolute paths pass through. File methods resolve internally — callers need `resolvePath` only when their own logic wants the absolute path. The standard `write`/`edit` tools also use it to key per-file mutation locks, so two spellings of the same path must resolve to the same string.

### `run` and `spawn`

`run(options)` runs a shell command to completion and resolves with its output. `spawn(options)` starts a command and resolves with a process handle. Both take the same options.

- `options.command` — the shell command line.
- `options.workingDirectory` — working directory for this command. A relative value resolves against `cwd`; when omitted, the command runs in `cwd`.
- `options.env` — environment variables supplied to the command, layered on top of whatever base environment the adapter defines.
- `options.timeoutMs` — amond's extension to the AI SDK options: a wall-clock deadline in milliseconds, and the primary cancellation contract. Forward it to the provider's native timeout option (E2B `timeoutMs`, Daytona `timeout`, Modal `timeout`, and so on) so signal-blind providers still observe the deadline. A provider with no native timeout option, such as `bash()` or `local()`, enforces it through an abort signal instead. A fractional value is rounded up, never down.
- `options.abortSignal` — cancellation. Aborting rejects the returned promise promptly with an `AbortError` (`DOMException`) carrying the signal's reason as `cause` — never gated on the remote command's settlement. A signal that is already aborted rejects before the command runs. An adapter whose provider can cancel mid-flight does so, so the rejection is exact; one that can't leaves the command running as an **orphan** that keeps executing (and mutating the workspace) after the rejection, its eventual result discarded rather than surfacing later. The `AbortError` message says so. See [`sandboxFromDriver`](#sandboxfromdriverdriver-cwd-options) for how the wrapper implements this and how to observe an orphan's settlement.
- `timeoutMs` and `abortSignal` are independent. Callers with a deadline that also want ad-hoc cancellation pass both; adapters that support both should observe whichever fires first. The standard `bash` tool passes both whenever the model requests a timeout.

`run` resolves with a `ShellResult` for any completed command, non-zero exit codes included. Rejections are reserved for transport failures and aborts. A container that dies mid-command rejects with `SandboxDiedError`.

`spawn` resolves with a handle: `pid` (when the provider reports one), `stdout` and `stderr` as `ReadableStream<Uint8Array>`, `wait()` for the exit code, and `kill()`. Whether the streams deliver output as the command writes it depends on the provider:

| Sandbox | `spawn` output |
| --- | --- |
| `local()` | Streams live. |
| `cloudflareSandbox` | Streams live when the stub has the process methods (`startProcess`, `streamProcessLogs`, `killProcess`) or `execStream`; buffered otherwise. |
| `bash()` | Buffered: the whole output arrives when the command exits. |
| `sandboxFromDriver` and driver-backed sandboxes | Buffered: the whole output arrives when the command exits. |

A buffered `spawn` runs the command through `run`, so abort, `timeoutMs`, and orphan reporting behave as they do there. `kill()` aborts the command the same way.

On `cloudflareSandbox`, each spawned command runs in its own shell scope, so a command that ends with `exit N` makes `wait()` resolve to exit code `N`. On `cloudflareSandbox` with the process methods, `kill()` and an abort stop the command in the container. `wait()` rejects at once with an `AbortError` whose message still says the cancellation could not be confirmed, because it does not wait for the container. `await proc.kill()` resolves once the container has stopped the command, and it does not reject if the command already exited or the container died. On a stub with only `execStream`, there is no remote kill: `kill()` and an abort stop delivering output and reject `wait()` with an `AbortError` whose message names the orphan, but the command may keep running in the container.

### File methods

Each of the first six methods takes a single options object with `path`.

- `readFile({ path })` — reads a file as a `ReadableStream<Uint8Array>`.
- `readBinaryFile({ path })` — reads raw bytes as a `Uint8Array`.
- `readTextFile({ path, encoding?, startLine?, endLine? })` — reads a file as text. `startLine` and `endLine` select a 1-based, inclusive line range.
- A read of a path that does not exist resolves with `null` rather than throwing.
- Every file method accepts an optional `abortSignal`. A signal that is already aborted rejects with an `AbortError` before any I/O. An abort mid-flight rejects promptly, but a write may still land.
- `writeFile({ path, content })` writes a `ReadableStream<Uint8Array>`, `writeBinaryFile` writes a `Uint8Array`, and `writeTextFile` writes a string. `writeTextFile` accepts only UTF-8 encoding labels (`encoding: 'utf-8'`, `'utf8'`) and rejects any other with a `TypeError`. All three create or replace the file and must create missing parent directories — a cross-mode guarantee (`writeTextFile({ path: 'out/nested/report.md', … })` never requires a prior `mkdir`). `sandboxFromDriver`, `bash()`, and `local()` all implement it by retrying a failed write once after `mkdir -p` on the parent; a hand-written sandbox must provide the same guarantee.
- `stat(path)` — file metadata. Throws if the path does not exist.
- `readdir(path)` — directory entry names (names only, no paths). Throws if the path is not a directory.
- `exists(path)` — `true` if a file or directory exists. Never throws.
- `mkdir(path, options)` — creates a directory; `recursive` creates missing parents and tolerates an existing directory.
- `rm(path, options)` — removes a file or directory; `recursive` removes directory contents, `force` suppresses the missing-path error. An adapter whose provider cannot honor a requested option must throw [`SandboxOperationUnsupportedError`](#sandboxoperationunsupportederror) before modifying anything — never silently ignore an option or leave its behavior provider-defined.

Errors thrown by these methods surface to the model as tool errors, so messages should be factual and self-contained (the standard tools pass them through). The standard `read` and `edit` tools report a missing file as `File not found: {path}` on every provider. Application code that reads through `session.fs` instead gets a `FileNotFoundError` with the same message.

### `ShellResult`

```ts
interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

### `FileStat`

```ts
interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink?: boolean;
  size?: number;
  mtime?: Date;
}
```

- `isSymbolicLink`, `size`, and `mtime` are omitted when the provider does not expose them. Adapters must never fabricate placeholder values (`new Date()`, `0`, `false`) — callers cannot distinguish them from real metadata.
- For symlinks, `isFile`/`isDirectory`/`size`/`mtime` describe the target and `isSymbolicLink` describes the path itself (the semantics of `stat -L` plus a non-following check; `local()` and the Cloudflare Sandbox adapter both implement this).

### Extending `Sandbox`

An adapter may return a sandbox with additional properties — a native surface beyond the generic verbs. `harness.sandbox` exposes the object exactly as returned, so an adapter package can ship a runtime-checked accessor that narrows to it (the Cloudflare Computer adapter's `computerWorkspace(harness.sandbox)` returns its `Workspace` this way). Two constraints:

- A `cwd` override on `useSandbox` wraps the sandbox and drops extra properties ([above](#usesandbox-cwd-scoping)).
- A sandbox that cannot execute commands should still ship all file methods and throw from `run` and `spawn` — and pair the sandbox with a [`tools`](#sandboxtoolfactory) list that omits the exec-backed standard tools.

## `sandboxFromDriver(driver, cwd, options?)`

```ts
function sandboxFromDriver(
  driver: SandboxDriver,
  cwd: string,
  options?: {
    onOrphanSettled?: (settlement: OrphanedExecSettlement) => void;
    description?: string;
  },
): Sandbox;
```

Wraps a `SandboxDriver` — the minimal interface a remote provider adapter implements — into a conforming `Sandbox`. `options.description` sets `Sandbox.description`; it defaults to a generic remote-sandbox description that names `cwd`. The wrapper's `run` calls `driver.exec`, and its `spawn` is buffered: a driver has no streaming method, so the output arrives when the command exits. The wrapper supplies:

- Path resolution: relative file paths and relative/absent `workingDirectory` values resolve against `cwd`, POSIX-normalized. The `driver` methods always receive absolute paths.
- The parent-creation guarantee of the write methods: a failed write is retried once after `driver.mkdir(parent, { recursive: true })`; when the retry still fails, the retried write's error propagates.
- The `run` abort race: an already-aborted signal rejects with `AbortError` before `driver.exec` is called. An abort that fires mid-flight rejects promptly too — the wrapper never waits on `driver.exec`'s own settlement to decide the caller's outcome, whether or not the adapter wired `signal` into its SDK. The adapter only needs to forward `signal` when its SDK has a real cancellation primitive; the abort race and the promise-consumption below apply either way.

### Orphaned commands

When an abort fires before `driver.exec`'s promise has settled, that promise becomes an **orphaned command**: the caller has already been released with an `AbortError`, but the provider call keeps running until it settles on its own. A cancel-capable adapter that forwards `signal` still produces one of these — the window just shrinks from the command's remaining duration down to the SDK's cancellation latency, since the wrapper's rejection always races ahead of that confirmation.

An orphan's eventual settlement — fulfillment or rejection — is never appended to the conversation; the abort already stands as the command's terminal result, and a second outcome arriving later would violate reducer invariants. It's consumed here so it can't surface as an unhandled rejection, and reported only through `options.onOrphanSettled`:

```ts
interface OrphanedExecSettlement {
  command: string;
  startedAt: Date;
  abortedAt: Date;
  settledAt: Date;
  result?: ShellResult;
  error?: unknown;
}
```

`error` carries whatever the orphaned call eventually rejected with — a late `SandboxDiedError` included. Without `onOrphanSettled`, the settlement is simply discarded; adapters that want to log, bill, or reap an orphaned remote process out-of-band use the callback to do so.

### `SandboxDriver`

```ts
interface SandboxDriver {
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<FileStat>;
  readdir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  exec(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<ShellResult>;
}
```

`SandboxDriver` deliberately keeps the older shapes: `exec` instead of `run`/`spawn`, and path-based `readFile`, `readFileBuffer`, and `writeFile` instead of the session file methods. `sandboxFromDriver` translates them into the `Sandbox` members. The remaining members match `Sandbox`, except that paths arrive pre-resolved (absolute) and the `writeFile` parent guarantee is handled by the wrapper.

File-verb implementation notes:

- `writeFile` — accept both `string` and `Uint8Array`; convert strings to UTF-8 bytes for a provider that only accepts buffers. Let a missing-parent error propagate — the wrapper retries after `mkdir(parent, { recursive: true })`, so adapter-side parent creation is redundant.
- `readFileBuffer` — return a `Uint8Array`; wrap a Node `Buffer` with `new Uint8Array(buffer)`.
- `exists` — must not throw. Most provider SDKs throw for a missing path; catch and return `false`.
- `mkdir` — a provider SDK that only supports single-level creation may implement `recursive` with `exec('mkdir -p …')`.
- `rm` — implement `recursive` and `force` exactly, or throw [`SandboxOperationUnsupportedError`](#sandboxoperationunsupportederror) before any mutation. A direct filesystem adapter must not shell out solely to emulate unsupported removal flags; an adapter that already runs other verbs through the shell implements the flags with `rm` there too — shell semantics match Node's `fs.rm` exactly (`-f` resolves on a missing path, `-r` without `-f` fails on one, `-f` on a directory still errors).

`exec` implementation contract:

- Honor `timeoutMs` by forwarding it to the provider SDK's native timeout option, converting units and rounding up — never down — when the provider is coarser (a whole-seconds provider forwards `Math.ceil(timeoutMs / 1000)`). It stays the provider-primary deadline regardless of `signal`: it's what protects a signal-blind caller, and a caller that never aborts at all.
- An adapter that enforces the deadline itself resolves an expired command as a `ShellResult` with `exitCode: 124` and the timeout details on `stderr` — the `timeout(1)` convention the shipped adapters follow. Rejection stays reserved for `signal` aborts.
- Forward `signal` when the SDK has a real cancellation primitive (an `AbortSignal` option, a process kill, a cancel token) — doing so shrinks the orphan window from the command's remaining duration down to the SDK's cancellation latency. Confirm the cancellation actually takes effect; a `signal` that's accepted but not honored is worse than not forwarding it, since it advertises a kill the command never receives. Don't implement a second abort race around the call (a local `Promise.race`, or the adapter's own pre/post `signal.aborted` checks) — `sandboxFromDriver` already races `signal` against `driver.exec`'s promise and owns the caller-facing rejection; a second race only duplicates it while leaving the orphan bookkeeping unable to tell which one fired.
- When the provider does not expose `stderr` separately, return `''` for it. Report `exitCode: 0` only for a clearly successful call.

Liveness contract (all `SandboxDriver` methods):

- An adapter should ensure in-flight operations settle when the sandbox dies, by whatever mechanism its provider SDK supports — native rejection of in-flight calls, or polling a cheap control-plane status read while a call is pending. The first-party Cloudflare adapter implements the polling shape internally.
- An adapter with no such mechanism carries an accepted limitation: when the provider transport never settles a call after the sandbox dies, that call may hang until the surrounding operation is aborted.
- There is deliberately no per-command deadline in this contract. Agent commands are legitimately unbounded; `timeoutMs` is the command's own deadline, not an infrastructure liveness bound.
- An adapter that detects sandbox death should reject with `SandboxDiedError` (`type: 'sandbox_died'`, exported from `@amond-ai/agent`), so shell classification reports an infrastructure failure rather than caller cancellation.
- Liveness detection and caller abort are separate concerns implemented at different layers, and a death detector must not blur them: it races the sandbox's liveness signal against the in-flight provider call and nothing else. `sandboxFromDriver` already races `signal` one layer up and consumes the provider promise's eventual settlement once the caller has been released, so a death detector that also listens for `signal` produces two rejections competing for the same promise. The first-party Cloudflare adapter's death detector follows this split — liveness-only, with the caller-abort race left entirely to the wrapper it builds on.

## `bash(factory)`

```ts
function bash(factory: BashFactory): SandboxFactory;

type BashFactory = () => BashLike | Promise<BashLike>;
```

Wraps a [just-bash](https://github.com/vercel-labs/just-bash) `Bash` instance into a `SandboxFactory` — the in-memory [virtual sandbox](/docs/guide/sandboxes/#the-virtual-sandbox) (seeded files, a network allowlist, custom commands).

- The factory function is called once, when the runtime initializes the agent.
- The returned value is duck-type checked (`exec`, `getCwd`, and an `fs` object). A wrong value throws `Error('[amond] BashFactory must return a Bash-like object.')`.
- The sandbox's `cwd` is the instance's `getCwd()` (just-bash defaults to `/home/user` when constructed without `cwd` or `files`).
- just-bash has no native timeout option, so the wrapper translates `run`'s `timeoutMs` into an `AbortSignal` and merges it with the caller's signal. Pre- and post-call abort checks apply as in `sandboxFromDriver`.
- The parent-creation guarantee of the write methods is applied over the instance's `fs`.
- `spawn` is buffered: the whole output arrives when the command exits.

`BashLike` is a structural type (no just-bash import in `@amond-ai/agent`), exported for adapter authors who construct compatible runtimes:

```ts
interface BashLike {
  exec(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal },
  ): Promise<ShellResult>;
  getCwd(): string;
  fs: {
    readFile(path: string, options?: any): Promise<string>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string | Uint8Array, options?: any): Promise<void>;
    stat(path: string): Promise<any>;
    readdir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    resolvePath(base: string, path: string): string;
  };
}
```

## `SandboxToolFactory`

```ts
type SandboxToolFactory = (
  sandbox: Sandbox,
  options: SandboxToolFactoryOptions,
) => AgentTool<any>[];

interface SandboxToolFactoryOptions {
  subagents: Record<string, SubagentDefinition>;
}
```

An optional `tools` function on a `SandboxFactory`. When present, its return value **replaces** the framework's default six-tool set (`read`, `write`, `edit`, `bash`, `grep`, `glob`) for agents on this sandbox. Compose the replacement from the [standard tool factories](#the-standard-tool-factories) plus the sandbox's own native tools rather than rebuilding from scratch — an exec-less sandbox, for example, lists the three file tools and its own executor tool.

- Must be synchronous and return a fresh array on every call. It is invoked each time the runtime assembles the model's tool list — at initialization and again at every turn boundary — not once.
- `sandbox` — the live sandbox, with the [packaged-skill overlay](#packaged-skill-overlays) layered onto `readFile`. This is not the identical object `harness.sandbox` exposes; tools that hold the sandbox in a closure read packaged-skill paths transparently.
- `options.subagents` — the agent's current subagent roster, keyed by name. Provided for adapters whose tools describe or constrain delegation.

The replacement covers only the framework's built-in group. Unaffected by it:

- The framework group — `task` (always present), `activate_skill` (when any skill is mounted), and `read_skill_resource` (when a mounted packaged skill carries supporting files) — is appended separately.
- Custom tools from `useTool(...)` / `defineTool(...)` and per-call result tools are added separately.

Tool names must be unique across all groups, and the names `task`, `activate_skill`, `read_skill_resource`, `finish`, and `give_up` are framework-reserved. A collision throws [`ToolNameConflictError`](/docs/reference/errors/#toolnameconflicterror) when the tool list is assembled.

The element type is `AgentTool` from `@earendil-works/pi-agent-core` (a dependency of `@amond-ai/agent`; the type is not re-exported). Structurally:

```ts
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters; // TypeBox schema
  execute(
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partial: AgentToolResult<TDetails>) => void,
  ): Promise<AgentToolResult<TDetails>>; // { content, details, terminate? }
}
```

`execute` throws on failure rather than encoding errors in `content`. The standard factories return values of this type; typing a factory as `SandboxToolFactory` checks a hand-written tool against it.

## The standard tool factories

```ts
function createReadTool(sandbox: Sandbox): AgentTool;
function createWriteTool(sandbox: Sandbox): AgentTool;
function createEditTool(sandbox: Sandbox): AgentTool;
function createBashTool(sandbox: Sandbox): AgentTool;
function createGrepTool(sandbox: Sandbox): AgentTool;
function createGlobTool(sandbox: Sandbox): AgentTool;
```

One factory per standard model-facing tool, each closing over a `Sandbox`. These are exactly the tools the framework installs when a sandbox has no `tools` function; exporting them per-tool lets an adapter's `SandboxToolFactory` add, drop, or swap members without rebuilding the set. The tools' model-facing behavior — parameters, truncation limits, error shapes, continuation markers — is documented in [Agent Behavior](/docs/reference/agent-behavior/#built-in-tools). What matters when composing them:

- `createReadTool`, `createWriteTool`, and `createEditTool` need only the file methods; `createBashTool`, `createGrepTool`, and `createGlobTool` require a working `run` — leave them out for exec-less sandboxes.
- `read` fetches through `readTextFile` and slices in the runtime; `edit` is a whole read → replace → write transaction. Same-file mutations from `write`/`edit` within one parallel tool batch are serialized through a per-path lock keyed on `resolvePath`, so two spellings of the same path must resolve to the same string. A `bash` command mutating the same file concurrently is not synchronized.
- `createBashTool` converts the model's `timeout` (seconds) to `timeoutMs` for the sandbox and additionally composes it into the abort signal as a backstop for sandboxes that ignore both cancellation fields; a pure timeout surfaces as a recoverable `exitCode: 124` result while a host abort rethrows.
- `createGrepTool` probes for `rg` once per environment (`rg --version`, 10-second deadline, cached) and falls back to `grep -rnH`; `createGlobTool` shells out to `find -name`.

## Packaged-skill overlays

Supporting files of a [packaged skill](/docs/guide/skills/#supporting-files-at-runtime) live in the application bundle, not the sandbox. The runtime serves them at virtual paths under `/.amond/packaged-skills/<skill-id>/…`, and it does so by layering an overlay onto the env it hands to tool factories — never by writing into the adapter's filesystem.

- The env passed to every tool factory (standard and adapter alike) has the three read methods (`readFile`, `readBinaryFile`, `readTextFile`) wrapped: paths under `/.amond/packaged-skills/` resolve from the in-memory skill catalog, everything else delegates to the adapter. Adapters need no special-casing; any tool that reads through its env resolves skill paths transparently.
- An unknown path under that root resolves with `null`, like any missing file, instead of reaching the adapter.
- `readBinaryFile` and `readFile` return a skill file's raw bytes. `readTextFile` (and so the standard `read` tool) serves binary skill files as base64 text, wrapped to 76-character lines.
- The overlay is session-internal. `harness.sandbox` and `useTool` handlers see the adapter's real env; the virtual root is not visible there.
- Only the read methods are overlaid. `run`, `spawn`, `exists`, `stat`, and the other verbs pass straight through, so shell commands cannot see the virtual root — the standard `read` tool (or the framework's `read_skill_resource` tool) is the access path.

## Built-in factories

### `local(options?)`

```ts
import { local } from '@amond-ai/agent/node';

function local(options?: LocalSandboxOptions): SandboxFactory;

interface LocalSandboxOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}
```

Node target only. Binds the agent directly to the host: file methods call `node:fs/promises`, and `run` and `spawn` start real processes. `spawn` streams output live. There is no isolation — see the [Node target guide](/docs/guide/node-target/#local-sandbox) for when that is appropriate.

- `cwd` — working directory. Defaults to `process.cwd()`; resolved to an absolute host path.
- `env` — variables layered on top of the default allowlist. Set a key to `undefined` to drop a default. A non-record value (an array, `true`) throws a `TypeError` at construction. Per-call `env` on `run` and `spawn` layers on top of the result.

Environment allowlist: the model's shell does not inherit `process.env`. Only `PATH`, `HOME`, `USER`, `LOGNAME`, `HOSTNAME`, `SHELL`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TERM`, `TMPDIR`, `TMP`, and `TEMP` pass through by default; everything else is a per-variable opt-in via `options.env`. The snapshot is taken once at construction — later mutations of `process.env` are not picked up. `env: { ...process.env }` inherits everything, host secrets included.

`run` behavior (`spawn` uses the same shell and kill path):

- Commands run through real `bash` when present (probed once per process, resolved to an absolute path), falling back to the platform default shell (`/bin/sh` or, on Windows, the system shell) when it is not.
- On POSIX the child leads its own process group; abort and timeout signal the whole group — `SIGTERM`, escalating to `SIGKILL` after a 2-second grace — so compound commands cannot orphan grandchildren. The kill is real, so `local()` has no orphaned-command window beyond that grace period.
- Non-zero exits and spawn failures resolve as `ShellResult` (spawn failures as `exitCode: 1` with the error message on stderr). A `timeoutMs` expiry also resolves as a `ShellResult`, with `exitCode: 124` — the `timeout(1)` convention. A caller-initiated `abortSignal` abort instead rejects with `AbortError`, even though the kill takes the same process-group path and produces that same 124 exit internally — the rejection wins and the caller never observes the `ShellResult`. A signal death `local()` did not itself initiate keeps the generic `exitCode: 1`.
- Captured output is capped at 64 MiB; exceeding it kills the process tree and resolves with `exitCode: 1` and a truncation note on stderr.
- `timeoutMs` is composed into the caller's `abortSignal` (there is no separate native timeout), so a pure deadline expiry and a caller abort are both delivered through the same kill path and only diverge at the point above.

`stat` reports `isFile`/`isDirectory`/`size`/`mtime` for the symlink target and `isSymbolicLink` for the path itself. All `FileStat` fields are populated.

### `cloudflareSandbox(sandbox, options?)`

```ts
import { cloudflareSandbox } from '@amond-ai/agent/cloudflare';

function cloudflareSandbox(
  sandbox: CloudflareSandboxStub,
  options?: CloudflareSandboxOptions,
): SandboxFactory;

interface CloudflareSandboxOptions {
  cwd?: string;
}
```

Cloudflare target. Wraps a `@cloudflare/sandbox` Durable Object stub (the value `getSandbox()` returns) into a `SandboxFactory`. `CloudflareSandboxStub` is structural, so `@amond-ai/agent` does not depend on `@cloudflare/sandbox`.

- `cwd` — working directory inside the container. Defaults to `/workspace`.

Each command runs in its own shell scope, a subshell of the SDK's session shell, as on `local()`. A `cd` or `export` in one command does not carry over to the next, and `env` and the working directory you pass reach the command. A command that ends with `exit N` reports exit code `N`, and one that fails to parse reports a non-zero exit code with the shell's error on stderr.

See [Cloudflare Sandbox](/docs/guide/cloudflare-target/#cloudflare-sandbox) in the target guide and the [ecosystem entry](/docs/ecosystem/sandboxes/cloudflare/).

## `SandboxOperationUnsupportedError`

```ts
class SandboxOperationUnsupportedError extends AmondError {
  constructor(input: { operation: string; provider: string; options: readonly string[] });
}
```

The error an adapter throws when a caller requests an operation with options the provider cannot honor (`type: 'sandbox_operation_unsupported'`). Throw it before modifying the filesystem, so the rejection guarantees nothing changed. `operation` names the verb, `provider` the sandbox product, and `options` the specific option names that could not be honored; all three are preserved on the error's `meta`. See [Errors — `SandboxOperationUnsupportedError`](/docs/reference/errors/#sandboxoperationunsupportederror).
