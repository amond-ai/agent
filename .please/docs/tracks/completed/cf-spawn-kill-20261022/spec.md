# Bug Fix: Stop the remote command when a live Cloudflare spawn is killed

> Track: cf-spawn-kill-20261022
> Investigation: [investigation.md](./investigation.md)
> Issue: #47 (tech debt TD-010), a follow-up to #15

## Overview

On a Cloudflare sandbox, a command started with `spawn` streams its output while it runs. Calling `kill()` on it, or aborting the caller's signal, releases the caller at once, but the command keeps running in the container until it exits or reaches its timeout. When unread output passes the output cap, the command also keeps running, and the notice says so. A user who stops a command expects it to stop: a runaway loop or a dev server should not keep using the container.

## Reproduction

1. Create a Cloudflare sandbox from a stub that supports streaming commands.
2. Spawn a long-running command, such as an 8-line loop that prints a line every second.
3. Call `kill()` after 2.5 seconds.

**Expected:** `wait()` settles, and the command stops in the container.
**Actual:** `wait()` rejects at once, but the loop keeps printing lines in the container. On a real container it had printed 7 of its 8 lines by about 6.5 seconds.

## Root Cause

Stopping a live spawn only stops reading its output locally. Nothing is sent to the container, and the way the command is started gives no handle to stop it. The output-cap path has the same gap separately: by the time the cap is hit, the process is already marked finished, so it cannot go through `kill()`. See investigation.md, Section 2.

## Requirements

### Functional Requirements

A *live spawn* below is a `spawn` on a Cloudflare stub that provides the SDK's process methods, which start a command, follow its output, and stop it. FR-1 to FR-6 and FR-8 apply to a live spawn. FR-7 covers a stub that offers streaming commands without those methods.

- [ ] FR-1: stop the command in the container when `kill()` is called on a live spawn
- [ ] FR-2: stop the command in the container when the caller's abort signal fires during a live spawn
- [ ] FR-3: stop the command in the container when a live spawn exceeds its unread-output cap
- [ ] FR-4: stop the command in the container when a live spawn reaches its `timeoutMs` deadline
- [ ] FR-5: stop a command whose `kill()` or abort arrived before the container finished starting it, as soon as it starts
- [ ] FR-6: settle `kill()` and `wait()` without hanging or an unhandled rejection when stopping fails because the command already exited, the container no longer knows it, or the container died
- [ ] FR-7: keep today's behavior for a Cloudflare stub that offers streaming commands but not the process methods
- [ ] FR-8: keep delivering a live spawn's output while the command runs, and resolve `wait()` with the command's exit code when it finishes

## Acceptance Criteria

- [ ] AC-001 (FR-1): When `kill()` is called 2.5 seconds into a spawned loop on a real Cloudflare Sandbox container that prints a line every second, the system shall stop the command so that no line is printed after `kill()` settles (the bug shall not reproduce).
- [ ] AC-002 (FR-1, FR-2): When `kill()` is called or the caller aborts during a live spawn, the system shall reject `wait()` at once with the same `AbortError` wording it uses today, without waiting for the container to confirm the stop.
- [ ] AC-003 (FR-3): When a live spawn's unread output exceeds the cap, the system shall write a stderr notice that says the command is being stopped, not that it may still be running.
- [ ] AC-004 (FR-4): When a live spawn reaches its `timeoutMs` deadline, the system shall resolve `wait()` with exit code 124.
- [ ] AC-005 (FR-1, FR-2): If `kill()` is called twice, or `kill()` and an abort both happen, then the system shall send one stop request to the container.
- [ ] AC-006 (FR-6): If the command has already exited when a stop is requested, then the system shall not reject `kill()`.
- [ ] AC-007 (FR-6): If the command has already exited when a stop is requested, then the system shall keep the result `wait()` settled with first.
- [ ] AC-008 (FR-6): If the container dies while a live spawn is starting or running and no stop has settled it, then the system shall reject `wait()` with `SandboxDiedError`. A `kill()` or abort that came first keeps its `AbortError`.
- [ ] AC-009 (FR-6): If the container dies while a stop is in progress, then the system shall settle `kill()`.
- [ ] AC-010 (FR-7): Where a Cloudflare stub offers streaming commands but not the process methods, the system shall keep today's output-cap notice saying the command may still be running.
- [ ] AC-011 (FR-8): When a live-spawned command prints a line and keeps running, the system shall deliver that line before `wait()` settles.

## Out of Scope

- `run` aborts, and `spawn` on a stub without streaming commands. Both go through the buffered path, whose orphaned command is reported through `onOrphanSettled`.
- `@cloudflare/sandbox` 1.x support (#50).
- How a failed live spawn reports its error (#49).
- Cleaning up the process records the container keeps after a command exits. The SDK keeps them until the container stops.

## Assumptions

- The Cloudflare Sandbox SDK's process methods (`startProcess`, `streamProcessLogs`, `killProcess`) behave in 0.11.0, the version the Cloudflare blueprint installs, as its source reads. The real stub that `getSandbox()` returns provides them, so every live spawn on a real container moves to them, and FR-8 guards against losing today's live output. The real-container check (AC-001) confirms this.
- Output the container produced before a live spawn started following it is delivered all stdout first, then all stderr, so their relative order inside that first burst can differ from today's. Running it creates a billable Cloudflare resource, so it needs the user's approval at that time.
- The container stops a killed command's whole process tree, first with SIGTERM and then with SIGKILL, and this can take up to about 10 seconds. `kill()` may resolve after that wait. `wait()` does not wait for it (AC-002).
- `timeoutMs` is not enforced by the container on its default transport for either way of starting a command (investigation.md, hypothesis 5). The fix therefore enforces it, which AC-004 checks.
