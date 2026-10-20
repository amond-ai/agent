# Plan: Flue sandbox as an AI SDK sandbox session

> Track: ai-sdk-sandbox-20261020
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: ai-sdk-sandbox-20261020
- **Issue**: #15
- **Created**: 2026-10-20
- **Approach**: Grow `Sandbox` additively into the AI SDK session shape on every provider, move every caller onto the new methods, then remove `exec` and switch `readFile`/`writeFile` to the session forms in one breaking task.
- **Plan Depth**: standard
- **Planned At**: a27e633

## Context

### Problem

`readFile` and `writeFile` exist in both the old and the session shape with different signatures, so switching them is the one step that cannot be additive. It lands last, after every caller has left the old forms, and every earlier task leaves `bun run check` green. `@amond-ai/agent` has no tests today, so every behaviour this track proves gets a new test.

### Non-Goals

Considered and not built:
- A public `spawn?` on `SandboxDriver`. Cloudflare gets live output inside `cloudflareSandbox`, and the driver-level method stays the spec's follow-up. Evidence that would change this: a second provider needing live output in this track.
- Calling `exists` before every read to detect a missing file. It costs one container round trip per read; `exists` is called only after a read fails.
- Publishing the provider contract test suite for third-party adapters.

### STOP Conditions

- The non-optional `zod` peer dependency of `@ai-sdk/provider-utils` 5.0.64 produces install warnings or lint failures for `@amond-ai/agent` consumers. Ask whether to keep it as a `dependency`.
- The installed 5.0.30 (via `@ai-sdk/harness`) and the new 5.0.64 copy of `Experimental_SandboxSession` stop being mutually assignable.

## Architecture Decision

**Type.** `Sandbox extends Experimental_SandboxSession`, imported with `import type` so nothing reaches the Worker bundle. `run` and `spawn` narrow their options to `SandboxRunOptions` (the session options plus optional `timeoutMs`), and `run` returns `ShellResult`. Both narrowings keep `Sandbox` assignable to the session type. The extensions stay: `cwd`, `resolvePath`, `stat`, `readdir`, `exists`, `mkdir`, and `rm`. `@ai-sdk/provider-utils` is an exact `5.0.64` runtime `dependency`, because the emitted `.d.mts` references it.

**Shared pieces.**
- A process controller turns pushed chunks and an exit code into a `SandboxProcess`. It owns stream close and error, an idempotent `kill`, and a `wait()` whose rejection is already handled, since an unhandled rejection is an exception on workerd.
- One builder turns a provider's string, byte, and write primitives into the six session file methods. It handles line ranges, encodings, and `null` on a missing file.
- `timeoutMs` is rounded up before it becomes a signal or provider deadline. `AbortSignal.timeout` truncates today.

**Providers.**
- `sandboxFromDriver` and `bash()`: `run` is today's `exec` body, including `raceExecAbort`, orphan reporting, and `composeTimeoutSignal`. Their `spawn` is buffered: it starts `run` and pushes the output on exit. Missing files are detected by calling `exists` after a failed read.
- `local()`: the process-group spawn in `node/local-env.ts` moves to a launcher that both `run` and a live `spawn` use. `run` keeps today's output, 124 on timeout, and the 64MB cap. `local()` detects missing files from `ENOENT`/`ENOTDIR`.
- `cloudflareSandbox`: overrides `spawn` after `sandboxFromDriver`, using an optional `execStream?` on `CloudflareSandboxStub`. It parses the event stream itself (no runtime import from `@cloudflare/sandbox`) and races its exit against `raceContainerDeath`. A stub without `execStream` falls back to buffered `spawn`.

**Callers.**
- Missing files: the read and edit tools turn `null` into a new `FileNotFoundError` ("File not found: {path}") on every provider. `context.ts` and the skill loader branch on `null`.
- `AmondFs` becomes a testable `createAmondFs` that keeps its path-based methods and throws on a missing file.
- `overlayPackagedSkills` overrides every read method.
- The grep backend cache is keyed on `run`, which the overlay's spread preserves.

Rejected:
- An adapter object between `Sandbox` and the session: FR-1 forbids it.
- Implementing `run` as `spawn` plus collecting the output: it changes when orphan settlements are reported.
- One big-bang task: it leaves the repository uncompilable across several commits.

## Tasks

