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
- [x] T003 Give every provider the session methods next to the existing ones, with buffered `spawn`, and add the provider contract suite (file: packages/agent/src/sandbox.ts) (depends on T001, T002) [FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, NFR-3, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009, AC-011, AC-012, AC-013]
  Validation: the contract suite passes on `local()`, `bash()`, `sandboxFromDriver` over a fake driver, and `cloudflareSandbox` over a fake stub, covering AC-002–AC-009 and AC-011–AC-013; an empty existing file reads as `""`, not `null`; each provider's `description` names its working directory (FR-8); `createCwdSandbox` resolves `workingDirectory` and file paths against its own `cwd`.
  Method: `bunx turbo run test --filter=@amond-ai/agent && bun run check`
- [x] T004 Stream `spawn` output live on `local()` (file: packages/agent/src/node/local-env.ts) (depends on T003) [FR-6, AC-010]
  Validation: a spawned command's first chunk is readable before the command exits (AC-010); `kill()` ends the whole process group; `run` keeps its current output, its exit code 124 on timeout, and the 64MB cap.
  Method: `bunx turbo run test --filter=@amond-ai/agent`
- [x] T005 Stream `spawn` output live on `cloudflareSandbox` through an optional stub `execStream` (file: packages/agent/src/cloudflare/cf-sandbox.ts) (depends on T003) [FR-6]
  Validation: with a fake streaming stub, output arrives before completion, including an event split across two chunks; container death rejects `wait()` with `SandboxDiedError`; a stub without `execStream` still passes the contract suite with buffered output.
  Method: `bunx turbo run test --filter=@amond-ai/agent`
- [x] T006 Move the tools, shell, context loading, skill loading, and `harness.fs` onto the new methods (file: packages/agent/src/agent.ts) (depends on T003) [FR-9, FR-11, AC-015, AC-016]
  Validation: a read or edit of a missing file returns `File not found: {path}` on all three providers (AC-015); `harness.fs.readFile` on a missing file rejects (AC-016); `harness.shell` keeps its signature and result and forwards `timeoutMs`; a packaged-skill path still reads through the overlay; nothing under `packages/agent/src` calls `exec`, `readFileBuffer`, or the path forms of `readFile`/`writeFile` on a `Sandbox`.
  Method: `bunx turbo run test --filter=@amond-ai/agent && bun run check`
- [x] T007 Remove `exec` and `readFileBuffer`, switch `readFile`/`writeFile` to the session's stream forms, and prove assignability (file: packages/agent/src/types.ts) (depends on T006) [FR-1, NFR-2, AC-001, AC-014]
  Validation: each provider's sandbox, and the result of `sandboxFromDriver`, assigns to `Experimental_SandboxSession` with no cast under `bun run check` (AC-001); the existing `SandboxDriver` blueprints compile unchanged (AC-014); the commit carries a `BREAKING CHANGE:` footer naming the removed methods.
  Method: `bun run check && bun run build && CI=true bun run test`
- [x] T008 Rebuild the `sandbox--cloudflare-computer` blueprint on `SandboxDriver` and regenerate the CLI's blueprint copy (file: blueprints/sandbox--cloudflare-computer.md) (depends on T007) [FR-10]
  Validation: the blueprint's whole extracted code compiles against the new `@amond-ai/agent` and no longer implements `Sandbox` by hand; `packages/cli/src/generated/blueprints.ts` matches the source; `docs-content.test.ts` passes.
  Method: `bunx turbo run test --filter=amond` plus compiling the extracted blueprint file with `bun check`
- [x] T009 Update the `packages/cli/docs` pages for the new `Sandbox` surface (file: packages/cli/docs/reference/sandbox-api.md) (depends on T007) [FR-10]
  Validation: no page under `packages/cli/docs` calls `harness.sandbox.exec`, `readFileBuffer`, or the path forms of `readFile`/`writeFile`; the `Sandbox` reference lists `run`, `spawn`, the session file methods, `timeoutMs`, and which providers stream `spawn` live.
  Method: `grep -rnE "sandbox\.(exec|readFileBuffer)\(" packages/cli/docs` returns nothing, and `bunx turbo run test --filter=amond` passes
