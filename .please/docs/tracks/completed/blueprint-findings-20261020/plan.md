# Plan: fix the defects in the imported Flue blueprints

> Track: blueprint-findings-20261020
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: blueprint-findings-20261020
- **Issue**: #37
- **Created**: 2026-10-20
- **Approach**: one task per blueprint, each fixing that blueprint's confirmed findings and bumping its version once where generated code changes. Then record every change from Flue `deee93b` and update the attribution.
- **Plan Depth**: standard
- **Planned At**: 87f8e91

## Context

### Problem

[investigation.md](./investigation.md) Section 3 holds the verdict, evidence, check and fix for findings #1–#23 and N1. Tasks cite them by number. The checks run from `/tmp/bp-verify/<group>/`; investigation.md → Feedback Loop says how to rebuild one.

### Constraints

- **Version contract.** `validateBlueprintBody` (`packages/cli/src/lib/blueprint-index.ts:38`) enforces it, following upstream `blueprints/README.md` → Versions. A bump to 2:
  - sets frontmatter `version: 2`;
  - updates every `// amond-blueprint: …@1` marker example (none exist in `sandbox--cloudflare.md`);
  - appends `### Version 2 — <implementation date>` to `## Upgrade Guide`, with prose and a fenced unified `diff` of the generated-file change. Template: `blueprints/sandbox--e2b.md`, Version 2.
- **No bump for editorial changes**, such as comments and wording that don't change generated behavior: #16, #21 and #23.
- **Fix only what the finding describes.** investigation.md Section 5 stays untouched.

### Non-Goals

The spec's Out of Scope applies.

Considered and not built:
- **A permanent sample type-check suite.** It needs 8 provider SDKs as dev dependencies. A second round of sample defects would change this call.
- **Stdin piping for the islo `writeFile`.** It is unverified whether the islo CLI forwards stdin. Chunked appends assume nothing about the CLI. Documented stdin forwarding would change this call.

### STOP Conditions

- A finding's check passes before any edit.
- A fix needs a change outside `blueprints/` and the attribution files.

## Architecture Decision

**Phases group whole blueprints, ordered by priority.** Each blueprint gets one bump, covering all its fixes. Splitting a blueprint across phases would ship a v2 and then a v3 of code nobody has generated yet. Phase 1 has the P1 blueprints, Phase 2 the other generated-code changes, and Phase 3 the text fixes and the record, which has to see every change.

**One change record, in `apps/registry/CHANGES.md`** (first planned for `blueprints/README.md`; see Decision Log). Upgrade Guide entries miss the unbumped Daytona and `sandbox.md` changes. A `PATCHES` file or a frontmatter field would add a format the index generator must ignore.

**The footer points to the record.** `attributionFooter` (`apps/registry/src/build.ts`) is the same for every file, and a per-file list would drift from the README.

## Tasks

### Phase 1: Blueprints with a P1 finding

- [x] T001 Fix the exe.dev adapter and bump it to version 2 (file: blueprints/sandbox--exedev.md) [FR-1, FR-11, AC-001, AC-002, AC-003, AC-004, AC-021]
  Validation: the checks for #1–#4 pass against the fixed text. A bad `cwd` gives a non-zero exit with no output, including for a multi-statement command or one ending in `# c`. A missing exit status or an exit signal rejects. A failed recursive `mkdir` rejects with its stderr. The snippets type-check under `strict`.
  Method: `bash cd.sh`, `bun repro.ts`, `bun close.cjs` and `bunx tsc -p .` in `/tmp/bp-verify/exedev` after re-extracting; `bun --filter amond test`
