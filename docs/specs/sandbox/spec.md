---
id: SPEC-002
level: V_M
domain: sandbox
feature: spec
depends: []
conflicts: []
traces: []
created_at: 2026-10-21T13:37:31.365Z
updated_at: 2026-10-23T08:07:22.205Z
source_tracks: ["ai-sdk-sandbox-20261020", "cf-spawn-kill-20261022", "cf-bare-exit-20261022"]
---

# Spec Specification

## Purpose

Spec Specification 관련 요구사항.

## Requirements

### Requirement: make every `Sandbox` value satisfy `Experimental_SandboxSession` from `@ai-sdk/provider-utils` 5.0.64 directly, with no adapter, wrapper, or cast
<!-- req: REQ-001 tracks=ai-sdk-sandbox-20261020 -->

The system MUST make every `Sandbox` value satisfy `Experimental_SandboxSession` from `@ai-sdk/provider-utils` 5.0.64 directly, with no adapter, wrapper, or cast.

#### Scenario: When a `Sandbox` from `cloudflareSandbox`, `bash()`, `local()`, or `sandboxFromDriver` is assigned to a variable typed `Experimental_SandboxSession`, the type check shall pass with no cast.

- WHEN a `Sandbox` from `cloudflareSandbox`, `bash()`, `local()`, or `sandboxFromDriver` is assigned to a variable typed `Experimental_SandboxSession`
- THEN pass with no cast

### Requirement: keep the framework extensions on `Sandbox`: `cwd`, `resolvePath`, `stat`, `readdir`, `exists`, `mkdir`, and `rm`, with relative paths resolved against `cwd` in every file operation
<!-- req: REQ-002 tracks=ai-sdk-sandbox-20261020 -->

The system MUST keep the framework extensions on `Sandbox`: `cwd`, `resolvePath`, `stat`, `readdir`, `exists`, `mkdir`, and `rm`, with relative paths resolved against `cwd` in every file operation.

#### Scenario: When `readTextFile` is given a relative path, the system shall read the file at that path resolved against the sandbox's `cwd`.

- WHEN `readTextFile` is given a relative path
- THEN read the file at that path resolved against the sandbox's `cwd`

### Requirement: replace `Sandbox.exec` with the session's `run` and `spawn`, and accept an optional `timeoutMs` on their options that is forwarded to the provider's native deadline where the provider has one, and enforced through an abort signal otherwise
<!-- req: REQ-003 tracks=ai-sdk-sandbox-20261020 -->

The system MUST replace `Sandbox.exec` with the session's `run` and `spawn`, and accept an optional `timeoutMs` on their options that is forwarded to the provider's native deadline where the provider has one, and enforced through an abort signal otherwise.

#### Scenario: When `run` is called with `timeoutMs`, the system shall pass that deadline to the provider's native timeout option, or enforce it with an abort signal when the provider has none, rounding up and never down.

- WHEN `run` is called with `timeoutMs`
- THEN pass that deadline to the provider's native timeout option, or enforce it with an abort signal when the provider has none, rounding up and never down

### Requirement: replace the framework's `readFile(path)`, `readFileBuffer(path)`, and `writeFile(path, content)` with the session's `readFile`, `readBinaryFile`, `readTextFile`, `writeFile`, `writeBinaryFile`, and `writeTextFile`, including their contract that a missing file resolves to `null`
<!-- req: REQ-004 tracks=ai-sdk-sandbox-20261020 -->

The system MUST replace the framework's `readFile(path)`, `readFileBuffer(path)`, and `writeFile(path, content)` with the session's `readFile`, `readBinaryFile`, `readTextFile`, `writeFile`, `writeBinaryFile`, and `writeTextFile`, including their contract that a missing file resolves to `null`.

#### Scenario: When `readTextFile` or `readBinaryFile` targets a path that does not exist, the system shall resolve to `null` rather than reject.

- WHEN `readTextFile` or `readBinaryFile` targets a path that does not exist
- THEN resolve to `null` rather than reject

#### Scenario: When `writeTextFile` targets a path whose parent directories do not exist, the system shall create them and write the file.

- WHEN `writeTextFile` targets a path whose parent directories do not exist
- THEN create them and write the file

### Requirement: keep the existing abort and liveness contract for `run` and `spawn`: a pre-aborted call never executes, a mid-flight abort rejects promptly, an orphaned command's eventual settlement is reported to `onOrphanSettled` when the caller supplies one, and on providers that detect sandbox death, that death rejects with `SandboxDiedError`
<!-- req: REQ-005 tracks=ai-sdk-sandbox-20261020 -->