- [x] T010 Smoke-test live `spawn` against a real Cloudflare Sandbox container (file: packages/agent/src/cloudflare/cf-sandbox.ts) (depends on T005) [FR-6]
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
- [x] (2026-10-20 17:13 KST) T003 Give every provider the session methods next to the existing ones, with buffered `spawn`, and add the provider contract suite — a84766f8
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` → 6 files, 131 passed / 6 skipped (contract suite on local(), bash(), sandboxFromDriver over a just-bash fake driver, cloudflareSandbox over a fake stub; the skips are capability-gated: AC-008 off for local/bash/cloudflare, AC-009 off for local/bash/driver); `cd packages/agent && mise exec -- bun check` → no type errors in 145 files; mutation runs (no round-up, no exists-after-failure, no stderr push, no spawn pre-abort check, cwd scope ignoring workingDirectory, local ENOTDIR dropped) each failed the suite
- [x] (2026-10-20 17:21 KST) T004 Stream `spawn` output live on `local()` — fee5153c
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` → 6 files, 136 passed / 6 skipped (AC-010 first chunk read while `wait()` unsettled; process-group kill leaves no backgrounded pid; 124 on timeout); mutation run (spawn swapped back to buffered) failed the AC-010 test; manual `run({command: 'head -c 67108900 /dev/zero'})` → exit 1 with "[amond] local exec output exceeded 67108864 bytes; process tree killed"
- [x] (2026-10-20 17:25 KST) T005 Stream `spawn` output live on `cloudflareSandbox` through an optional stub `execStream` — e9a3b7b0
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` → 7 files, 176 passed / 7 skipped (contract suite run twice on cloudflareSandbox: buffered stub and streaming execStream fake; cf-spawn.test.ts: first stdout chunk read while wait() pending, split frame delivered once, getState 'stopped' → SandboxDiedError on wait() and both streams); `bun check` → no type errors in 147 files; mutations (spawn forced buffered, parser buffer dropped, death race removed) each failed the suite. After merging with T004: 181 passed / 7 skipped, no type errors in 148 files
- [x] (2026-10-20 17:23 KST) T006 Move the tools, shell, context loading, skill loading, and `harness.fs` onto the new methods — de9e14cd
  Evidence: `mise exec -- bunx turbo run test --filter=@amond-ai/agent` → 9 files, 155 passed / 6 skipped (AC-015 read+edit on local(), bash(), sandboxFromDriver fake → exact `File not found: {path}`; AC-016 createAmondFs readFile/readFileBuffer reject with FileNotFoundError; shell forwards timeoutMs to run; packaged-skill overlay serves readTextFile/readBinaryFile; grep probe runs once across overlay spreads); `bun check` → no type errors. After merging with T004/T005: 10 files, 205 passed / 7 skipped, no type errors in 151 files; orchestrator grep → only legacy member definitions (createCwdSandbox, overlay `readFile`) remain for T007
- [x] (2026-10-20 17:32 KST) T007 Remove `exec` and `readFileBuffer`, switch `readFile`/`writeFile` to the session's stream forms, and prove assignability — 69ebc421
  Evidence: `mise exec -- bun run check --force` → 16/16 tasks successful; `mise exec -- bun run build` → 11/11 successful; `CI=true mise exec -- bun run test` → 22/22 tasks, `@amond-ai/agent` 11 files 211 passed / 7 skipped, every other workspace green; `mise exec -- bun run lint` → 11/11 successful. AC-001: `src/sandbox.assignability.test.ts` assigns `sandboxFromDriver`, `createLocalSandbox`, `local().createSandbox`, `bash()`, `cloudflareSandbox().createSandbox`, and `createCwdSandbox` results to `Experimental_SandboxSession` with no cast (compiled by `bun check`). dist `.mjs` has no `@ai-sdk` reference; two `.d.mts` import the session/process types. AC-014: extracted every ```ts block of the nine `SandboxDriver` blueprints to /tmp/bpcheck, stubbed vendor SDK exports as `any` (value + type), compiled with tsc 5.9.3 against the built `dist/index.d.mts` before (HEAD e4dd57a4) and after T007 → the same 18 errors in both, all `unknown` artifacts of the vendor stubs in boxd/daytona/modal, none from `SandboxDriver`; the only change is `sandbox--cloudflare-computer` (hand-written `Sandbox`, already failing since T003 with missing members, now failing on the path-form `readFile`/`writeFile`) — T008's scope. Commit carries the `BREAKING CHANGE:` footer naming the removed methods
