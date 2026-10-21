---
id: SPEC-002
level: V_M
domain: sandbox
feature: spec
depends: []
conflicts: []
traces: []
created_at: 2026-10-21T13:37:31.365Z
updated_at: 2026-10-21T13:50:41.837Z
source_tracks: ["ai-sdk-sandbox-20261020"]
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

### Requirement: keep the existing abort and liveness contract for `run` and `spawn`: a pre-aborted call never executes, a mid-flight abort rejects promptly, an orphaned command's eventual settlement is reported to `onOrphanSettled`, and on providers that detect sandbox death, that death rejects with `SandboxDiedError`
<!-- req: REQ-005 tracks=ai-sdk-sandbox-20261020 -->

The system MUST keep the existing abort and liveness contract for `run` and `spawn`: a pre-aborted call never executes, a mid-flight abort rejects promptly, an orphaned command's eventual settlement is reported to `onOrphanSettled`, and on providers that detect sandbox death, that death rejects with `SandboxDiedError`.

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

### Requirement: deliver `spawn` output live on `local()` and `cloudflareSandbox`, and on completion on `bash()` and driver-backed sandboxes, with `wait`, `kill`, and abort working on all of them
<!-- req: REQ-006 tracks=ai-sdk-sandbox-20261020 -->

The system MUST deliver `spawn` output live on `local()` and `cloudflareSandbox`, and on completion on `bash()` and driver-backed sandboxes, with `wait`, `kill`, and abort working on all of them.

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