The system MUST keep the existing abort and liveness contract for `run` and `spawn`: a pre-aborted call never executes, a mid-flight abort rejects promptly, an orphaned command's eventual settlement is reported to `onOrphanSettled` when the caller supplies one, and on providers that detect sandbox death, that death rejects with `SandboxDiedError`.

#### Scenario: If `run` is called with an `abortSignal` that is already aborted, then the system shall reject without executing the command.

- WHEN `run` is called with an `abortSignal` that is already aborted
- THEN reject without executing the command

#### Scenario: When the `abortSignal` aborts while a driver-backed `run` is in flight, the system shall reject promptly with an `AbortError`.

- WHEN the `abortSignal` aborts while a driver-backed `run` is in flight
- THEN reject promptly with an `AbortError`

#### Scenario: When an aborted driver-backed command later settles, the system shall report its settlement to `onOrphanSettled`.

- WHEN an aborted driver-backed command later settles
- THEN report its settlement to `onOrphanSettled`

#### Scenario: If the sandbox dies while `run` is in flight on a provider that detects sandbox death, then the system shall reject with `SandboxDiedError`.

- WHEN the sandbox dies while `run` is in flight on a provider that detects sandbox death
- THEN reject with `SandboxDiedError`

### Requirement: deliver `spawn` output live on `local()` and on `cloudflareSandbox` stubs that provide the process methods (`startProcess`, `streamProcessLogs`, `killProcess`) or `execStream`, and on completion on `bash()`, driver-backed sandboxes, and `cloudflareSandbox` stubs with neither, with `wait`, `kill`, and abort working on all of them; on a stub with the process methods, `kill`, an abort, the output cap, and `timeoutMs` stop the command in the container
<!-- req: REQ-006 tracks=ai-sdk-sandbox-20261020,cf-spawn-kill-20261022 -->

The system MUST deliver `spawn` output live on `local()` and on `cloudflareSandbox` stubs that provide the process methods (`startProcess`, `streamProcessLogs`, `killProcess`) or `execStream`, and on completion on `bash()`, driver-backed sandboxes, and `cloudflareSandbox` stubs with neither, with `wait`, `kill`, and abort working on all of them; on a stub with the process methods, `kill`, an abort, the output cap, and `timeoutMs` stop the command in the container.

#### Scenario: While a command started with `spawn` on `local()` is still running, the system shall deliver the output it has already written on `stdout`.

- GIVEN a command started with `spawn` on `local()` is still running
- THEN deliver the output it has already written on `stdout`

#### Scenario: When a command started with `spawn` on `bash()` or a driver-backed sandbox finishes, the system shall deliver its full output on `stdout` and `stderr`.

- WHEN a command started with `spawn` on `bash()` or a driver-backed sandbox finishes
- THEN deliver its full output on `stdout` and `stderr`

#### Scenario: When a command started with `spawn` on `bash()` or a driver-backed sandbox finishes, the system shall resolve `wait()` to its exit code.

- WHEN a command started with `spawn` on `bash()` or a driver-backed sandbox finishes
- THEN resolve `wait()` to its exit code

#### Scenario: When `kill()` is called on a spawned process, the system shall settle its `wait()`.

- WHEN `kill()` is called on a spawned process
- THEN settle its `wait()`

### Requirement: keep every existing `SandboxDriver` implementation valid without changes, and have `sandboxFromDriver` produce the new `Sandbox` from it
<!-- req: REQ-007 tracks=ai-sdk-sandbox-20261020 -->

The system MUST keep every existing `SandboxDriver` implementation valid without changes, and have `sandboxFromDriver` produce the new `Sandbox` from it.

#### Scenario: The `SandboxDriver`-based sandbox blueprints' driver code shall type-check against `SandboxDriver` without changes.

- THEN type-check against `SandboxDriver` without changes

### Requirement: adapt the three built-in providers, `cloudflareSandbox`, `bash()`, and `local()`, to the new `Sandbox`, each with a `description` of its environment
<!-- req: REQ-008 tracks=ai-sdk-sandbox-20261020 -->

The system MUST adapt the three built-in providers, `cloudflareSandbox`, `bash()`, and `local()`, to the new `Sandbox`, each with a `description` of its environment.

### Requirement: port the built-in tools (read, write, edit, bash, grep, glob) onto the new methods with no change to what the model sees
<!-- req: REQ-009 tracks=ai-sdk-sandbox-20261020 -->

