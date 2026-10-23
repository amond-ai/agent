## Bug Investigation Report

### 1. Reproduction Status

Reproduced: on a real Cloudflare container (Sandbox SDK 0.11.0, 2026-10-22) and with a session-shell model in a unit test.

**Reproduction path:**

1. `packages/agent/src/sandbox.ts:497-511`: `run` (and the buffered `spawn` through `spawnFromRun`, `sandbox.ts:185-207`) calls the driver's `exec`.
2. `packages/agent/src/cloudflare/cf-sandbox.ts:347`: the driver's `exec` passes the caller's command unchanged to `stub.exec`. `spawnLive` (`cf-spawn.ts:209`, `stub.execStream`) and `spawnProcess` (`cf-spawn.ts:404`, `stub.startProcess`) do the same.
3. **Failure point:** the SDK runs the command in its long-lived session shell and reports completion from a step that runs after the command in that same shell. A bare `exit 3` ends the shell first:
   - `exec` rejects with `SessionTerminatedError: Session '…' shell exited (exit code: 3)`.
   - The `execStream` and `streamProcessLogs` streams deliver `before` and then stay open. The read loops at `cf-spawn.ts:220-236` and `cf-spawn.ts:368-391` have no idle bound, so `wait()` never settles unless `timeoutMs` is set.

Real-container results (worker `case=bareexit` and `case=raw`):

- `run`: `SessionTerminatedError … (exit code: 3)`.
- `execStream`: `start` and `stdout before\n`, then no result within 15 s.
- process API: output, then no `exit` event; `getProcess(id)` then returns HTTP 500.
- The next command on the same sandbox runs normally (`echo alive` exits 0).
- `sh -c 'echo before; exit 3'` reports exit code 3 on both paths.

### Feedback Loop

- **Loop type:** failing test.
- **How to run:** not committed. The scratch loop file was untracked and was deleted once the regression tests landed (see below); its session model now lives in `fake-cloudflare-stub.ts` and the scope tests in `cf-sandbox.test.ts`.
- **Model:** `bare-exit.loop.test.ts` models the SDK session over the just-bash fake. It runs the command, then a completion marker. A missing marker means the session shell ended: `exec` throws `SessionTerminatedError`, and the streams stay open after the last output.
- **Pass/fail criteria:**
  - All 7 tests green = fixed.
  - Today 6 fail and 1 passes: `run` rejects on the buffered, `execStream` and process stubs; the buffered `spawn` rejects; `execStream` and process-API `wait()` hang past the 1500 ms cap. The passing test is the `sh -c` workaround.
- **Reproduction rate:** N/A (deterministic, about 4 s).
- **Debug tag:** `[DEBUG-6746]`. Only the scratch loop file carries it; no instrumentation was added to source.
- **Bypass approved:** no.

The loop file is scratch and untracked. Its session-model stub moves into the committed tests, and the file is deleted once the regression tests land.

### Hypothesis Ranking

- **Ranked list:**
  1. The command runs directly in the SDK's session shell · wrapping it in a child shell inside `cloudflareSandbox` makes all 6 failing loop tests pass.
  2. The wrapper's form matters for `env` · a `bash -c`/`sh -c` wrapper fails the contract's `env` tests on the fake, and a subshell passes them.
  3. The SDK's completion step runs in the session after the command · a subshell wrapper also yields exit code 3 on a real container.
  4. The gap is a missing fallback when no terminal event arrives · an idle or liveness check stops the hang but cannot report exit code 3.
- **Per-hypothesis verdict:**
  1. **Confirmed.** A scratch wrapper at the three sinks took the loop from 6 failed to 7 passed. This held for `( eval '…' )`, a newline subshell, `bash -c` and `sh -c`. A real stdin-fed `bash` session with a marker reproduces the death and shows each wrapper contains it. The container-side SDK code was not observed.
  2. **Confirmed, refined.** `bash -c`/`sh -c` failed 6 contract tests ("passes env to the command", "honours workingDirectory and env", each × 3 stub shapes) because just-bash does not export `env` options. Both subshell forms pass. Whether the real SDK exports `env` is unverified. The bare newline subshell has its own failure modes (Section 4), so the `eval` form is preferred.
  3. **Unverified, consistent with the evidence.** The container source is not in the npm package. The reported real-container `sh -c` success and the real-bash model both support it. The real-container check settles it.
  4. **Refuted as the fix, kept as a possible complement.** No idle check can recover exit code 3 or `before`. Mapping `SessionTerminatedError.exitCode` works for `exec` only and loses the buffered stdout.
- **Confirmed hypothesis:** 1, with 2 deciding the wrapper form.
- **User intervention:** no.

### 2. Root Cause Analysis

**Problem location:**

- File: `packages/agent/src/cloudflare/cf-sandbox.ts`
- Function: `cfSandboxToSandbox()`: the driver's `exec` (line 347) and the two `spawn:` routes (lines 372 and 376)
- Downstream sinks: `cf-spawn.ts:209` (`spawnLive`) and `cf-spawn.ts:404` (`spawnProcess`)

**Root cause:** `cloudflareSandbox` hands the caller's command unchanged to the SDK's long-lived session shell. Any command that ends that shell takes the SDK's completion step with it, so nothing reports the exit code:

- a bare `exit`;
- `set -e` with a failing command;
- `exec`;
- a syntax error;
- an unbalanced quote or an unterminated heredoc.

`exec` rejects with `SessionTerminatedError`. The stream read loops wait forever because:

- they have no idle bound;
- the death detector (`raceContainerDeath`, `cf-sandbox.ts:180-232`) sees the container as `running`.

