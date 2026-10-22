# Plan: Stop the remote command when a live Cloudflare spawn is killed

> Track: cf-spawn-kill-20261022
> Spec: [spec.md](./spec.md)
> Investigation: [investigation.md](./investigation.md)

## Overview

- **Source**: /please:plan
- **Track**: cf-spawn-kill-20261022
- **Issue**: #47
- **Created**: 2026-10-22
- **Approach**: when the stub provides `startProcess`, `streamProcessLogs` and `killProcess`, run live `spawn` through them, and route `kill()`, a caller abort, the output cap and the timeout through one terminate step that calls `killProcess`
- **Plan Depth**: standard
- **Planned At**: aac7ee9

## Context

### Problem

`spawnLive` (`cf-spawn.ts`) starts the command with `execStream` and can only cancel its own reader. Cancelling never reaches the container (investigation.md §2). The SDK's process API can stop the command: `killProcess` sends SIGTERM to the whole process tree, then SIGKILL, and resolves once the tree is gone (up to about 10 s). The real `getSandbox()` stub provides all three methods.

SDK facts the code depends on (0.11.0; investigation.md §2 and the SDK source):
- **`startProcess(command, { cwd, env, timeout })`** resolves with `{ id }` once the command has started. Its `timeout` is ignored on the default session path.
- **`streamProcessLogs(id)`** sends SSE `data: {json}` frames:
  - a first `process_info` frame, not in the SDK's types;
  - replayed buffered output (all stdout first, then all stderr);
  - live `stdout`/`stderr` frames;
  - a closing `{ type: 'exit', exitCode }`. There is no `complete` frame.
- **`exitCode` can be missing** from the `exit` frame. `getProcess(id).exitCode` is the fallback.
- **`killProcess(id)` errors:** it throws `CommandNotFoundError` for a command that has already exited, and `ProcessNotFoundError` for an unknown id.

### Non-Goals

- Everything in spec.md → Out of Scope.
- Considered and not built:
  - **Retrying a failed `killProcess`:** no evidence that transient failures happen. The real-container check in T003 would show them.
  - **Choosing our own `processId` so `kill()` can run before `startProcess` resolves:** the container answers an id it hasn't registered with `ProcessNotFoundError`, and the start then lands as an orphan. Killing the returned id once it arrives covers that window (FR-5).
  - **Calling `cleanupCompletedProcesses`:** it is a no-op stub in 0.11.0.

### STOP Conditions

- Meeting a requirement would change an existing test's assertion, such as the orphan `AbortError` wording at `cf-spawn.test.ts:283`. Ask the user first, per the repository's test-safety rule.

## Architecture Decision

**Selection.** `cfSandboxToSandbox` picks a path by stub capability:

| Stub provides | Path |
| --- | --- |
| all three process methods (with or without `execStream`) | the new process path |
| `execStream` only | today's `spawnLive`, unchanged |
| neither | the buffered path |

`getProcess` is optional: without it there is no exit-code fallback. The process methods join `CloudflareSandboxStub` as optional, structural members, so the package still does not import `@cloudflare/sandbox`.

**One terminate step.** It is memoized and calls `killProcess(id)` inside the container-death guard. It is triggered by:
- `kill()`: returns the step's promise, so `await proc.kill()` resolves once the container has confirmed the stop;
- a caller abort: fire-and-forget;
- the output cap: called from `onOverflow` directly, because `kill()` is a no-op once the controller has settled;
- the timeout.

A stop requested before `startProcess` resolves is remembered and sent once the id arrives, and the log stream is not opened. The step swallows:
- `SandboxDiedError`;
- `CommandNotFoundError` and `ProcessNotFoundError`, matched by `name` or `code`, with a message pattern as fallback if they don't survive RPC.

It never rejects `kill()` or causes an unhandled rejection. Only ids and cloneable options cross the RPC: no `Process` object methods, no `onOutput`/`onExit` callbacks, no `AbortSignal` (commit `07a60fa2`).

