# Plan: Stop a bare `exit N` from hanging a Cloudflare spawn

> Track: cf-bare-exit-20261022
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: cf-bare-exit-20261022
- **Issue**: #52
- **Created**: 2026-10-22
- **Approach**: `cloudflareSandbox` runs every caller command as `( eval ' <command>' )`, so anything that would end the SDK's session shell ends only a subshell, and the SDK still reports the exit code.
- **Testing**: tdd
- **Plan Depth**: lightweight
- **Planned At**: 0e530e7

## Context

### Problem

The root cause and evidence are in [investigation.md](./investigation.md). A command reaches the stub unchanged at three points:

- the driver's `exec` (`cf-sandbox.ts:347`), which serves `run` and the buffered `spawn`;
- `spawnLive`, which calls `stub.execStream`;
- `spawnProcess`, which calls `stub.startProcess`.

The scratch loop `packages/agent/src/cloudflare/bare-exit.loop.test.ts` (`[DEBUG-6746]`, untracked) reproduces the bug: 6 of its 7 tests fail today.

The user approved two decisions on 2026-10-22:

- Dropping the `export` carry-over between commands (FR-5).
- Updating the two exact-command assertions in `cf-spawn.test.ts` (lines ~239 and ~565) to the wrapped command. Nothing else in those tests changes.

### Non-Goals

Set by the spec: `kill $$`, orphaned background jobs, an idle bound on the stream readers, and sharing `shellQuote` with `agent.ts`.

Considered and not built:

- **Catching `SessionTerminatedError` as a fallback.** Once commands are wrapped, the session shell can only end by `kill $$`, which is out of scope. Evidence that would change this: the real-container check still shows `SessionTerminatedError` with the wrapper in place.

## Architecture Decision

- **Wrap in `cf-sandbox.ts`, not in `cf-spawn.ts`.**
  - The wrap goes at the driver's `exec` and at the two `spawn:` routes, which pass `{ ...options, command: wrap(options.command) }`.
  - It reuses the module-private `shellQuote`.
  - `cf-spawn.ts` cannot import values from `cf-sandbox.ts` without an import cycle, and wrapping one level up keeps `spawnLive` and `spawnProcess` unaware of it.
- **Leave the internal commands unwrapped.** amond's own `stat`, `find` and `rm` commands call `stub.exec` directly and contain no `exit`.
- **Use `( eval '…' )`.**
  - Unlike `bash -c` / `sh -c`, the subshell inherits the variables the SDK sets for the `env` option. With `bash -c`, the fake's `env` contract tests fail, and the SDK does not document that it exports them.
  - Unlike a bare newline subshell, `eval` turns a parse error, an empty command or a comment-only command into an exit status instead of a dead session.
  - It is POSIX.
- **Report the caller's command in errors.** Any error or orphan report shows the caller's command, not the wrapped string. The wrap changes only what the stub receives.

## Tasks

- [x] T001 Run each caller command in its own subshell on `cloudflareSandbox`, with regression tests and docs (file: packages/agent/src/cloudflare/cf-sandbox.ts) [FR-1, FR-2, FR-3, FR-5, FR-6, AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-013, AC-014, AC-015]
  Validation: a stub that models the SDK session shell makes `echo before; exit 3` resolve `run` and `spawn` `wait()` to exit code 3 with stdout `before\n` on the process-API, `execStream`-only and buffered shapes, without `timeoutMs`; the spec's unit-test ACs (AC-001–011, 013–015) pass on that stub; the shared sandbox contract stays green on all three shapes; the two exact-command assertions in `cf-spawn.test.ts` change only their expected command string; errors and orphan reports name the caller's unwrapped command; the scratch loop file is deleted; `sandbox-api.md`'s `cloudflareSandbox` section and the guide's remote-sandbox section state that each command runs in its own shell scope, so `cd` and `export` do not carry over, as on `local()`.
  Method: `mise exec -- npx vitest run src/cloudflare/ src/__contract__/` in `packages/agent`, plus the repo's typecheck and lint