- [x] (2026-10-20 17:40 KST) T009 Update the `packages/cli/docs` pages for the new `Sandbox` surface — b63670be
  Evidence: `grep -rnE "sandbox\.(exec|readFileBuffer)\(|sandbox\.(readFile|writeFile)\('" packages/cli/docs` → no matches (re-run by orchestrator after merge); `mise exec -- bunx turbo run test --filter=amond` → 61 passed; eslint on packages/cli/docs → clean; sandbox-api.md lists run/spawn, session file methods, `timeoutMs`, and a live-vs-buffered spawn table
- [x] (2026-10-20 17:45 KST) T008 Rebuild the `sandbox--cloudflare-computer` blueprint on `SandboxDriver` and regenerate the CLI's blueprint copy — d69fed34
  Evidence: extracted blueprint compiled with `node_modules/.bin/tsc -p /tmp/bp8/tsconfig.json` against the freshly built `@amond-ai/agent` → exit 0 (re-run by orchestrator on the merged tree); `mise exec -- bunx turbo run test --filter=amond` → 61 passed (docs-content.test.ts included); blueprint index regenerated twice with no diff
- [x] (2026-10-21 11:44 KST) T010 Smoke-test live `spawn` against a real Cloudflare Sandbox container
  Evidence: temporary Worker `amond-t010-smoke-6139bccd` (account 밸런스프렌즈, `@cloudflare/sandbox` 0.11.0, image `docker.io/cloudflare/sandbox:0.11.0`, `cloudflareSandbox(getSandbox(...))` from the built `@amond-ai/agent`) → stub has `execStream`; `run({command: 'echo warm && pwd'})` → `warm\n/workspace`, exit 0; `spawn('for i in 1 2 3; do echo $i; sleep 1; done')` → stdout chunks at 122 ms / 1128 ms / 2132 ms, `wait()` → `{ exitCode: 0 }` at 3138 ms (live, not buffered); `kill()` at 2500 ms on an 8-line loop → `wait()` rejected at once with the orphan AbortError ("could not be confirmed cancelled and may still be running"), both streams errored with it; the remote loop kept running (7 lines in its log file by ~6.5 s). Worker and container application `a034647f-…` deleted afterwards (`wrangler delete`, `wrangler containers delete`; Worker URL → 404)
- [x] (2026-10-21 22:36 KST) Review-stage commits (SHA: `64ff1703`, `f25d233e`, `5c1259d7`, `18e2ba0d`, `15aea830`, `8ab79650`, `e9ff40ea`, `a99e147d`, `99e4032f`, `0bf5e16c`, `f0a459fe`, `3a397a4d`, `1f0b9350`, `a074882a`)

## Decision Log