**Results.**
- **`kill()` or abort:** `wait()` rejects at once with today's `orphanedExecAbortError` wording (AC-002). `sandbox.ts:50-57` keeps that wording pessimistic on purpose, because the kill is not confirmed when `wait()` rejects. No existing assertion changes.
- **Timeout:** a local timer of `roundUpTimeoutMs(timeoutMs)` calls the terminate step and resolves `wait()` with 124, as `local()` does. The `timeout` option is still passed to `startProcess`.
- **Output cap:** `wait()` resolves with 1, and the notice suffix says the command is being stopped.

**Parser.** Extend `createExecStreamParser`'s event mapping with an `exit` event carrying `exitCode`, kept separate from `complete`, so an `execStream` stream can't end on an `exit` frame.

Rejected alternatives (investigation.md §3):
- killing through a second `exec` that wraps the command;
- calling `killProcess` from the kill hook only.

## Tasks

- [x] T001 [TDD] Run live spawn through the process API and stop the remote command on `kill()` and caller abort (file: packages/agent/src/cloudflare/cf-spawn.ts) [FR-1, FR-2, FR-5, FR-6, FR-7, FR-8, AC-002, AC-005, AC-006, AC-007, AC-008, AC-009, AC-011]
  Validation: the regression test made from the scratch repro (`cf-spawn-kill.repro.test.ts`) passes: no command left running after `kill()` or a caller abort, including when the stop arrives before `startProcess` resolves. Output arrives before `wait()` settles and `wait()` resolves with the `exit` code (falling back to `getProcess`), and the provider contract suite passes on a process-API stub. Container death during start, streaming or the stop rejects `wait()` with `SandboxDiedError`, `kill()` still settles, and a stop after exit doesn't reject `kill()`. Execstream-only and buffered stubs behave as before, existing tests pass unchanged, and `sandbox-api.md`'s "no remote kill" paragraph and the `sandboxes.md` cancellation paragraph describe the new behavior.
  Method: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` (incl. `cf-spawn.test.ts`, `cf-sandbox.test.ts`, the contract suite), `mise exec -- bun run check`, `mise exec -- bun run lint`, plus `packages/cli/src/lib/docs-content.test.ts`
- [x] T002 Stop the remote command at the output cap and at the `timeoutMs` deadline on the process path (file: packages/agent/src/cloudflare/cf-spawn.ts) (depends on T001) [FR-3, FR-4, AC-003, AC-004, AC-010]
  Validation: past the unread-output cap the command is stopped, `wait()` resolves 1, and the notice says the command is being stopped (an execStream-only stub keeps "may still be running"). At a `timeoutMs` of 1500.4 the command is stopped no earlier than 1501 ms and `wait()` resolves 124. One `killProcess` call however many of `kill()`, abort, cap and timeout fire, and the timer is cleared on every settlement.
  Method: `mise exec -- bunx turbo run test --filter=@amond-ai/agent`
- [x] T003 Smoke-test kill, abort and timeout on a real Cloudflare Sandbox container (file: packages/agent/src/cloudflare/cf-spawn.ts) (depends on T002) [FR-1, AC-001]
  STOP: before deploying a Worker or starting a container, ask the user for approval. It is billable and outward-facing. Run wrangler OAuth commands as `env -u CLOUDFLARE_API_TOKEN` and never print a token.
  STOP: if the real container's `streamProcessLogs` frames or `killProcess` errors differ from the shapes in Context, stop and report before changing the parser or error matching.
  Validation: under `@cloudflare/sandbox` 0.11.0, `kill()` 2.5 s into a 1-line-per-second loop leaves no line in its log after `kill()` settles (AC-001). A caller abort and a 2 s `timeoutMs` (exit 124) do the same, and live output still arrives before exit. Results go in Surprises & Discoveries, the temporary Worker and container application are deleted afterwards, and TD-010 moves to Resolved in `tech-debt-tracker.md`.
  Method: temporary Worker driven with `wrangler dev`/`wrangler deploy` as in ai-sdk-sandbox-20261020 T010; `wrangler delete` and `wrangler containers delete` afterwards

## Key Files

- Modify: `packages/agent/src/cloudflare/cf-spawn.ts` (`spawnLive`, parser event mapping), `packages/agent/src/cloudflare/cf-sandbox.ts` (`CloudflareSandboxStub`, `cfSandboxToSandbox` selection)
- Test: `packages/agent/src/cloudflare/cf-spawn.test.ts`, `packages/agent/src/cloudflare/cf-sandbox.test.ts` (third contract variant), `packages/agent/src/__contract__/fake-cloudflare-stub.ts` (process-API fake), the untracked scratch `cf-spawn-kill.repro.test.ts` (becomes the regression test)
- Reuse: `createProcessController` (`sandbox-streams.ts`), `orphanedExecAbortError` (`sandbox.ts`), `roundUpTimeoutMs`/`abortErrorFor` (`abort.ts`), `local()`'s live spawn (`node/local-env.ts:216-250`) as the kill/overflow/timeout model
- Docs: `packages/cli/docs/reference/sandbox-api.md` (table row and "no remote kill" paragraph), `packages/cli/docs/guide/sandboxes.md` (cancellation paragraph), `.please/docs/tracks/tech-debt-tracker.md` (TD-010)

## Verification

### Observable Outcomes

- [x] The regression test made from the scratch repro fails on `aac7ee9` and passes after T001.
- [x] `mise exec -- bun run lint`, `mise exec -- bun run build`, `mise exec -- bun run check` and `CI=true mise exec -- bun run test` all pass.
- [x] On a real container, a killed, aborted or timed-out live spawn stops printing (T003, recorded in Surprises & Discoveries).

## Review Focus

- Frames on the process log stream: `process_info`, unknown types, an `exit` without `exitCode`, a stream that closes with no `exit` frame. Owner: T001.
- Error shapes from `killProcess` after crossing the Durable Object RPC: whether `name` and `code` survive. Owner: T001. T003 checks them on a real container.
- A stub that has only some of the process methods. Owner: T001.
- A fractional or very small `timeoutMs`. Owner: T002.

## Progress

- [x] (2026-10-22 13:30 KST) T001 Run live spawn through the process API and stop the remote command on `kill()` and caller abort
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` -> 309 passed | 8 skipped (repro red before fix, 2 failed; green after); `bun run check`, `bun run lint` exit 0; `docs-content.test.ts` 14 passed
  Note: the process-API fake (`fakeProcessStub`) lives in `cf-sandbox.test.ts` beside `fakeStreamingStub`, not in `__contract__/fake-cloudflare-stub.ts`; the scratch repro was folded into `cf-spawn.test.ts` and deleted.