The SDK documents this on `SessionTerminatedError`: a user `exit` ends the session, and the next call starts a fresh one.

### 3. Proposed Solutions

**Recommended:** run every caller command in a child subshell that `eval`s the single-quoted command, `( eval ' <command>' )` (the leading space was added in T001 so a command starting with `-` is not read as an `eval` option). This lands in `cf-sandbox.ts` at the driver's `exec` (347) and the two `spawn:` routes (372, 376), which pass `{ ...options, command: wrap(options.command) }`. It reuses `shellQuote` (`cf-sandbox.ts:128`).

Why it beats the alternatives:

- A subshell inherits the session's variables and directory, so the `cwd` and `env` the SDK applies still reach the command, and the contract passes on all three stub shapes. When this was written, only the fake showed it for `env`; the real-container check in T002 later confirmed both (`envcwd` printed `v` and `/workspace/sub`).
- The subshell contains every way a command can end the shell: `exit`, `set -e`, `trap … EXIT`, `exec`.
- `eval` turns a parse error, an unbalanced quote or an unterminated heredoc into exit code 2 instead of a dead session.
- It handles empty and comment-only commands.
- It is POSIX, so it works whether the session shell is bash or sh.
- Wrapping in `cf-sandbox.ts` keeps `cf-spawn.ts` free of a value import from `cf-sandbox.ts`, which would create an import cycle.

**Alternatives considered:**

- **`bash -c '<command>'` / `sh -c '<command>'`** (the reporter's workaround).
  - It fails the `env` contract tests on the fake.
  - The real SDK may not export `env` to a child process.
  - `sh` may be dash, which breaks bashisms.
- **A newline subshell, `(\n<command>\n)`.**
  - An empty or comment-only command becomes a syntax error that kills the session.
  - A parse error inside the command still kills the session.
- **A terminal-event fallback** (an idle bound, or mapping `SessionTerminatedError.exitCode`) in `cf-spawn.ts`.
  - It stops the hang but cannot report exit code 3 or the output.
- **A fresh SDK session per command** (`createSession`). SDK 0.11's `ExecOptions` and `ProcessOptions` have no option to run outside the session shell, so this is the only SDK-side route.
  - It costs a session per command and needs session cleanup.
  - It is no better at reporting the exit code than the subshell.
- **Wrapping inside `spawnLive` / `spawnProcess`.**
  - It needs the quoting helper in `cf-spawn.ts` or a new leaf module.
  - It adds nothing over wrapping at the routes in `cf-sandbox.ts`.

**Consequences of the recommended fix:**

- **Exact-command tests.** Two tests in `cf-spawn.test.ts` assert the exact command string that reaches the stub, so they must assert the wrapped command after the fix:
  - "passes the resolved working directory, env, and rounded-up timeout to execStream" (~line 239);
  - "delivers output before the command completes…" (~line 565).
- **Carry-over between commands.**
  - **Change:** `cd` and `export` in one command no longer carry over to the next command on a real container. That matches `local()`, which starts a fresh shell per command.
  - **Coverage:** no test or doc relies on the carry-over today.
- **Kill reach** (unverified).
  - **Observed in the model:** with the `eval` form, a `bash` subshell sits between the session and the command. Signalling only that subshell's pid left a single `sleep` alive.
  - **What #51 already showed:** `killProcess` documents stopping the whole process tree, and #51 verified that on a real container. Its multi-command loop already had an intermediate shell.
  - **Check:** the real-container check must re-confirm `kill()` on a wrapped long-running command.

### 4. Testing Requirements

- **Bug scenario:** the Feedback Loop above. Its session-model stub becomes the regression test, covering `run`, the buffered `spawn`, the `execStream` `spawn` and the process-API `spawn`.
- **Edge cases** (observed on a real `bash` session with a marker):
  - `echo before; exit 3` → stdout `before`, exit code 3, next command runs.
  - empty, whitespace-only, or `# only a comment` → exit code 0.
  - `echo (` / `echo a)` → exit code 2 with the shell's error on stderr; the session lives.
  - `echo "abc` (unbalanced quote) / `cat <<EOF\nx` (unterminated heredoc) → the command finishes (exit code 2 or 0) instead of hanging.
  - `set -e; false; echo x` → exit code 1, no `x`.
  - `trap 'echo bye' EXIT; exit 2` → stdout `bye`, exit code 2.
  - `exec <program>` → the program runs and its exit code is reported; the session lives.
  - `exit 300` → exit code 44, the shell's modulo 256.
  - trailing `# comment`, a heredoc followed by `exit 4`, a single quote inside the command → unchanged behavior.
  - `env` and `cwd` options → still visible to the command.
  - `export Z=1` in one command → `Z` is unset in the next, as on `local()`.

### 5. Similar Code Patterns

- `cf-sandbox.ts:272`, `:292`, `:321`: amond's own `stat`, `find` and `rm` commands call `stub.exec` directly. None contains `exit`, and they stay unwrapped.
- `packages/agent/src/agent.ts:555-617`: the search tools build `rg`/`grep`/`find` strings with a second private `shellQuote` (`agent.ts:750`). They run through `Sandbox.run`, so the fix covers them.
- `cf-spawn.ts:221`, `:374`: neither stream consumer has an idle bound. Any other cause of a missing terminal event would still hang; that is outside this fix.
- `define-sandbox-contract.ts:205`, `:281`: the contract asserts a bare `exit 3` / `exit 4`, but the fakes have no session model, so it could not catch this bug.
