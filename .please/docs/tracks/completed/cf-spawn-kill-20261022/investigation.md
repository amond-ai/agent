## Bug Investigation Report

Issue: #47 (tech debt TD-010), a follow-up to #15 that shipped in #44.

### 1. Reproduction Status

Reproduced, both on a real container and against a fake stub.

- **Real container** (2026-10-21, track `ai-sdk-sandbox-20261020` T010, `@cloudflare/sandbox` 0.11.0): `kill()` at 2500 ms on an 8-line `echo; sleep 1` loop rejected `wait()` at once with the orphan `AbortError`. The remote loop kept running and had written 7 lines to its log by about 6.5 s.
- **Fake stub:** the scratch test below fails 2 of 2 tests, quickly and the same way on every run.

**Reproduction path:**

1. `packages/agent/src/cloudflare/cf-sandbox.ts:329-338`: the stub has `execStream`, so `spawn` becomes `spawnLive`.
2. `packages/agent/src/cloudflare/cf-spawn.ts:189-196`: `spawnLive` starts the command with `stub.execStream(...)` and reads its event stream.
3. `packages/agent/src/sandbox-streams.ts:190-194`: `proc.kill()` runs the controller's kill hook once.
4. `packages/agent/src/cloudflare/cf-spawn.ts:183`: the kill hook only aborts a local `AbortController`.
5. `packages/agent/src/cloudflare/cf-spawn.ts:220-224`: `onAbort` cancels the local reader and fails `wait()` with the orphan `AbortError`. A caller abort reaches the same handler through `AbortSignal.any` (`cf-spawn.ts:175`).
6. **Failure point:** nothing in steps 4 and 5 calls the container. Cancelling the `execStream` stream does not stop the command, and `CloudflareSandboxStub` (`cf-sandbox.ts:18-56`) has no process methods to call.

### Feedback Loop

- **Loop type:** failing test
- **How to run:** `cd packages/agent && CI=true mise exec -- bunx vitest run src/cloudflare/cf-spawn.test.ts -t '#47'` (the scratch repro below was folded into these two regression tests)
- **Pass/fail criteria:** green = the fake container's process table is empty after `kill()` and after a caller abort; red = it still holds the command (`expected [ 'sleep 100' ] to deeply equal []`).
- **Reproduction rate:** N/A (deterministic).
- **Debug tag:** `[DEBUG-7c3e]`. No instrumentation was added.
- **Bypass approved:** no

The scratch file `packages/agent/src/cloudflare/cf-spawn-kill.repro.test.ts` was untracked and has since been deleted; its cases live on in `cf-spawn.test.ts` ("leaves no command running … (#47)"). Its fake stub models the container's process table:

- A command started with `execStream` is added to the table and stays there when its stream is cancelled, as on the real container.
- `startProcess` adds a command and returns its id.
- `killProcess(id)` removes that command.
- `startProcess` ignores a caller-chosen `processId`. A fix must kill by the id `startProcess` returns.

The fix workflow should turn this file into the committed regression test.

### Hypothesis Ranking

- **Ranked list:**
  1. `kill()` and abort only cancel the local reader, and the stub exposes no process API. Prediction: calling `killProcess(id)` from the kill and abort paths empties the fake's process table, and leaving only the reader cancel keeps both repro tests red.
  2. The output-cap path is a separate gap. Prediction: wiring a remote kill only into the kill hook still leaves the command running after the output cap, because the controller is marked settled before `onOverflow` runs, so a later `kill()` does nothing.
  3. A kill that arrives before the remote process has started is lost. Prediction: `kill()` or an abort while `startProcess` is pending leaves an orphan unless the new id is killed as soon as `startProcess` resolves.
  4. Forwarding the abort signal across the Durable Object RPC would stop the command. Prediction: passing `signal` to `execStream` stops it.
  5. `timeoutMs` is not enforced on a live Cloudflare `spawn`. Prediction: on the default HTTP transport, a live spawn with `timeoutMs` runs past its deadline.
- **Per-hypothesis verdict:**
  1. Confirmed. `cf-spawn.ts:183` and `:220-224` make no container call, the stub interface has no process methods, and the repro and the T010 real-container run both show the command surviving.
  2. Confirmed (static). `sandbox-streams.ts:161` sets `settled` before `:166` calls `onOverflow`, and `:191` makes `kill()` a no-op once settled. `cf-spawn.ts:185-186` only stops reading.
  3. Confirmed by reasoning, not run. The process id exists only after the `startProcess` round trip, and repro test 2 aborts in exactly that window.
  4. Refuted. In the SDK, `execStream` and `streamProcessLogs` check `signal` only on entry, and the container's stream `cancel()` only removes listeners (`execute-handler.ts:255-257` at the 0.11.0 tag). `cf-sandbox.ts:299-304` already forbids forwarding a signal over the RPC.
  5. Unverified (static only). The 0.11.0 container source passes no timeout to the command it starts for `execStream` (`execute-handler.ts:118-123`), and `startProcess` drops `timeout` on the default session path too. Nothing in `cf-spawn.ts` enforces the deadline locally.
- **Confirmed hypothesis:** 1, the root cause. Hypotheses 2 and 3 are also confirmed and are gaps the fix must cover.
- **User intervention:** no