The system MUST port the built-in tools (read, write, edit, bash, grep, glob) onto the new methods with no change to what the model sees.

#### Scenario: When the model's read or edit tool targets a missing file, the system shall return a tool error that names the path, with the same wording on every provider.

- WHEN the model's read or edit tool targets a missing file
- THEN return a tool error that names the path, with the same wording on every provider

### Requirement: update every page under `packages/cli/docs` that calls or documents the removed `Sandbox` methods, including the sandbox and agent API references, the sandbox and tool guides, and the Cloudflare, GitHub Actions, and GitLab CI deploy pages, and the `sandbox--cloudflare-computer` blueprint, which implements `Sandbox` directly rather than through `SandboxDriver`
<!-- req: REQ-010 tracks=ai-sdk-sandbox-20261020 -->

The system MUST update every page under `packages/cli/docs` that calls or documents the removed `Sandbox` methods, including the sandbox and agent API references, the sandbox and tool guides, and the Cloudflare, GitHub Actions, and GitLab CI deploy pages, and the `sandbox--cloudflare-computer` blueprint, which implements `Sandbox` directly rather than through `SandboxDriver`.

### Requirement: keep the public `session.fs` and `session.shell` unchanged in names, signatures, and behaviour, including `session.fs.readFile` throwing on a missing file
<!-- req: REQ-011 tracks=ai-sdk-sandbox-20261020 -->

The system MUST keep the public `session.fs` and `session.shell` unchanged in names, signatures, and behaviour, including `session.fs.readFile` throwing on a missing file.

#### Scenario: When `session.fs.readFile` targets a missing file, the system shall reject, as it does today.

- WHEN `session.fs.readFile` targets a missing file
- THEN reject, as it does today

### Requirement: report the exit code and output of a command that ends with an `exit` builtin, for `run` and for `spawn`, on every Cloudflare sandbox shape: the process API, `execStream` only, and neither.
<!-- req: REQ-015 tracks=cf-bare-exit-20261022 -->

The system MUST report the exit code and output of a command that ends with an `exit` builtin, for `run` and for `spawn`, on every Cloudflare sandbox shape: the process API, `execStream` only, and neither.

#### Scenario: When `run` executes `echo before; exit 3`, the system shall resolve with exit code 3 and stdout `before\n`.

- WHEN `run` executes `echo before; exit 3`
- THEN resolve with exit code 3 and stdout `before\n`

#### Scenario: When `spawn` executes `echo before; exit 3` on a sandbox with the process API, `wait()` shall resolve to exit code 3 without `timeoutMs`, and stdout shall deliver `before\n`.

- THEN When `spawn` executes `echo before; exit 3` on a sandbox with the process API, `wait()` shall resolve to exit code 3 without `timeoutMs`, and stdout shall deliver `before\n`

#### Scenario: When `spawn` executes `echo before; exit 3` on a sandbox with `execStream` and no process API, `wait()` shall resolve to exit code 3 without `timeoutMs`, and stdout shall deliver `before\n`.

- THEN When `spawn` executes `echo before; exit 3` on a sandbox with `execStream` and no process API, `wait()` shall resolve to exit code 3 without `timeoutMs`, and stdout shall deliver `before\n`

#### Scenario: When `spawn` executes `echo before; exit 3` on a sandbox with neither streaming method, `wait()` shall resolve to exit code 3, and stdout shall deliver `before\n`.

- THEN When `spawn` executes `echo before; exit 3` on a sandbox with neither streaming method, `wait()` shall resolve to exit code 3, and stdout shall deliver `before\n`

#### Scenario: When a command that ended with a bare `exit` has finished, the next `run` on the same sandbox shall run and report its own exit code.

- WHEN a command that ended with a bare `exit` has finished
- THEN run and report its own exit code

### Requirement: report an exit code, instead of failing or hanging, for any command that would otherwise end the SDK's session shell: a failing step under `set -e`, `exec`, an `EXIT` trap, a syntax error, an unbalanced quote, or an unterminated heredoc.
<!-- req: REQ-016 tracks=cf-bare-exit-20261022 -->

The system MUST report an exit code, instead of failing or hanging, for any command that would otherwise end the SDK's session shell: a failing step under `set -e`, `exec`, an `EXIT` trap, a syntax error, an unbalanced quote, or an unterminated heredoc.

#### Scenario: If a command is a syntax error such as `echo (`, then `run` shall resolve with exit code 2 and the shell's error on stderr.

- THEN If a command is a syntax error such as `echo (`, then `run` shall resolve with exit code 2 and the shell's error on stderr