- [x] T001 Add `@ai-sdk/provider-utils` 5.0.64 to `@amond-ai/agent` and record it in the tech stack (file: packages/agent/package.json) [NFR-1]
  Validation: `docs/knowledge/tech-stack.md` lists the package with its purpose before the dependency appears; `bun install` resolves 5.0.64 for `@amond-ai/agent`, and `bun run build` still passes for the package.
  Method: `bun install && bunx turbo run build --filter=@amond-ai/agent`
- [x] T002 Add the shared stream, process, and file-method helpers, and round `timeoutMs` up (file: packages/agent/src/sandbox-streams.ts) [FR-4, FR-6, AC-005]
  Validation: a controlled process delivers pushed chunks in order and resolves `wait()` with its exit code; `kill()` after exit is a no-op that keeps the code; `readTextFile` line ranges are 1-based and inclusive, and a range past the end of the file returns through the end; a fractional `timeoutMs` (1500.4) becomes 1501.
  Method: `bunx turbo run test --filter=@amond-ai/agent`
- [ ] T003 Give every provider the session methods next to the existing ones, with buffered `spawn`, and add the provider contract suite (file: packages/agent/src/sandbox.ts) (depends on T001, T002) [FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, NFR-3, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009, AC-011, AC-012, AC-013]
  Validation: the contract suite passes on `local()`, `bash()`, `sandboxFromDriver` over a fake driver, and `cloudflareSandbox` over a fake stub, covering AC-002–AC-009 and AC-011–AC-013; an empty existing file reads as `""`, not `null`; each provider's `description` names its working directory (FR-8); `createCwdSandbox` resolves `workingDirectory` and file paths against its own `cwd`.
  Method: `bunx turbo run test --filter=@amond-ai/agent && bun run check`
- [ ] T004 Stream `spawn` output live on `local()` (file: packages/agent/src/node/local-env.ts) (depends on T003) [FR-6, AC-010]
  Validation: a spawned command's first chunk is readable before the command exits (AC-010); `kill()` ends the whole process group; `run` keeps its current output, its exit code 124 on timeout, and the 64MB cap.
  Method: `bunx turbo run test --filter=@amond-ai/agent`
- [ ] T005 Stream `spawn` output live on `cloudflareSandbox` through an optional stub `execStream` (file: packages/agent/src/cloudflare/cf-sandbox.ts) (depends on T003) [FR-6]
  Validation: with a fake streaming stub, output arrives before completion, including an event split across two chunks; container death rejects `wait()` with `SandboxDiedError`; a stub without `execStream` still passes the contract suite with buffered output.
  Method: `bunx turbo run test --filter=@amond-ai/agent`
- [ ] T006 Move the tools, shell, context loading, skill loading, and `harness.fs` onto the new methods (file: packages/agent/src/agent.ts) (depends on T003) [FR-9, FR-11, AC-015, AC-016]
  Validation: a read or edit of a missing file returns `File not found: {path}` on all three providers (AC-015); `harness.fs.readFile` on a missing file rejects (AC-016); `harness.shell` keeps its signature and result and forwards `timeoutMs`; a packaged-skill path still reads through the overlay; nothing under `packages/agent/src` calls `exec`, `readFileBuffer`, or the path forms of `readFile`/`writeFile` on a `Sandbox`.
  Method: `bunx turbo run test --filter=@amond-ai/agent && bun run check`
- [ ] T007 Remove `exec` and `readFileBuffer`, switch `readFile`/`writeFile` to the session's stream forms, and prove assignability (file: packages/agent/src/types.ts) (depends on T006) [FR-1, NFR-2, AC-001, AC-014]
  Validation: each provider's sandbox, and the result of `sandboxFromDriver`, assigns to `Experimental_SandboxSession` with no cast under `bun run check` (AC-001); the existing `SandboxDriver` blueprints compile unchanged (AC-014); the commit carries a `BREAKING CHANGE:` footer naming the removed methods.
  Method: `bun run check && bun run build && CI=true bun run test`
- [ ] T008 Rebuild the `sandbox--cloudflare-computer` blueprint on `SandboxDriver` and regenerate the CLI's blueprint copy (file: blueprints/sandbox--cloudflare-computer.md) (depends on T007) [FR-10]
  Validation: the blueprint's whole extracted code compiles against the new `@amond-ai/agent` and no longer implements `Sandbox` by hand; `packages/cli/src/generated/blueprints.ts` matches the source; `docs-content.test.ts` passes.
  Method: `bunx turbo run test --filter=amond` plus compiling the extracted blueprint file with `bun check`