### 2. Root Cause Analysis

**Problem location:**

- File: `packages/agent/src/cloudflare/cf-spawn.ts`
- Function: `spawnLive()`
- Lines: 174-187 (kill hook and output-cap hook), 220-224 (abort handler)

**Root cause:**
`spawnLive` never sends a stop to the container.

- **Kill and abort:** both only cancel the local event-stream reader (`cf-spawn.ts:178-181`) and fail `wait()` (`cf-spawn.ts:222`).
- **Why cancel isn't enough:** the stream comes from `execStream`, and cancelling it doesn't stop the command. The container side only removes its listeners.
- **No way to call one:** the structural stub type (`cf-sandbox.ts:18-56`) has no process API, so no code can stop the command.
- **Output cap:** this is a second, independent gap. `createProcessController` marks itself settled before calling `onOverflow` (`sandbox-streams.ts:159-167`), so the cap path cannot reach the container through `kill()`. Its own hook (`cf-spawn.ts:185`) only stops reading, and the stderr notice admits the command may still be running (`cf-spawn.ts:186`).

### 3. Proposed Solutions

**Recommended:** when the stub has `startProcess`, `streamProcessLogs` and `killProcess`, run live `spawn` through them instead of `execStream`. The change lands in:

- `cf-sandbox.ts:18-56`: add the three methods, plus an optional `getProcess`, to the stub type.
- `cf-sandbox.ts:329-338`: a capability check that selects the new path.
- `cf-spawn.ts`: a process-API branch of `spawnLive`.

How the branch behaves:

- **Start and read.** It starts the command with `startProcess`, then reads output and the exit code from `streamProcessLogs(id)`. That stream ends with an `exit` event carrying `exitCode`, not `complete`. When `exitCode` is missing, it falls back to `getProcess(id)`.
- **Stop.** One memoized terminate step calls `killProcess(id)` inside the container-death guard. It is shared by `kill()`, a caller abort, the output cap, and the timeout.
  - A kill requested before the id is known runs as soon as `startProcess` resolves.
  - Errors meaning "already exited" or "not found", and `SandboxDiedError`, are swallowed.
- **Timeout.** A local timer enforces `timeoutMs`.
- **Wording.** `wait()` keeps its current orphan `AbortError` wording, because the kill is not yet confirmed when `wait()` rejects (`sandbox.ts:50-57`). The output-cap notice no longer says the command may still be running.
- **Old path.** A stub with only `execStream` keeps today's behavior and wording.

Why it beats the alternatives: the SDK already stops the whole process tree (SIGTERM, then SIGKILL), and one terminate step covers all four ways a spawn can be stopped.

**Alternatives considered:**

- **Keep `execStream` and kill through a second `exec`** (record the pid by wrapping the command). Not chosen: it rewrites the user's command, can queue behind the running command on the default session, reimplements the SDK's process-tree kill, and cannot cover the start-pending window.
- **Call `killProcess` from the kill hook only.** Not chosen: it misses the output cap (hypothesis 2) and the timeout, and it still needs the process API to get an id, so it is a subset of the recommended fix.

### 4. Testing Requirements

- **Bug scenario:** the Feedback Loop above. Its failing check becomes the regression test.
- **Edge cases:**
  - `kill()` or caller abort while `startProcess` is pending → the returned id is killed as soon as it resolves; `wait()` rejects at once; the log stream is never opened.
  - Caller signal already aborted before `spawn()` → rejects before any stub call; no process starts (unchanged).
  - Kill or abort after the command exited → the "already exited" or "not found" error from `killProcess` is swallowed; `wait()` keeps its first settlement.
  - Container dies during `startProcess`, the log stream, or `killProcess` → `SandboxDiedError`; `wait()` and `kill()` both settle; no hang and no unhandled rejection.
  - `exit` event without an `exitCode` → fall back to `getProcess(id)`; if it is still missing, reject with "completed without an exit code".
  - Log stream ends without an `exit` event while the container is alive → the command is stopped and `wait()` rejects with "ended before the command completed".
  - Output cap reached → `wait()` resolves with exit code 1 and the stderr notice; the remote command is stopped; a later `kill()` is a no-op.
  - `timeoutMs` set → at the deadline the remote command is stopped and `wait()` resolves with exit code 124; a fractional value is rounded up; the timer is cleared on every settlement.
  - `kill()` twice, or `kill()` together with an abort → one `killProcess` call.
  - A `process_info` frame, or an unknown frame type → ignored.
  - Stub with only some of the three process methods → today's `execStream` path, or the buffered path when `execStream` is also missing.

### 5. Similar Code Patterns

- `packages/agent/src/node/local-env.ts:216-250`: `local()`'s live spawn uses one hook, `shell.kill()`, for both `kill()` and the output cap. That is the model to follow.
- `packages/agent/src/node/shell-process.ts:77-167`: idempotent, best-effort background kill (SIGTERM, then SIGKILL after a grace period).
- `packages/agent/src/cloudflare/cf-sandbox.ts:299-304`: `run` cannot forward its signal over RPC either. Out of scope here; its orphan is reported through `onOrphanSettled`.