- [x] T002 Confirm the fix on a real Cloudflare container and resolve TD-016 (file: .please/docs/tracks/tech-debt-tracker.md) (depends on T001) [FR-4, AC-012]
  Validation: on a real container, with the fixed package: `run` and both live `spawn` paths report exit code 3 and `before` for `echo before; exit 3`; the next command runs; `env` and `cwd` reach the command; `kill()` stops a multi-command loop. TD-016 moves to Resolved, pointing at this track.
  Method: the #51 smoke worker (`/tmp/amond-t003`, cases `bareexit`, `live`, `kill`) redeployed only after the user approves the deploy, with each JSON result recorded in this plan
  STOP: the wrapped command still ends the session or hangs on the real container (the SDK does not append its completion step the way the investigation assumes); or `kill()` leaves the wrapped command running

## Key Files

- Modify: `packages/agent/src/cloudflare/cf-sandbox.ts`: the driver's `exec` (~347), the `spawn:` routes (~372, ~376), and `shellQuote` (~128), which the wrap reuses.
- Modify: `packages/agent/src/__contract__/fake-cloudflare-stub.ts` or `src/cloudflare/cf-sandbox.test.ts`: the session-shell model, taken from the scratch loop.
- Modify: `packages/agent/src/cloudflare/cf-spawn.test.ts`: the two exact-command assertions (~239, ~565).
- Modify: `packages/cli/docs/reference/sandbox-api.md` (`cloudflareSandbox`, ~436) and `packages/cli/docs/guide/sandboxes.md` (Remote sandboxes, ~139).
- Delete: `packages/agent/src/cloudflare/bare-exit.loop.test.ts`.
- Reuse: `define-sandbox-contract.ts` already asserts a bare `exit 3` / `exit 4`. Running it over the session model turns those cases into regression tests.

## Verification

### Observable Outcomes

- `echo before; exit 3` reports exit code 3 and `before` through `run` and `spawn` on all three stub shapes, without `timeoutMs`. Proven by the T001 unit tests; the scratch loop's scenarios pass before the file is deleted.
- The same holds on a real Cloudflare container, and `kill()` still stops a wrapped loop. Proven by T002. Deploying is billable and outward-facing, so it waits for the user's go-ahead.

## Review Focus

- A command with a CRLF line ending or a trailing backslash → the same exit code and output as on `local()` (T001).
- A command containing single quotes, or starting with `-` → runs unchanged; quoting does not alter it (T001).
- An empty or whitespace-only command → exit code 0 on every stub shape (T001).
- An abort, kill or timeout on a wrapped command → error messages and orphan reports name the caller's command, not `( eval … )` (T001).

## Progress

- [x] (2026-10-22 23:01 KST) T001 Run each caller command in its own subshell on `cloudflareSandbox`, with regression tests and docs
  Evidence: after the POSIX revise (leading-space wrapper), `mise exec -- npx vitest run src/cloudflare/ src/__contract__/` (packages/agent) → 2 files, 199 passed, 3 skipped (red before the fix: 30 failed); `CI=true bun run test` → 22/22 tasks green; `bun run check` and `bun run lint` exit 0
  Deferred: AC-012 and the `bye` output of AC-014 — need a real container (T002)

- [x] (2026-10-22 23:15 KST) T002 Confirm the fix on a real Cloudflare container and resolve TD-016
  Evidence: smoke worker `amond-t003-smoke-980df587` (SDK 0.11.0, image `cloudflare/sandbox:0.11.0`) with the package at `c618d9f7`, deployed with the user's approval and deleted afterwards (worker and container application). `case=fixed`:
  - `run` gives exitCode 3 and stdout `before` (the SDK trims the trailing newline).
  - `spawn` (process API) and `spawn` (execStream only) give `wait()` → exitCode 3 and stdout `before\n`.
  - `envcwd` gives `v` and `/workspace/sub`; `export` gives `[]`; `syntax` gives exitCode 2 with the bash syntax error on stderr; `trap` gives `bye` and exitCode 2; `-x` gives exitCode 127.
  - After each case, the next command `echo alive` exits 0.
  - `case=kill` and `case=abort` stop the multi-command loop at 3 lines, still 3 lines four seconds later.
  TD-016 moved to Resolved.