- [x] T002 Fix the Cloudflare image tag and agent wiring, and bump it to version 2 (file: blueprints/sandbox--cloudflare.md) [FR-2, FR-11, AC-005, AC-021]
  Validation: the Dockerfile tag matches the installed `@cloudflare/sandbox` version (#5). The agent example wires the sandbox as `packages/cli/docs/ecosystem/sandboxes/cloudflare.md:36-52` does, with no `../cloudflare-sandbox` and no claim that platform `env` is unreachable (#6).
  Method: `bash /tmp/bp-verify/cloudflare/check1.sh` prints PASS; `grep -c "cloudflare-sandbox'"` prints 0 and `grep -c cloudflare:workers` prints at least 1; `bun --filter amond test`
- [x] T003 Fix the vitest-evals harness, port and starter eval, and bump it to version 2 (file: blueprints/tooling--vitest-evals.md) [FR-5, FR-11, AC-011, AC-012, AC-021]
  Validation: the re-extracted harness and eval type-check under `strict` against the `vitest-evals` version the install step now pins (#12, N1). The default URL uses port 5173 (#13). An eval against an agent without usage metadata passes (#14).
  Method: `bunx tsc -p .` and `bunx vitest run` in `/tmp/bp-verify/vitest-evals` with the pinned version; `grep -c 3583` prints 0; `bun --filter amond test`

### Phase 2: Other blueprints whose generated code changes

- [x] T004 Cancel a Cloudflare Computer exec aborted while starting, and bump it to version 2 (file: blueprints/sandbox--cloudflare-computer.md) [FR-3, FR-11, AC-006, AC-021]
  Validation: when the signal is already aborted as `settleExec` runs, the exec rejects with `AbortError` and the run is killed once and disposed (#7).
  Method: `bun sim.ts` in `/tmp/bp-verify/cloudflare` after re-extracting; case B prints `rejected:AbortError killed= true`; `bun --filter amond test`
- [x] T005 Fix the Mirage install steps, `readdir` and `rm`, and bump it to version 2 (file: blueprints/sandbox--mirage.md) [FR-4, FR-11, AC-007, AC-008, AC-009, AC-010, AC-020, AC-021]
  Validation: the install steps make the blueprint's own `tsc --noEmit` pass under pnpm (#8). `/data/sub/` lists as `sub` (#9). `rm` with `force` on a missing path resolves, and with `recursive` alone it rejects (#10). A failed file removal reports the `unlink` reason (#11).
  Method: the pnpm `tsc` check, the `readdir` one-liner and `bun stub.ts` in `/tmp/bp-verify/mirage`; `bun --filter amond test`
  STOP: with `mirage-node` installed, Mirage's shell `rm` rejects `-r`, `-f` or `--`, or its missing-path exit codes differ from coreutils.
- [x] T006 Bound the boxd readiness probe and retry it after a failure, and bump it to version 2 (file: blueprints/sandbox--boxd.md) [FR-6, FR-11, AC-013, AC-014, AC-021]
  Validation: a probe that never answers fails the check within the budget plus one poll interval (#17). A later `createSandbox()` probes again after a failed check (#18).
  Method: `bun extract.ts <fixed blueprint> && bun test boxd.test.ts` in `/tmp/bp-verify/daytona-boxd/sim`; `bun --filter amond test`
- [x] T007 Validate islo env names and chunk large writes, and bump it to version 2 (file: blueprints/sandbox--islo.md) [FR-7, FR-11, AC-015, AC-016, AC-021]
  Validation: the key `X=1; echo hi; Y` rejects before spawning, and `FOO` still passes (#19). A 200 KB write passes no argument over the per-argument limit and decodes byte-identical (#20).
  Method: `bash inj.sh` and the `e2big` harness in `/tmp/bp-verify/islo-modal`, with `/bin/echo` standing in for the islo CLI; `bun --filter amond test`
- [x] T008 Surface Modal's `stat` error and correct its comment, and bump it to version 2 (file: blueprints/sandbox--modal.md) [FR-8, FR-11, AC-017, AC-021]
  Validation: `stat` on a missing path throws with "No such file or directory" (#22). The comments say one `stat -c` call serves GNU and BusyBox (#21).
  Method: run the fixed command on a missing path; `grep -c "Fall back"` prints 0; `bun --filter amond test`

### Phase 3: Text fixes, change record, attribution

- [x] T009 Align the Daytona create examples and the sandbox directive wording (file: blueprints/sandbox.md) [FR-9, FR-10]
  Validation: both Daytona examples call `client.create()` (#16). `sandbox.md` says the directive prologue must contain `'use agent';` (#23). Neither version changes.
  Method: `grep -n "client.create" blueprints/sandbox--daytona.md`; `bun /tmp/bp-verify/islo-modal/scan-check.ts` from `packages/agent-vite`; `bun --filter amond test`
- [x] T010 Record every change from Flue deee93b (file: apps/registry/CHANGES.md) (depends on T001, T002, T003, T004, T005, T006, T007, T008, T009) [FR-12, AC-018, AC-019]
  Validation: for each blueprint, the record lists every change other than #35's rename and left-out-package edits, with the finding it fixes and the version it shipped in. Every such hunk in a diff against `vendor/flue/blueprints/` has an entry. With every fix in place, the CLI index and the registry build accept all blueprints.
  Method: diff each file against `vendor/flue/blueprints/` with the rename reverted, then check each remaining hunk against the record; `bun run lint`; `bun --filter amond test` and `bun --filter @amond-ai/registry test`
- [x] T011 Say in the registry attribution that amond corrected the blueprints (file: apps/registry/src/build.ts) [FR-13]
  Validation: the footer still names the license, the notice and `deee93b`, and adds that amond corrected the file and lists its changes in the source repository's `apps/registry/CHANGES.md`. `apps/registry/NOTICE`, the README's Attribution section and `ARCHITECTURE.md` agree.
  Method: `bun --filter @amond-ai/registry test`; `bun run lint`
- [x] T012 Draft the upstream reports and the #37 outcomes (file: .please/docs/tracks/active/blueprint-findings-20261020/upstream-reports.md) (depends on T010) [FR-14, FR-15]
  Validation: one report per changed blueprint, with the defect, a reproduction and the fix. An outcome table covers all 25 findings (#1–#23, N1, N2): fixed, with file and version; or declined, with the reason (#15 cites `sandbox-api.md:116,219`). Nothing is posted.
  Method: the table rows match investigation.md Section 3's numbering one to one

## Key Files

- `blueprints/*.md` (the 10 files above): the fixes. `apps/registry/CHANGES.md`: the record (T010).
- `apps/registry/src/build.ts`, `apps/registry/src/build.test.ts`, `apps/registry/NOTICE`, `ARCHITECTURE.md`: the attribution (T011).
- `packages/cli/src/lib/blueprint-index.ts`, `packages/cli/docs/reference/sandbox-api.md`: the version contract and the sandbox contract (read only).

## Verification

- [x] Each task's `Method:` passes against the fixed text, with the output recorded in Progress.
- [x] `bun run lint`, `bun run build`, `bun run check` and `CI=true bun run test` pass; the CLI index and the registry build parse every blueprint (AC-018).
- [x] `bun --filter @amond-ai/registry build`, then `dist/exedev.md` ends with the new footer and its Upgrade Guide shows Version 2.

## Review Focus

- T001: an exe.dev `cwd` or `env` value with shell syntax, or a command ending in `&` or `# c`, never runs outside the `cd` guard.
- T007: an islo env key or write chunk with shell syntax never runs as a command.
- T005: a Mirage `rm` path starting with `-` is removed as a path, not read as a flag.
- Mirage `rm` with `force` on a directory without `recursive` still fails, as `fs.rm` does (T005).

## Progress

- [x] (2026-10-20 04:12 KST) T001 Fix the exe.dev adapter and bump it to version 2 (SHA: `d8286023`)
  Evidence: `bun repro.ts` (v2 extract) → F1 bad cwd+env exit 1 with empty stdout; F1b multi-statement and F1c `# c` exit 1 with empty stdout; F1d good cwd exit 4; F2 recursive mkdir rejects with the stderr; F3 no exit status rejects. `bunx tsc -p . | grep -c ^src/` → 0 (was 3× TS2322). `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 11 passed.
  Deferred: a signal-killed command is covered by the `typeof code !== 'number'` branch plus `close.cjs` showing ssh2 delivers `close(null, signal)`; the fake server maps signals to exit 255, so no end-to-end signal run.
- [x] (2026-10-20 04:12 KST) T002 Fix the Cloudflare image tag and agent wiring, and bump it to version 2 (SHA: `bc2bd571`, `e6012dfc`)
  Evidence: `bash /tmp/bp-verify/cloudflare/check1.sh` → install=0.11.0 tag=0.11.0, PASS; body-scoped `grep -c "cloudflare-sandbox'"` → 0; `grep -c cloudflare:workers` → 3; `bun --filter amond test` → 61 passed.
- [x] (2026-10-20 04:12 KST) T003 Fix the vitest-evals harness, port and starter eval, and bump it to version 2 (SHA: `53b0e289`)
  Evidence: `bunx tsc -p .` against vitest-evals 0.13.1 → exit 0 (was 6× TS2339); `bunx vitest run` → probe2 (no usage, v2 guard) and nocost (usage without cost) pass, the v1 probe still fails as the before-case; body-scoped `grep -c 3583` → 0; `bun --filter amond test` → 61 passed.
- [x] (2026-10-20 09:30 KST) T004 Cancel a Cloudflare Computer exec aborted while starting, and bump it to version 2 (SHA: `64efcc2e`)
  Evidence: `bun sim-fixed.ts` in `/tmp/bp-verify/cloudflare`, with `settleExec` re-extracted from the v2 text → case A `rejected:AbortError killed= true`; case B (signal already aborted) `rejected:AbortError killed= true` (v1: HUNG). `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 11 passed.
- [x] (2026-10-20 09:30 KST) T005 Fix the Mirage install steps, `readdir` and `rm`, and bump it to version 2 (SHA: `902c17e4`, `36d10883`)
  Evidence: the whole extracted v2 adapter under pnpm with `@struktoai/mirage-node@^0.0.6 @struktoai/mirage-core@0.0.6` (`@amond-ai/agent` types stubbed) → `tsc --noEmit --strict` exit 0; with the v1 install (`^0.0.2`, core 0.0.2) → TS2367 at the `stat` comparison. `bun check.ts` against a real Mirage 0.0.6 `Workspace` → `/data/sub/` lists as `sub`; `force` on a missing path resolves; `recursive` alone on a missing path rejects; `force` on a directory without `recursive` rejects ("Is a directory"); a `-dash` path is removed as a path; a failed `unlink` reports `EACCES`. STOP check `bun stop.ts` → Mirage's shell `rm` accepts `-r`, `-f`, `--` with coreutils exit codes, so the STOP condition did not fire. `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 11 passed.
- [x] (2026-10-20 09:30 KST) T006 Bound the boxd readiness probe and retry it after a failure, and bump it to version 2 (SHA: `af6ee078`)
  Evidence: `bun extract.ts <v2 blueprint> && bun test boxd.test.ts` in `/tmp/bp-verify/daytona-boxd/sim` → 2 pass (v1: 0/2): a never-answering probe rejects within the budget plus one interval, and a later `createSandbox()` probes again after a failure. `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 11 passed.
- [x] (2026-10-20 09:30 KST) T007 Validate islo env names and chunk large writes, and bump it to version 2 (SHA: `b5ec3c82`)
  Evidence: `bun /tmp/bp-verify/islo-modal/t007/run.ts` (adapter re-extracted from v2, a local stand-in for the islo CLI) → a 200 KB write is `cmp` identical over 8 execs, the largest argv entry is 65633 < 131072, no temp file is left; the keys `X=1; echo hi; Y`, `''`, `1BAD` and `a-b` reject with nothing spawned; `FOO` and `_ok9` pass. `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 11 passed.
  Deferred: the v1 before-state was not re-run here (`inj.sh` and the `e2big` harness timed out under `bash -lc`); it rests on investigation.md #19 and #20.
- [x] (2026-10-20 09:30 KST) T008 Surface Modal's `stat` error and correct its comment, and bump it to version 2 (SHA: `a78e85b7`)
  Evidence: `bash /tmp/bp-verify/islo-modal/t008/check.sh` → the error changes from `exit 1` to `stat: cannot statx '…/missing': No such file or directory`; body-scoped `grep -c "Fall back"` → 0. `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 11 passed.
- [x] (2026-10-20 09:40 KST) T009 Align the Daytona create examples and the sandbox directive wording (SHA: `01180deb`)
  Evidence: `grep -n client.create blueprints/sandbox--daytona.md` → `:61` and `:347` both `client.create()`; `bun /tmp/bp-verify/islo-modal/scan-check.ts` from `packages/agent-vite` → the directive is found first, after `'use strict'` and after a comment, and not after an import, which matches the new prologue wording; both files stay at version 1. `bun --filter amond test` → 61 passed.
- [x] (2026-10-20 09:49 KST) T010 Record every change from Flue deee93b (SHA: `dc4a5429`)
  Evidence: each of the 16 blueprints diffed against `vendor/flue/blueprints/` after applying the rename → every hunk maps to a finding, an import edit (#35), a version bump or the rename's article change, with 0 unattributed. The record is `apps/registry/CHANGES.md`, and `blueprints/README.md` → Attribution names it. `bun run lint` → 11/11; `bun --filter amond test` → 61 passed; `bun --filter @amond-ai/registry test` → 12 passed.
- [x] (2026-10-20 09:50 KST) T011 Say in the registry attribution that amond corrected the blueprints (SHA: `77ead0bd`, `21e8a193`)
  Evidence: `bun --filter @amond-ai/registry build` → `dist/exedev.md` shows `### Version 2 — 2026-10-20` and ends with the footer naming the license, the notice and `deee93b`, saying some files were corrected, and pointing to `apps/registry/CHANGES.md`. `NOTICE` and `ARCHITECTURE.md` agree. A new footer test plus a NOTICE assertion → `bun --filter @amond-ai/registry test` 12 passed; `bun run lint` → 11/11.
- [x] (2026-10-20 09:50 KST) T012 Draft the upstream reports and the #37 outcomes
  Evidence: `upstream-reports.md` has 10 per-file reports in Flue's names, with line numbers checked against `vendor/flue/blueprints/`, and a 25-row outcome table. `grep -cE '^\| (#[0-9]+|N[12]) \|'` → 25, and the order diffs clean against investigation.md. `bunx eslint` exits 0. Nothing posted.

## Decision Log

- 2026-10-20: #15 (Daytona `exists()`) declined. The contract says `exists` never throws (`sandbox-api.md:116,219`).
- 2026-10-20: vitest-evals pinned to the 0.13 line, not ported to 0.17 (spec Out of Scope).
- 2026-10-20: The T002 and T003 `grep` checks cover only the body above `## Upgrade Guide`. The Version 2 diff must keep each removed line, the `../cloudflare-sandbox` import and the `3583` default, so it applies mechanically (upstream `blueprints/README.md` → Versions).
- 2026-10-20: N2 (found during T005): the v1 install `^0.0.2` resolves to exactly 0.0.2, and against 0.0.2's types the adapter's `stat` comparison fails with TS2367. The install moves to `^0.0.6` with core pinned at `0.0.6`, the version the investigation verified behavior against.
- 2026-10-20: The islo chunked `writeFile` stages its payload in the sandbox's `/tmp`, not next to the target, so a failed write never leaves a stray file in the user's directory. This assumes a writable `/tmp`.
- 2026-10-20: The boxd `readyPromise` reset sits in the `createSandbox()` catch. Every concurrent awaiter's catch runs in the same microtask burst, so the next request after a failure probes again.
- 2026-10-20: The change record moved from `blueprints/README.md` to `apps/registry/CHANGES.md` (user's choice). `docs-content.test.ts` bans the upstream name in `blueprints/` outside one attribution line, and the record needs Flue's exact names. The README's Attribution section links to it.

## Surprises & Discoveries

- Worktree executors are cut from `main`, not the track branch, and can't write the main-tree progress sink. Their commits are cherry-picked and their Progress entries written by the lead. A fresh worktree also needs `bun install` and `bunx turbo run build --filter=amond` before `bun --filter amond test`.
- On a `0.0.x` version a caret is an exact pin. The Mirage blueprint's `^0.0.2` got 0.0.2, not the 0.0.6 the investigation tested (N2). A type-check of only the import line missed it; the whole adapter has to be compiled.
- `docs-content.test.ts` also guards `blueprints/` against broken relative links, so the README names `apps/registry/CHANGES.md` as a path, not a link.

## Outcomes & Retrospective

### What Was Shipped

- All 22 confirmed findings from #37 fixed, plus N1 (vitest-evals unpinned) and N2 (Mirage `^0.0.2` pinned exactly 0.0.2). #15 declined on the sandbox contract.
- Eight blueprints at version 2, each with an Upgrade Guide entry and diff: exedev, cloudflare, cloudflare-computer, mirage, vitest-evals, boxd, islo, modal. Daytona and `sandbox.md` got text-only fixes.
- `apps/registry/CHANGES.md` records every change from Flue `deee93b`. The registry footer and `NOTICE` say amond corrected some blueprints and point to it.
- Draft upstream reports for Flue and the #37 outcome table in `upstream-reports.md`. The outcomes are posted on #37; the reports are not filed.

### What Went Well

- Checking each finding with a scratch harness against the real SDK gave every verdict and fix a concrete before/after, and caught N1 and N2.
- Grouping phases by whole blueprint gave each file exactly one version bump.
- Parallel worktree executors for the five independent Phase 2 blueprints finished in one round.

### What Could Improve

- Two checks were too narrow at first. The T002 `grep` passed by dropping a removed line from the Upgrade Guide diff, and the T005 type-check compiled only the import line, which hid N2. Checks on generated code should compile the whole extracted file.
- Worktree executors are cut from `main` and can't write the progress sink, so each Phase 2 result needed a lead cherry-pick and a hand-written Progress entry.
- The plan put the change record in `blueprints/README.md` without checking `docs-content.test.ts`, whose brand and link guards forbid it. A grep for tests covering a target directory belongs in planning.

### Tech Debt Created

- islo `writeFile` leaves its `/tmp` staging file when an `exec` call throws (not on a non-zero exit). Found in review. → TD-007
- No permanent check compiles or runs blueprint samples against their SDKs; these defects came in because only structure is checked (spec Out of Scope). → TD-008
- The vitest-evals harness is pinned to the 0.13 line rather than ported to the current 0.17 API (spec Out of Scope). → TD-009