- Decision: `createCwdSandbox` keeps listing every member explicitly instead of spreading the parent, and its `description` appends the scoped working directory to the parent's.
  Rationale: spreading drops prototype methods of a class-based `Sandbox` (a hand-written one like the cloudflare-computer blueprint's); the parent description alone names the parent's directory, which is wrong inside the scope.
  Date/Author: 2026-10-20 / implement-executor
- Decision: `sandboxFromDriver`'s legacy `exec` shares `run`'s internals, so it now also rounds `timeoutMs` up before `driver.exec`, and `cloudflareSandbox` rounds before the stub's `timeout` as well.
  Rationale: one implementation of the abort race and deadline forwarding; the `SandboxDriver` contract already allows rounding up, never down.
  Date/Author: 2026-10-20 / implement-executor
- Decision: `launchShell` counts the 64MB cap in raw bytes, where `execShell` counted UTF-16 units of the decoded string.
  Rationale: the launcher hands out Buffers and the error message already says "bytes"; output under the cap is unchanged, multibyte output now trips at the true 64MB.
  Date/Author: 2026-10-20 / implement-executor (T004)
- Decision: `local()`'s live-spawn tests live in `node/local-env.test.ts`, not behind a contract-suite capability flag.
  Rationale: T004's scope was `src/node/*`; the shared contract file stayed untouched.
  Date/Author: 2026-10-20 / implement-executor (T004)
- Decision: export `ORPHANED_EXEC_SUFFIX` from sandbox.ts (no barrel change) so the live Cloudflare spawn rejects kill()/abort with the same orphan wording as `sandboxFromDriver`.
  Rationale: the wording must match, and a copy would drift. sandbox.ts is outside T005's `file:` but the outcome requires it.
  Date/Author: 2026-10-20 / implement-executor (T005)
- Decision: no live-spawn capability flag in the contract suite; liveness is asserted per provider (`node/local-env.test.ts`, `cloudflare/cf-spawn.test.ts`) with test-driven streams.
  Rationale: the just-bash fakes run each command to completion, so a contract-level "output before exit" check could not pass on a Cloudflare fake.
  Date/Author: 2026-10-20 / implement-executor (T005)
- Decision: `session.fs` readFile/readFileBuffer on a missing file reject with `FileNotFoundError` ("File not found: {path}") instead of the provider's own error; other read failures propagate unchanged.
  Rationale: the null-returning session reads carry no provider error to rethrow; one wording on every provider matches the tool errors (AC-015) while keeping the reject contract (AC-016, FR-11).
  Date/Author: 2026-10-20 / implement-executor (T006)
- Decision: `context.ts` skips an AGENTS.md/CLAUDE.md that disappears between `exists` and the read; a vanished SKILL.md takes the existing warn-and-skip path.
  Rationale: the null branch makes the race explicit; failing init on it served no contract.
  Date/Author: 2026-10-20 / implement-executor (T006)
- Decision: `overlayPackagedSkills` keeps its legacy `readFile` override until T007 converts it to the stream form; its `readBinaryFile` returns raw decoded bytes while `readTextFile` keeps the model-readable form.
  Rationale: the stream-form `readFile` does not exist on `Sandbox` before T007.
  Date/Author: 2026-10-20 / implement-executor (T006)
- Decision: the `SandboxDriver`/`BashLike` blocks and the driver pages under `ecosystem/sandboxes/*` keep `exec` and `readFileBuffer`.
  Rationale: those interfaces are unchanged (FR-7).
  Date/Author: 2026-10-20 / implement-executor (T009)
- Decision: bump `sandbox--cloudflare-computer` to version 3 with a diff-bearing upgrade-guide entry.
  Rationale: the change breaks installed v2 copies, and the blueprint index generator requires a unified diff for every version after 1.
  Date/Author: 2026-10-20 / implement-executor (T008)

## Surprises & Discoveries

- The shell's `bun` is 1.4.2 when mise is not activated, and 1.4.2 has no built-in `bun check`, so the package `check` script (`bun check`) recurses and fails with E2BIG. Run quality gates through `mise exec --` (Bun 1.4.3).
- Executor worktrees start from the base commit the session began on (a27e633), not the track branch head; executors must fast-forward to `tracks/ai-sdk-sandbox-20261020` before working.
- T010 must check the real `execStream` against the fake's assumptions: `exitCode` on the `complete` event, `error` as a string field, and whether cancelling the stream stops the remote command.
- `AmondHarness` has no `fs` member; `AmondFs` is exposed as `AmondSession.fs`, although the `AmondFs` JSDoc and the spec say `harness.fs`.
- The `BREAKING CHANGE:` footer must wrap at 100 characters: commitlint's `footer-max-line-length` rejects the one-line footer.
  Evidence: husky commit-msg → `✖ footer's lines must not be longer than 100 characters [footer-max-line-length]`.
- `packages/cli/src/generated/blueprints.ts` is gitignored and holds only the blueprint index (slug, kind, version, aliases); the CLI's test and check scripts regenerate it, so T008's commit contains only the blueprint.
- T010 on a real container confirmed the `execStream` event shape the fake assumed (live chunks, `complete` with `exitCode`). Cancelling the stream does **not** stop the remote command: after `kill()` the loop kept writing. `wait()` still settles at once with the orphan AbortError, as designed. A real remote kill needs the SDK's process API (`startProcess` + `killProcess` in 0.11); follow-up, not in this track.
- `@cloudflare/sandbox` 1.0.2 (published 2026-10-20) removes the 0.x `getSandbox()` stub (`exec`, `readFile`, `execStream`) that `cloudflareSandbox` wraps; in 1.0 the user's Durable Object starts the container and calls `ctx.container.exec`. The repo's blueprint pins `^0.11.0`, so nothing breaks today; supporting 1.0 is a separate issue.
- Cloudflare's env `CLOUDFLARE_API_TOKEN` (account token) cannot deploy Workers (403 on the secrets endpoint); T010 ran with `wrangler login --device` OAuth (`account:read`, `workers_scripts:write`, `containers:write`) and `env -u CLOUDFLARE_API_TOKEN`.

## Outcomes & Retrospective

### What Was Shipped
- `Sandbox` extends the AI SDK's `Experimental_SandboxSession`, so it can be passed as a session with no cast. `sandboxFromDriver`, `local()`, `bash()`, `cloudflareSandbox()` and `createCwdSandbox` all assign. `@ai-sdk/provider-utils` 5.0.64 is a type-only dependency, so nothing from it reaches the Worker bundle.
- Every provider implements `run`, `spawn` and the six session file methods. `spawn` streams output live on `local()` (process-group kill, unread-output cap) and on Cloudflare stubs that have `execStream`; other providers buffer it. `readTextFile` line ranges match the AI SDK's `extractLines`, and a missing file reads as `null`.
- Breaking change: `exec` and `readFileBuffer` are removed, and `readFile`/`writeFile` take the session's stream forms. The tools, shell, context and skill loading, and `session.fs` moved onto the new methods. `SandboxDriver` and the existing blueprints are unchanged, except `sandbox--cloudflare-computer`, which is rebuilt on `SandboxDriver` as version 3.
- The CLI docs describe the new surface, and live Cloudflare `spawn` was smoke-tested on a real container (T010).

### What Went Well
- The additive-then-breaking order (T003–T006 before T007) kept `bun run check` green at every commit, and the provider contract suite caught behaviour gaps through mutation runs.
- T010 on a real container confirmed the `execStream` event shape the fake stub assumed, before review started.
- The ensemble review found real defects the tests had missed: a cancelled stream counted as overflow, local `spawn` ignoring a caller abort, CRLF line ranges, a quadratic SSE rescan, a synchronous `spawn` throw, and an uncaught EMFILE spawn error.

### What Could Improve
- The review ran 14 fix commits across five loops. Several rounds re-raised findings already rejected, because the rejection ledger was stashed during a loop and similar titles do not dedupe. Keep the ledger committed while a loop runs.
- Executor worktrees started from the session's base commit, not the track head, and had to fast-forward first.
- Running gates outside `mise exec` picks up Bun 1.4.2, where `bun check` recurses; the plan's `Method:` lines should say `mise exec --`.

### Tech Debt Created
- TD-010: on Cloudflare, `kill()` of a live `spawn` settles `wait()` but does not stop the remote command. A real kill needs the SDK's `startProcess`/`killProcess`.
- TD-011: for a driver whose `exists()` returns false on any failure (as its contract allows), a failed read of an existing file reads as missing, and the provider error is lost.
- TD-012: live Cloudflare `spawn` rejects `wait()` on a stream `error` event, where `run` and `local()` report a launch failure as exit 1.
- TD-013: `@cloudflare/sandbox` 1.x removes the `getSandbox()` stub that `cloudflareSandbox` wraps; only 0.x is supported.
- TD-014: the 1 MiB SSE parse test asserts it finishes in under 500 ms, which may be flaky on a slow CI runner.