- [x] (2026-10-22 13:35 KST) T002 Stop the remote command at the output cap and at the `timeoutMs` deadline on the process path
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` -> all pass (cap, 1500.4 ms -> stop at 1501 ms with exit 124, one killProcess, timer cleared on every settlement); `bun run check`, `bun run lint` exit 0
- [x] (2026-10-22 15:00 KST) T003 Smoke-test kill, abort and timeout on a real Cloudflare Sandbox container
  Evidence: temporary Worker on `@cloudflare/sandbox` 0.11.0 (deploy approved by the user), each loop writing one line per second to a log file:
  - `kill()` at 2.5 s: `kill()` settled at 3279 ms, log at 3 lines then 3 lines 4 s later (AC-001, AC-011)
  - caller abort at 2.5 s: `wait()` rejected at 2500 ms, log at 3 lines then 3 lines
  - `timeoutMs: 2000`: `wait()` resolved 124 at 2000 ms, log at 2 lines then 2 lines
  - live: output arrived about 1 s apart before `wait()` resolved 3 at 4048 ms
  - `kill()` after exit resolved
  - Cleanup: `wrangler delete` and `wrangler containers delete` done; the Worker URL returns 404 and the container list is empty.
- [x] (2026-10-22 17:15 KST) Review-stage commits (SHA: `3bd2c2ff`, `89dc37b4`)

## Decision Log

- (2026-10-22) **Review known issues.** The `/please:review` ensemble loop ran two iterations. Iteration 1 fixed a later `kill()` resolving before the pending stop (Critical) and a `timeoutMs` above 2^31-1 ms firing at once (`3bd2c2ff`). Iteration 2 found nothing to fix and ended `needs_human_read` only because Greptile is enabled but its CLI is not installed. These Minor findings were kept as plausible but unproven, and are left as they are:
  - `toEvent` reads an `error` frame's message from `error`; the SDK's process-log type carries it in `data`.
  - `sandbox-api.md` and the `spawnProcess` JSDoc say `kill()` confirms the stop, but an unexpected `killProcess` failure is only logged.
  - `kill()` has no deadline while `startProcess` is pending on a live container.
  - The `startProcess` result's RPC stubs are not disposed, and its "id-only" comment is loose.
  - A `complete` frame on the process log stream is ignored. The real container sends `exit`.
  - The `getProcess` fallback does not reject a `null` exit code.
  - A misdetected container death during `startProcess` would orphan the started command.
  - The not-found message fallback in `isExpectedStopError` is loose.
  - The `raceContainerDeath` comment does not name `spawnProcess`.
  - `docs/specs/sandbox/spec.md` REQ-006 still described Cloudflare live spawn as execStream-only. `/please:finalize` updated REQ-006 alone through a one-line delta; the bugfix FRs were not merged as new product requirements.

## Surprises & Discoveries

- **The real `streamProcessLogs` frames and `killProcess` errors matched Context.** Frames arrived as `process_info`, then stdout and stderr, then `{type:'exit', exitCode}`, and the stream closed. `getProcess(id)` returned `{status:'failed', exitCode:3}`. Neither T003 STOP condition fired, and the parser and error matching are unchanged.
- **A command that ends in a bare `exit N` kills the session shell.** This is how the SDK's default session works; it was there before this fix and is not something it introduced. The `execStream` stream and the process log stream both stop after the last output and never complete, so `spawn` hangs unless `timeoutMs` is set. `run` rejects with `SessionTerminatedError: Session '…' shell exited (exit code: 3)`. The next command still runs (`echo alive` → 0). Wrapping the command (`sh -c '…; exit 3'`) avoids it. Worth its own issue, outside #47's scope.
- **One sandbox per `max_instances: 1` app.** A request on a fresh sandbox id waited for a container slot and looked like a hang. Reusing one id fixed it. This only affects the smoke harness.

## Outcomes & Retrospective

### What Was Shipped
- Live `spawn` on `cloudflareSandbox` runs through the SDK process API when the stub has `startProcess`, `streamProcessLogs` and `killProcess`. One memoized stop calls `killProcess` for `kill()`, a caller abort, the unread-output cap and a local `timeoutMs` deadline (exit 124). A stop that arrives before the id is sent once the id arrives.
- A later `kill()` waits for the pending stop, and a `timeoutMs` above the `setTimeout` limit is armed in segments. Both came from the review.
- An execStream-only stub keeps the old path and wording. The docs and product spec REQ-006 describe the remote stop. TD-010 is resolved.

### What Went Well
- Reading the SDK source before planning settled the frame shapes, error names and the ignored `timeout`, and the real-container smoke test then matched them, so neither T003 STOP condition fired.
- The raw-frame smoke case found the bare-`exit` session behavior quickly, instead of leaving it as an unexplained hang.
- Three engines (gpt, cubic, builtin) independently found the `kill()`-after-settlement gap, and the validator confirmed it before the fix pass.

### What Could Improve
- The plan's docs promised that `kill()` confirms the stop, but no test covered a second `kill()` after the process settled. A test for each documented promise would have caught it before review.
- Greptile is enabled in `.please/config.yml` but its CLI is not installed, so every ensemble run ends `needs_human_read` instead of `no_issues`. Install it or disable the engine.
- The track spec had no `product_spec_domain`, so the product-spec sync needed a hand-built delta. Set it in bugfix specs that change an existing product requirement.

### Tech Debt Created
- TD-015: unproven edge cases left on the process path (see Decision Log).
- TD-016: a command ending in a bare `exit N` hangs a Cloudflare `spawn` (pre-existing, found by the smoke test).

