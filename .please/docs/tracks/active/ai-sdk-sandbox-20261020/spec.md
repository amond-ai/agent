---
product_spec_domain: sandbox
---

# Flue sandbox as an AI SDK sandbox session

> Track: ai-sdk-sandbox-20261020

## Overview

ADR-0003 decision 4 calls for a single sandbox object that both the framework's built-in tools
and the AI SDK harness can use. Today `@amond-ai/agent`'s `Sandbox` has its own shape
(`exec`, `readFile(path)`, `writeFile(path, content)`), and the harness expects
`Experimental_SandboxSession` from `@ai-sdk/provider-utils`. This track makes every `Sandbox`
an `Experimental_SandboxSession`, with no adapter in between, while keeping the extra operations
the framework's tools need. It is the `packages/agent` part of
[#15](https://github.com/amond-ai/agent/issues/15). This lets #17 hand the agent's sandbox
to the harness as its `sandboxSession`.

Decisions taken while scoping:

- `Sandbox.exec` is replaced by `run` and `spawn`. The provider's own deadline (`timeoutMs`) is
  kept as an optional extension of their options.
- Every existing `SandboxDriver` implementation, the contract third-party adapters implement, stays valid.
  `sandboxFromDriver` produces the new `Sandbox`, so the sandbox blueprints and adapter docs stay
  valid.
- `spawn` streams output live where the provider can (`local()`, `cloudflareSandbox`), and emits
  output when the command finishes where it cannot (`bash()`, driver-backed sandboxes).
- The track types against `@ai-sdk/provider-utils` 5.0.64.

## Requirements

### Functional Requirements

- [ ] FR-1: make every `Sandbox` value satisfy `Experimental_SandboxSession` from `@ai-sdk/provider-utils` 5.0.64 directly, with no adapter, wrapper, or cast
- [ ] FR-2: keep the framework extensions on `Sandbox`: `cwd`, `resolvePath`, `stat`, `readdir`, `exists`, `mkdir`, and `rm`, with relative paths resolved against `cwd` in every file operation
- [ ] FR-3: replace `Sandbox.exec` with the session's `run` and `spawn`, and accept an optional `timeoutMs` on their options that is forwarded to the provider's native deadline
- [ ] FR-4: replace the framework's `readFile(path)`, `readFileBuffer(path)`, and `writeFile(path, content)` with the session's `readFile`, `readBinaryFile`, `readTextFile`, `writeFile`, `writeBinaryFile`, and `writeTextFile`, including their contract that a missing file resolves to `null`
- [ ] FR-5: keep the existing abort and liveness contract for `run` and `spawn`: a pre-aborted call never executes, a mid-flight abort rejects promptly, an orphaned command's eventual settlement is reported to `onOrphanSettled`, and sandbox death rejects with `SandboxDiedError`
- [ ] FR-6: deliver `spawn` output live on `local()` and `cloudflareSandbox`, and on completion on `bash()` and driver-backed sandboxes, with `wait`, `kill`, and abort working on all of them
- [ ] FR-7: keep every existing `SandboxDriver` implementation valid without changes, and have `sandboxFromDriver` produce the new `Sandbox` from it
- [ ] FR-8: adapt the three built-in providers, `cloudflareSandbox`, `bash()`, and `local()`, to the new `Sandbox`, each with a `description` of its environment
- [ ] FR-9: port the built-in tools (read, write, edit, bash, grep, glob) onto the new methods with no change to what the model sees
- [ ] FR-10: update every page under `packages/cli/docs` that calls or documents the removed `Sandbox` methods, including the sandbox and agent API references, the sandbox and tool guides, and the Cloudflare, GitHub Actions, and GitLab CI deploy pages, and the `sandbox--cloudflare-computer` blueprint, which implements `Sandbox` directly rather than through `SandboxDriver`
- [ ] FR-11: keep the public `harness.fs` and `harness.shell` (and their `session` counterparts) unchanged in names, signatures, and behaviour, including `harness.fs.readFile` throwing on a missing file

### Non-functional Requirements

- [ ] NFR-1: add `@ai-sdk/provider-utils` to `tech-stack.md` before it becomes a dependency of `@amond-ai/agent`
- [ ] NFR-2: mark the removal of `exec` and the old file-method signatures as a breaking change in the commit history, so release-please records it
- [ ] NFR-3: cover the new `Sandbox` contract with tests that run on all three built-in providers. `@amond-ai/agent` has no tests today, so these are new

## Acceptance Criteria

- [ ] AC-001 (FR-1): When a `Sandbox` from `cloudflareSandbox`, `bash()`, `local()`, or `sandboxFromDriver` is assigned to a variable typed `Experimental_SandboxSession`, the type check shall pass with no cast.
- [ ] AC-002 (FR-2): When `readTextFile` is given a relative path, the system shall read the file at that path resolved against the sandbox's `cwd`.
- [ ] AC-003 (FR-4): When `readTextFile` or `readBinaryFile` targets a path that does not exist, the system shall resolve to `null` rather than reject.
- [ ] AC-004 (FR-4): When `writeTextFile` targets a path whose parent directories do not exist, the system shall create them and write the file.
- [ ] AC-005 (FR-3): When `run` is called with `timeoutMs`, the system shall pass that deadline to the provider's native timeout option, rounding up and never down.
- [ ] AC-006 (FR-5): If `run` is called with an `abortSignal` that is already aborted, then the system shall reject without executing the command.
- [ ] AC-007 (FR-5): When the `abortSignal` aborts while a driver-backed `run` is in flight, the system shall reject promptly with an `AbortError`.
- [ ] AC-008 (FR-5): When an aborted driver-backed command later settles, the system shall report its settlement to `onOrphanSettled`.
- [ ] AC-009 (FR-5): If the sandbox dies while `run` is in flight, then the system shall reject with `SandboxDiedError`.
- [ ] AC-010 (FR-6): While a command started with `spawn` on `local()` is still running, the system shall deliver the output it has already written on `stdout`.
- [ ] AC-011 (FR-6): When a command started with `spawn` on `bash()` or a driver-backed sandbox finishes, the system shall deliver its full output on `stdout` and `stderr`.
- [ ] AC-012 (FR-6): When a command started with `spawn` on `bash()` or a driver-backed sandbox finishes, the system shall resolve `wait()` to its exit code.
- [ ] AC-013 (FR-6): When `kill()` is called on a spawned process, the system shall settle its `wait()`.
- [ ] AC-014 (FR-7): The `SandboxDriver`-based sandbox blueprints' driver code shall type-check against `SandboxDriver` without changes.
- [ ] AC-015 (FR-9): When the model's read or edit tool targets a missing file, the system shall return a tool error that names the path, with the same wording on every provider.
- [ ] AC-016 (FR-11): When `harness.fs.readFile` targets a missing file, the system shall reject, as it does today.

## Out of Scope

- The `@amond-ai/sandbox-cloudflare` package, and confirming that `@amond-ai/harness-sandbox` adapts it to `HarnessV1SandboxProvider`. Both move to a separate issue in `amond-ai/harness`, together with #15's third definition-of-done item.
- Live `spawn` output on `bash()` and third-party driver-backed sandboxes. Follow-up: an optional, additive driver-level streaming method that adapters can implement, with buffered output as the fallback.
- Network and port operations (`HarnessV1NetworkSandboxSession`).
- Bridging to `@amond-ai/sandbox`, which keeps its own shape for process reattachment.
- Handing the sandbox to the harness and running turns through it (#17), and removing Pi (#18).
- Changes to the `SandboxDriver`-based sandbox blueprints and their adapter docs, which stay valid because `SandboxDriver` keeps its shape.

## Assumptions

- `Experimental_SandboxSession` in `@ai-sdk/provider-utils` 5.0.64 has the same members and option types as in 5.0.30. This was checked against both published type definitions during the spec review.
- `amond-ai/harness` will move to the same `@ai-sdk/provider-utils` version before #17 shares the type across both repositories.
- `cloudflareSandbox` is built on `sandboxFromDriver` today, and the Cloudflare stub surface it accepts has no streaming method. Live output on Cloudflare needs the Cloudflare Sandbox SDK's streaming command execution, reachable from the agent's Durable Object, and a way to reach it that leaves existing `SandboxDriver` implementations valid. The plan chooses that way.
- `run`'s result (`exitCode`, `stdout`, `stderr`) carries everything the built-in tools read from today's `ShellResult`.
- The deprecated aliases `SessionEnv` and `SandboxApi` keep pointing at `Sandbox` and `SandboxDriver`.
