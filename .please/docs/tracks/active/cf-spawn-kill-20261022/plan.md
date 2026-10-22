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

- [ ] T001 [TDD] Run live spawn through the process API and stop the remote command on `kill()` and caller abort (file: packages/agent/src/cloudflare/cf-spawn.ts)
  Validation: the regression test made from the scratch repro (`cf-spawn-kill.repro.test.ts`) passes: no command left running after `kill()` or a caller abort, including when the stop arrives before `startProcess` resolves. Output arrives before `wait()` settles and `wait()` resolves with the `exit` code (falling back to `getProcess`), and the provider contract suite passes on a process-API stub. Container death during start, streaming or the stop rejects `wait()` with `SandboxDiedError`, `kill()` still settles, and a stop after exit doesn't reject `kill()`. Execstream-only and buffered stubs behave as before, existing tests pass unchanged, and `sandbox-api.md`'s "no remote kill" paragraph and the `sandboxes.md` cancellation paragraph describe the new behavior.
  Method: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` (incl. `cf-spawn.test.ts`, `cf-sandbox.test.ts`, the contract suite), `mise exec -- bun run check`, `mise exec -- bun run lint`, plus `packages/cli/src/lib/docs-content.test.ts`
- [ ] T002 Stop the remote command at the output cap and at the `timeoutMs` deadline on the process path (file: packages/agent/src/cloudflare/cf-spawn.ts) (depends on T001)
  Validation: past the unread-output cap the command is stopped, `wait()` resolves 1, and the notice says the command is being stopped (an execStream-only stub keeps "may still be running"). At a `timeoutMs` of 1500.4 the command is stopped no earlier than 1501 ms and `wait()` resolves 124. One `killProcess` call however many of `kill()`, abort, cap and timeout fire, and the timer is cleared on every settlement.
  Method: `mise exec -- bunx turbo run test --filter=@amond-ai/agent`
- [ ] T003 Smoke-test kill, abort and timeout on a real Cloudflare Sandbox container (file: packages/agent/src/cloudflare/cf-spawn.ts) (depends on T002)
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

- [ ] The regression test made from the scratch repro fails on `aac7ee9` and passes after T001.
- [ ] `mise exec -- bun run lint`, `mise exec -- bun run build`, `mise exec -- bun run check` and `CI=true mise exec -- bun run test` all pass.
- [ ] On a real container, a killed, aborted or timed-out live spawn stops printing (T003, recorded in Surprises & Discoveries).

## Review Focus

- Frames on the process log stream: `process_info`, unknown types, an `exit` without `exitCode`, a stream that closes with no `exit` frame. Owner: T001.
- Error shapes from `killProcess` after crossing the Durable Object RPC: whether `name` and `code` survive. Owner: T001. T003 checks them on a real container.
- A stub that has only some of the process methods. Owner: T001.
- A fractional or very small `timeoutMs`. Owner: T002.

## Progress

## Decision Log

## Surprises & Discoveries