- [ ] T009 Update the `packages/cli/docs` pages for the new `Sandbox` surface (file: packages/cli/docs/reference/sandbox-api.md) (depends on T007) [FR-10]
  Validation: no page under `packages/cli/docs` calls `harness.sandbox.exec`, `readFileBuffer`, or the path forms of `readFile`/`writeFile`; the `Sandbox` reference lists `run`, `spawn`, the session file methods, `timeoutMs`, and which providers stream `spawn` live.
  Method: `grep -rnE "sandbox\.(exec|readFileBuffer)\(" packages/cli/docs` returns nothing, and `bunx turbo run test --filter=amond` passes
- [ ] T010 Smoke-test live `spawn` against a real Cloudflare Sandbox container (file: packages/agent/src/cloudflare/cf-sandbox.ts) (depends on T005) [FR-6]
  Validation: under `wrangler dev`, a spawned `for i in 1 2 3; do echo $i; sleep 1; done` delivers lines before exit and `wait()` resolves 0; `kill()` mid-run settles `wait()`; the result is recorded in Surprises & Discoveries.
  Method: manual `wrangler dev` run with a scratch Worker; record output
  STOP: the real `execStream` event shape or cancellation differs from the fake stub. Ship buffered `spawn` on Cloudflare and report the FR-6 gap.

## Key Files

- Modify: `packages/agent/src/` `types.ts`, `sandbox.ts`, `abort.ts`, `agent.ts`, `shell.ts`, `context.ts`, `session.ts`, `errors.ts`, `node/local-env.ts`, `cloudflare/cf-sandbox.ts`, plus the files each task names
- Create: `packages/agent/src/sandbox-streams.ts`, `sandbox-files.ts`, `node/shell-process.ts`, `cloudflare/cf-spawn.ts`, a provider contract suite under `packages/agent/src/__contract__/`, and `*.test.ts` files beside the changed modules
- Reuse: `raceExecAbort`, `writeFileCreatingParents`, `makeResolvePath` (`sandbox.ts`); `composeTimeoutSignal`, `abortErrorFor` (`abort.ts`); `raceContainerDeath`, `setContainerDeathCadenceForTests` (`cf-sandbox.ts`); `encodeBase64`/`decodeBase64` (`base64.ts`)

## Verification

- [ ] `bun run lint && bun run build && bun run check && CI=true bun run test` passes at the end of every task
- [ ] The contract suite runs on all four sandbox constructions, and each assigns to `Experimental_SandboxSession` under `bun run check`
- [ ] T010's real-container run shows live `spawn` output on Cloudflare

## Review Focus

- An existing empty file read with `readTextFile` returns `""`, not `null` (T003).
- A `readTextFile` range whose `startLine` is past the end of the file returns `""` without error (T002).
- A Cloudflare stream event split across two chunks is parsed once, not dropped (T005).
- A fractional `timeoutMs` reaches the provider rounded up (T002).
- `kill()` on a process that has already exited leaves `wait()` resolved with the original exit code (T002).

## Progress

- [x] (2026-10-20 17:05 KST) T001 Add `@ai-sdk/provider-utils` 5.0.64 to `@amond-ai/agent` and record it in the tech stack — 2c490919
  Evidence: `bun install` → `@ai-sdk/provider-utils` 5.0.64 hoisted for `@amond-ai/agent` (other consumers keep 5.0.30); `bunx turbo run build --filter=@amond-ai/agent` → 1 successful; tech-stack.md row added in the same commit before the dependency is used
- [x] (2026-10-20 17:20 KST) T002 Add the shared stream, process, and file-method helpers, and round `timeoutMs` up — faa8e5fb
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` → 3 files, 34 tests passed (ordered chunks + exit code, kill-after-exit keeps code, 1-based inclusive line ranges incl. past-EOF, `composeTimeoutSignal(1500.4)` → `AbortSignal.timeout(1501)`); `bun check` (1.4.3) → no type errors

## Decision Log

## Surprises & Discoveries

- The shell's `bun` is 1.4.2 when mise is not activated, and 1.4.2 has no built-in `bun check`, so the package `check` script (`bun check`) recurses and fails with E2BIG. Run quality gates through `mise exec --` (Bun 1.4.3).