#### Scenario: If a command runs `set -e; false; echo x`, then `run` shall resolve with exit code 1 and without `x` on stdout.

- THEN If a command runs `set -e; false; echo x`, then `run` shall resolve with exit code 1 and without `x` on stdout

#### Scenario: If a command runs `exec` on another program, then `run` shall resolve with that program's exit code.

- THEN If a command runs `exec` on another program, then `run` shall resolve with that program's exit code

#### Scenario: If a command runs `trap 'echo bye' EXIT; exit 2`, then `run` shall resolve with exit code 2 and stdout `bye\n`.

- THEN If a command runs `trap 'echo bye' EXIT; exit 2`, then `run` shall resolve with exit code 2 and stdout `bye\n`

#### Scenario: If a command has an unbalanced quote, such as `echo "abc`, then `run` shall resolve with a nonzero exit code instead of hanging.

- THEN If a command has an unbalanced quote, such as `echo "abc`, then `run` shall resolve with a nonzero exit code instead of hanging

### Requirement: keep delivering the caller's working directory and environment variables to the command.
<!-- req: REQ-017 tracks=cf-bare-exit-20261022 -->

The system MUST keep delivering the caller's working directory and environment variables to the command.

#### Scenario: When `run` executes a command that prints `$NAME` and the working directory, with `env: { NAME: 'v' }` and a working directory other than the default, the system shall print `v` and that directory.

- WHEN `run` executes a command that prints `$NAME` and the working directory, with `env: { NAME: 'v' }` and a working directory other than the default
- THEN print `v` and that directory

### Requirement: keep `kill()` and a caller abort stopping a spawned command in the container.
<!-- req: REQ-018 tracks=cf-bare-exit-20261022 -->

The system MUST keep `kill()` and a caller abort stopping a spawned command in the container.

#### Scenario: When `kill()` is called on a spawned multi-command loop on a real Cloudflare container, the loop shall stop writing within a second.

- WHEN `kill()` is called on a spawned multi-command loop on a real Cloudflare container
- THEN stop writing within a second

### Requirement: run each command in a fresh shell scope, so that `cd` and `export` in one command do not carry over to the next. This matches `local()`; the guide's Cloudflare section states it.
<!-- req: REQ-019 tracks=cf-bare-exit-20261022 -->

The system MUST run each command in a fresh shell scope, so that `cd` and `export` in one command do not carry over to the next. This matches `local()`; the guide's Cloudflare section states it.

#### Scenario: When one `run` executes `export Z=1` and the next `run` prints `$Z`, the second command shall print an empty line.

- WHEN one `run` executes `export Z=1` and the next `run` prints `$Z`
- THEN print an empty line

### Requirement: keep the result of every command that already completes correctly today unchanged, including empty and comment-only commands and commands that contain quotes or heredocs.
<!-- req: REQ-020 tracks=cf-bare-exit-20261022 -->

The system MUST keep the result of every command that already completes correctly today unchanged, including empty and comment-only commands and commands that contain quotes or heredocs.

#### Scenario: If a command is empty or only a comment, then `run` shall resolve with exit code 0.

- THEN If a command is empty or only a comment, then `run` shall resolve with exit code 0

#### Scenario: When a command contains single quotes, such as `printf '%s\n' 'it'"'"'s'`, the system shall run it unchanged and print `it's`.

- WHEN a command contains single quotes, such as `printf '%s\n' 'it'"'"'s'`
- THEN run it unchanged and print `it's`

## Non-functional Requirements

### Requirement: add `@ai-sdk/provider-utils` to `tech-stack.md` before it becomes a dependency of `@amond-ai/agent`
<!-- req: REQ-012 tracks=ai-sdk-sandbox-20261020 -->

The system SHOULD add `@ai-sdk/provider-utils` to `tech-stack.md` before it becomes a dependency of `@amond-ai/agent`.

### Requirement: mark the removal of `exec` and the old file-method signatures as a breaking change in the commit history, so release-please records it
<!-- req: REQ-013 tracks=ai-sdk-sandbox-20261020 -->

The system SHOULD mark the removal of `exec` and the old file-method signatures as a breaking change in the commit history, so release-please records it.

### Requirement: cover the new `Sandbox` contract with tests that run on all three built-in providers. `@amond-ai/agent` has no tests today, so these are new
<!-- req: REQ-014 tracks=ai-sdk-sandbox-20261020 -->

The system SHOULD cover the new `Sandbox` contract with tests that run on all three built-in providers. `@amond-ai/agent` has no tests today, so these are new.