- [x] (2026-10-23 17:17 KST) Review-stage commits (SHA: `9ae767e8`, `e38ea657`, `36bf885d`, `94772cdc`)

## Decision Log

- 2026-10-22: Wrapper form `( eval '…' )` chosen over `bash -c` and a bare subshell (investigation.md Section 3).

- Decision: wrapper is `( eval ' <command>' )`, with a leading space inside the quoted argument.
  Rationale: without it, bash reads a command that starts with `-` as an `eval` option (`eval '-x'` gives "invalid option", exit 2, not 127). `eval --` fixes that in bash but is not POSIX: dash runs `--` as a command (`eval: --: not found`, 127), so `--` was ruled out.
  Date/Author: 2026-10-22 / implement-executor

## Surprises & Discoveries

- The first request after the deploy timed out at 15 s for both `run` and the following `echo alive` while the container cold-started. The two re-runs on the warm container passed. The SDK session shell on the real container is bash (`bash: eval: line 469: …`).

- Observation: just-bash diverges from real bash on three ACs. Inside `eval`, a syntax error gives exit 1 (real bash: 2, AC-006); `trap` is not implemented ("command not found"), so AC-014 cannot print `bye`; `exec` does not end the shell, so AC-009 passes without the wrapper.
  Evidence: probe of `( eval '…' )` over just-bash on 2026-10-22. The unit tests assert a nonzero code with "syntax error" on stderr (AC-006) and exit 2 (AC-014); T002 must confirm exit 2 and `bye` on a real container.

## Outcomes & Retrospective

### What Was Shipped

- `cloudflareSandbox` runs each caller command as `( eval ' <command>' )`, at the driver `exec` and both live `spawn` routes. A bare `exit N`, a failing `set -e` step, `exec` or a syntax error now reports an exit status through `run` and `spawn`, instead of rejecting with `SessionTerminatedError` or hanging.
- The test fake models the SDK's session shell, and the scope tests run over the buffered, `execStream` and process-API stub shapes.
- Two test-only stubs prove the wrapper is load-bearing: `persistentSessionStub` shows `cd` and `export` do not carry over, and `execReplacesShellStub` shows an `exec`-ed program's exit code is reported.
- The guide and the sandbox API reference state that each command runs in its own shell scope.
- Verified on a real Cloudflare container (SDK 0.11.0). TD-016 is resolved.

### What Went Well

- The scratch failing-test loop from the investigation became the session-shell model in the committed tests, so the bug was reproduced on all three stub shapes before the fix.
- The real-container smoke worker from #51 was reused, which caught that the session shell is bash and settled AC-012 and the `bye` output of AC-014.
- Review found tests that passed with the wrapper removed (AC-009, AC-013, the abort-message test). Each was strengthened and checked to fail with the wrapper removed.

### What Could Improve

- just-bash diverges from bash on `exec`, `trap` and syntax-error codes, so several tests first proved less than their titles claimed. Running a "remove the fix" check on each new regression test during implementation would have caught this before review.
- The review ran four ensemble iterations. Repeated findings with new wording (kill reach, the three wrap sites, `cd`/`export` persistence) cost validator passes each time, because the rejected-findings ledger matches only on exact titles.
- greptile was not installed, so every review exit was `needs_human_read` rather than `no_issues`.

### Tech Debt Created

- TD-017: wrapper edge cases kept as plausible in review. They are kill reach on a single long-running child, the `execReplacesShellStub` regex, trap output on just-bash, and the fake's completion marker.
