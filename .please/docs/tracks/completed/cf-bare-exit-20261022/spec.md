# Bug Fix: A bare `exit N` hangs a Cloudflare spawn

> Track: cf-bare-exit-20261022
> Issue: #52 (sub-issue of #15; tech debt TD-016)
> Investigation: [investigation.md](./investigation.md)

## Overview

On a Cloudflare sandbox, a command that ends with a bare `exit N`, such as `echo before; exit 3`, ends the long-lived shell the Cloudflare SDK runs commands in, rather than ending just the command. The SDK then never reports the exit code:

- `run` fails with `SessionTerminatedError`;
- a live `spawn` keeps its output stream open, and `wait()` never settles unless `timeoutMs` is set.

The same command on `local()` reports exit code 3, so behavior depends on the provider. Other commands that end the shell fail the same way, such as a failing step under `set -e`, `exec`, or a syntax error (FR-2 lists them).

## Reproduction

1. Create a sandbox with `cloudflareSandbox(getSandbox(env.Sandbox, id))`.
2. Call `sandbox.run({ command: 'echo before; exit 3' })`.
3. Call `sandbox.spawn({ command: 'echo before; exit 3' })` and await `wait()`.

**Expected:** both report exit code 3, with `before` on stdout. The next command on the sandbox runs normally.

**Actual:**

- `run` rejects with `SessionTerminatedError: Session '…' shell exited (exit code: 3)`.
- `spawn` delivers `before`, then its stream stays open, and `wait()` never settles without `timeoutMs`.
- The next command runs normally.

## Root Cause

`cloudflareSandbox` passes the caller's command unchanged into the SDK's session shell. A command that ends that shell takes the SDK's completion report with it, and amond's stream readers wait for a final event that never arrives. See investigation.md Section 2.

## Requirements

### Functional Requirements

- [ ] FR-1: report the exit code and output of a command that ends with an `exit` builtin, for `run` and for `spawn`, on every Cloudflare sandbox shape: the process API, `execStream` only, and neither.
- [ ] FR-2: report an exit code, instead of failing or hanging, for any command that would otherwise end the SDK's session shell: a failing step under `set -e`, `exec`, an `EXIT` trap, a syntax error, an unbalanced quote, or an unterminated heredoc.
- [ ] FR-3: keep delivering the caller's working directory and environment variables to the command.
- [ ] FR-4: keep `kill()` and a caller abort stopping a spawned command in the container.
- [ ] FR-5: run each command in a fresh shell scope, so that `cd` and `export` in one command do not carry over to the next. This matches `local()`; the guide's Cloudflare section states it.
- [ ] FR-6: keep the result of every command that already completes correctly today unchanged, including empty and comment-only commands and commands that contain quotes or heredocs.

## Acceptance Criteria

- [ ] AC-001 (FR-1): When `run` executes `echo before; exit 3`, the system shall resolve with exit code 3 and stdout `before\n`.
- [ ] AC-002 (FR-1): When `spawn` executes `echo before; exit 3` on a sandbox with the process API, `wait()` shall resolve to exit code 3 without `timeoutMs`, and stdout shall deliver `before\n`.
- [ ] AC-003 (FR-1): When `spawn` executes `echo before; exit 3` on a sandbox with `execStream` and no process API, `wait()` shall resolve to exit code 3 without `timeoutMs`, and stdout shall deliver `before\n`.
- [ ] AC-004 (FR-1): When `spawn` executes `echo before; exit 3` on a sandbox with neither streaming method, `wait()` shall resolve to exit code 3, and stdout shall deliver `before\n`.
- [ ] AC-005 (FR-1): When a command that ended with a bare `exit` has finished, the next `run` on the same sandbox shall run and report its own exit code.
- [ ] AC-006 (FR-2): If a command is a syntax error such as `echo (`, then `run` shall resolve with exit code 2 and the shell's error on stderr.
- [ ] AC-007 (FR-6): If a command is empty or only a comment, then `run` shall resolve with exit code 0.
- [ ] AC-008 (FR-2): If a command runs `set -e; false; echo x`, then `run` shall resolve with exit code 1 and without `x` on stdout.
- [ ] AC-009 (FR-2): If a command runs `exec` on another program, then `run` shall resolve with that program's exit code.
- [ ] AC-010 (FR-3): When `run` executes a command that prints `$NAME` and the working directory, with `env: { NAME: 'v' }` and a working directory other than the default, the system shall print `v` and that directory.
- [ ] AC-011 (FR-6): When a command contains single quotes, such as `printf '%s\n' 'it'"'"'s'`, the system shall run it unchanged and print `it's`.
- [ ] AC-014 (FR-2): If a command runs `trap 'echo bye' EXIT; exit 2`, then `run` shall resolve with exit code 2 and stdout `bye\n`.
- [ ] AC-015 (FR-2): If a command has an unbalanced quote, such as `echo "abc`, then `run` shall resolve with a nonzero exit code instead of hanging.
- [ ] AC-012 (FR-4): When `kill()` is called on a spawned multi-command loop on a real Cloudflare container, the loop shall stop writing within a second.
- [ ] AC-013 (FR-5): When one `run` executes `export Z=1` and the next `run` prints `$Z`, the second command shall print an empty line.

## Verification

- **Unit tests.** Tests under `packages/agent/src/cloudflare/` cover AC-001 to AC-011, AC-013, AC-014 and AC-015. They use a stub that models the SDK's session shell: the command runs, followed by a completion step that a shell exit skips. The stub is applied to all three sandbox shapes.
- **Existing tests.** Two existing tests in `cf-spawn.test.ts` assert the exact command string the stub receives. They are updated to expect the wrapped command, and none of their other expectations change. The user approved this on 2026-10-22.
- **Real container.** A check on a real Cloudflare container covers AC-001, AC-002, AC-003, AC-005, AC-010 and AC-012, using the worker from #51. Deploying it is a billable, outward-facing action, so it runs only with the user's approval at that point.

## Assumptions

- The SDK appends its completion step after the command, in the same shell. The real-container `sh -c` success supports this; the check confirms it.
- No caller relies on `export` carrying over between commands on Cloudflare. It carries over today, because every command shares one SDK session shell (the SDK resets only the per-command `env` option). But no test or doc promises it, `local()` does not do it, and it is already lost whenever the session restarts. `cd` does not carry over today either, because the working directory is passed with every command.

## Out of Scope

- Commands that kill the session shell from inside, such as `kill $$`. They behave as today.
- A command that backgrounds a job (`cmd &`) and returns. The job keeps running unsupervised, as today.
- An idle bound or liveness check for streams that stop without a final event for any other reason (`cf-spawn.ts:221`, `:374`). This could be a separate follow-up.
- Sharing `shellQuote` with the second private copy in `agent.ts:750`.
