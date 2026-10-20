## Bug Investigation Report

Issue [#37](https://github.com/amond-ai/agent/issues/37): cubic left 23 findings on the Flue blueprints imported in #35, and Codex rated one of them P1. Each flagged line matches Flue `deee93b` (`vendor/flue/blueprints/`) apart from the rename, and Flue's `blueprints/` has no commits since `deee93b`.

This is not one bug with competing causes. It is 24 independent claims about the text of 10 blueprints. Each claim got its own check, and the check decided its verdict. Sections 1 to 3 below are therefore organized per finding.

### 1. Reproduction Status

Reproduced: 22 of the 23 findings, plus 1 defect cubic did not flag. One finding is declined, because its suggested fix contradicts the sandbox contract.

Every check runs from a scratch directory under `/tmp/bp-verify/<group>/`. It extracts the blueprint's code verbatim, or rebuilds the exact string the code composes, and runs it against the real SDK at the version the blueprint installs. Each check fails today and passes with the proposed fix applied in scratch. The repository was not modified.

### Feedback Loop

- **Loop type:** throwaway harness and HITL bash script, one per finding (§2.5 means 6 and 10). Blueprints are documents, so no running service exists to hit.
- **How to run:** each finding's **Check** column in Section 3. The loop proven first is `bash /tmp/bp-loop/exedev-cd.sh`, which exits 1 while the bug is present.
- **Pass/fail criteria:** a finding's check reports the defect (a `tsc` error, a hung or wrong-result simulation, a shell command that runs when it should not, or a text mismatch) = bug present; the check passes against the fixed text = fixed.
- **Reproduction rate:** N/A, deterministic.
- **Debug tag:** `[DEBUG-7c3e]`. It appears only in scratch files under `/tmp`; nothing was added to the repository.
- **Bypass approved:** no.

The scratch directories live in `/tmp` and do not survive a reboot. Each fix task re-creates its check from the description in Section 3 when the scratch copy is gone.

### Hypothesis Ranking

- **Ranked list:** one hypothesis per finding, in the form "if the flagged text causes the described defect, then the extracted code or composed command shows it, and the corrected text does not". The checks decided all 24, so ranking them against each other adds nothing. The shared root cause in Section 2 was the only cross-finding hypothesis.
- **Per-hypothesis verdict:** Section 3, the **Verdict** column. Each verdict comes from a check that was run, except where the column says static.
- **Confirmed hypothesis:** 22 findings plus N1 and N2 (N2 found during T005). The declined finding is Daytona `exists()` (`sandbox--daytona.md:226`).
- **User intervention:** yes. Before the analysis the user chose "fix here, draft upstream reports" and "all 23 findings in one track".
- **Procedure note:** the §4.0 `please:debugger` pass was not dispatched. The per-finding checks already prove or disprove each claim, and the shared cause in Section 2 needs no runtime evidence. Six verification workers, one per blueprint group, replaced the single §3.0 analyzer because each claim needed its SDK installed and run.

### 2. Root Cause Analysis

**Problem Location:** the code samples and instructions in 10 files under `blueprints/`. These files are served from the registry and handed to a coding agent by `amond add`.

**Root Cause:** the blueprints are prose plus code that nothing compiles or runs. `validateBlueprintBody` (`packages/cli/src/lib/blueprint-index.ts:38`) checks only structure: the frontmatter, the Upgrade Guide, and the version entries. Flue has no sample check either. The defects therefore came in with the import at `deee93b`:

- type errors under `strict`;
- shell composition bugs;
- error handling that reports success or the wrong cause;
- examples that contradict the blueprint's own rules;
- install steps that do not pin the version the code was written against.

### 3. Proposed Solutions

**Recommended:** correct each confirmed defect in the blueprint text, as the **Fix** column below describes. Bump `version` for each blueprint whose generated code or install steps change. Record every change from `deee93b` so a later hand-sync keeps it. Decline Daytona `exists()` with the contract as the reason.

**Alternatives considered:**

- **Report upstream first and port Flue's fixes when they land.** The user chose to fix here. The served blueprints would stay broken for an unbounded time.
- **Add a permanent harness that extracts every sample and type-checks it against its SDK.** That would prevent a recurrence. It needs 8 provider SDKs as dev dependencies, and it is a separate design decision, so it goes out of scope as a follow-up.

#### Findings

The line numbers refer to the current file.

| # | Location (comment) | Verdict | Check (scratch dir) | Fix | Bump |
| --- | --- | --- | --- | --- | --- |
| 1 | `sandbox--exedev.md:695` (4310835144, P1) | Confirmed, and wider than reported. The env prefix is joined with `;` and `cd … && ` is prepended to it, so a failed `cd` skips only the first `export`. A multi-statement command fails the same way with only `cwd` set: `echo a; echo b` prints `b`. | `exedev/`: `bash cd.sh`; `bun repro.ts` F1 returns exit 0 with output | Wrap the env and command body in a brace group with the braces on their own lines: `cd '<cwd>' && {⏎<env>; <cmd>⏎}`. A trailing `# comment` or `&` in the command then cannot swallow the closing brace. | v2 |
| 2 | `sandbox--exedev.md:645` (4310835215) | Confirmed. `mkdir` with `recursive` discards the exec result, while the non-recursive branch (`:650`) rejects. | `exedev/`: `bun repro.ts` F2 resolves for `/proc/nope/x` | Throw on a non-zero exit code with the stderr. `sandbox--mirage.md:172-175` already does this. | v2 |
| 3 | `sandbox--exedev.md:737` (4310835227) | Confirmed, and wider. With no exit status, `close(undefined)` turns into 0 through `?? 0`. A command killed by a signal arrives as `close(null, signal)` and also becomes 0. Sources: ssh2 `lib/utils.js:93-102`, `lib/client.js:666-676`. The listener type at `:452` hides `null` and `undefined`. | `exedev/`: `bun close.cjs`; `bun repro.ts` F3 returns `exitCode: 0` | Type the listener as `(code: number \| null \| undefined, signal?: string)`, remove `?? 0`, and reject unless `code` is a number. That matches the intent of the comment at `:499-503`. | v2 |
| 4 | `sandbox--exedev.md:858`, also `:883`, `:907` and doc comment `:93` (4310835301) | Confirmed under `strict`: 3× TS2322. | `exedev/`: `bunx tsc -p . \| grep ^src/` | Check each environment variable before use, with a small helper that throws when it is unset. Only the snippets change. | v2 |
| 5 | `sandbox--cloudflare.md:119` (4310835261) | Confirmed. `^0.11.0` resolves to 0.11.0, the image tag `cloudflare/sandbox:0.11.0` exists, and the example pins `0.9.2`, which breaks the hard rule at `:248-251`. | `cloudflare/`: `bash check1.sh` | Change the tag to `0.11.0`, and change the replacement note at `:122` to match. | v2 |
| 6 | `sandbox--cloudflare.md:137` (4310835247 cubic P2; 4311930607 Codex P1) | Confirmed, P1. The snippet imports `../cloudflare-sandbox`, which no step creates; the hard rules (`:241-243`, `:150`) say no such file is needed. The claim at `:129-133` that no stable API reaches platform `env` is contradicted by `packages/cli/docs/ecosystem/sandboxes/cloudflare.md:36-52`. | `grep -n "cloudflare-sandbox'"` finds 1 match; `grep -c cloudflare:workers` finds 0 | Replace the example and its stand-in paragraph with the guide's wiring: `env` from `cloudflare:workers`, the agent takes `{ id }: AgentProps`, and calls `useSandbox(cloudflareSandbox(getSandbox(Sandbox, id)))`. | v2 |
| 7 | `sandbox--cloudflare-computer.md:238` (4310835320) | Confirmed. If the signal aborts while `exec()` is pending, the listener is added after the event and never fires, so the call hangs and the run is never killed. This adapter returns a `Sandbox` directly, not through `sandboxFromDriver`, so it owns the caller-facing abort. | `cloudflare/`: `bun sim.ts`, case B hangs | Before adding the listener: `if (signal.aborted) { onAbort(); return; }` | v2 |
| 8 | `sandbox--mirage.md:81` (4310835282) | Confirmed, narrower. A type import from `@struktoai/mirage-core`, which arrives only transitively, at the runtime package's exact version (N2: the install gets 0.0.2, not 0.0.6). Under pnpm strict or Yarn PnP, the blueprint's own `tsc` verify step fails with TS2307. npm and bun hoist the package, so they pass. | `mirage/pn`: `npx tsc … a.ts` gives TS2307 | Add `@struktoai/mirage-core`, at the runtime package's exact version, to both install commands (`:212-224`). | v2 |
| 9 | `sandbox--mirage.md:161` (4310835275) | Confirmed, latent. The code drops `/data/sub/` while the comment at `:157-159` says it strips the slash. Mirage 0.0.6 `RAMResource` returns no trailing slashes, so only other resources trigger it. | `bun -e` one-liner returns `["a.txt"]` | Strip trailing slashes before taking the basename, and keep the filter that drops the root. | v2 |
| 10 | `sandbox--mirage.md:184-195` (4310835273) | Confirmed against the contract. `packages/cli/docs/reference/sandbox-api.md:221` says an adapter that already runs other verbs through the shell must implement `recursive` and `force` with `rm` there, and this adapter shells out for `mkdir -p` (`:172`). | Static only: comparing the blueprint against the contract line. Shell `rm` under `mirage-node` was not run. | When a flag is set, run `rm [-r] [-f] -- <quoted path>` through the shell and throw on a non-zero exit. Then remove the unused `SandboxOperationUnsupportedError` import (`:79`) and update the class doc (`:113-114`). | v2 |
| 11 | `sandbox--mirage.md:196-200` (4310835270) | Confirmed with a stub. An `unlink` EACCES is surfaced as the `rmdir` ENOTDIR. | `mirage/sdk`: `bun stub.ts` | Call `stat` first, then `rmdir` or `unlink` by the path's type. Fix it together with #10, since both rewrite `rm`. | v2 |
| N2 | `sandbox--mirage.md:312,318` (upstream numbering), not flagged; found during T005 | Confirmed. The install is `@struktoai/mirage-node@^0.0.2`, and on a `0.0.x` version a caret is an exact pin, so it installs 0.0.2, not the 0.0.6 that #8–#11 were checked against. Against 0.0.2's types the adapter's `stat` comparison fails with TS2367, under every package manager. | `mirage/pn2`: whole-adapter `tsc --noEmit --strict` with 0.0.2 gives TS2367; `mirage/pn3` with 0.0.6 exits 0 | Install `@struktoai/mirage-node@^0.0.6` (or `mirage-browser`) with `@struktoai/mirage-core@0.0.6`. | v2 |
| 12 | `tooling--vitest-evals.md:140` (4310835166, P1) | Confirmed: 6× TS2339 under `strict`. The type is `metadata?: Record<string, unknown>` (`packages/agent-sdk/src/public/conversation.ts:154`). | `vitest-evals/`: `bunx tsc -p .` | Declare local `ReplyUsage` and `ReplyModel` types, cast to them at `:129-130`, and make `cost` optional. | v2 |
| 13 | `tooling--vitest-evals.md:174` (4310835368) | Confirmed. The harness defaults to port 3583, where nothing listens; the dev server serves 5173 (`packages/cli/src/lib/init.ts:200,389`). | `grep -n 3583` finds it | Change `3583` to `5173`. | v2 |
| 14 | `tooling--vitest-evals.md:183` (4310835361) | Confirmed. The runtime stamps no usage (`conversation.ts:150-152`). The symptom is an assertion failure, "actual value must be number or bigint", not a crash. | `vitest-evals/`: `bunx vitest run` exits 1 | Make the token assertion conditional on the agent attaching usage metadata, and update the wording at `:160` and in the Verify step. | v2 |
| N1 | `tooling--vitest-evals.md:19`, not flagged | Confirmed. The install step does not pin `vitest-evals`. The blueprint is dated 2026-06-18, the day 0.13.1 shipped. In 0.14.0 and later (latest is 0.17.0) the `SimpleToolCallRecord` export is gone (TS2305), and run results require `messages`. | `vitest-evals/` with 0.17.0 installed: `bunx tsc -p .` gives TS2305 | Pin `vitest-evals@^0.13.1` in the install step. Porting the harness to 0.17 is a follow-up. | v2 |
| 15 | `sandbox--daytona.md:226` (4310835191) | **Declined.** cubic is right that a 401, a 500 or a connection error returns `false`. But the contract says `exists` must never throw (`sandbox-api.md:116`, `:219`). Rethrowing those errors, as cubic suggests, would break it. Rethrowing `SandboxDiedError` already follows the separate liveness rule (`:235`). | `daytona-boxd/sim`: `bun test daytona.test.ts`, which shows the behavior | None. Reply on #37 citing the contract. | none |
| 16 | `sandbox--daytona.md:61` vs `:347` (4310835408, P3) | Confirmed. The examples disagree, and the difference matters: `create()` uses the default snapshot, while `{ image: 'ubuntu:latest' }` builds an image on first use (`Daytona.js:255-300`). | `grep -n client.create` | Use `client.create()` at `:61`. The change is in a doc comment and doesn't change what the code does, so no bump. | none |
| 17 | `sandbox--boxd.md:126` (4310835174) | Confirmed. `execSimple` arms a timer only when `timeoutMs` is set (`box.js:176-186`), so a hung probe blocks forever. | `daytona-boxd/sim`: `bun test boxd.test.ts` reports still-pending | Pass `{ timeoutMs: Math.max(1, deadline - Date.now()) }` to the probe. | v2 |
| 18 | `sandbox--boxd.md:411` (4310835373, P3) | Confirmed. `??=` keeps a rejected promise. | Same test, case "finding 4": 0 new probes | On rejection, clear `readyPromise` and rethrow. | v2 |
| 19 | `sandbox--islo.md:109` (4310835330) | Confirmed. Hardening only: the keys come from the developer's own code. | `islo-modal/`: `bash inj.sh` prints INJECTED | Throw unless the key matches `^[A-Za-z_][A-Za-z0-9_]*$`. That also rejects an empty key. | v2 |
| 20 | `sandbox--islo.md:176` (4310835240) | Partly confirmed. The size limit is real: 128 KiB per argument, so the largest write that spawns is 98,196 bytes. The error is a bare synchronous `spawn E2BIG` thrown inside the Promise executor (`:132`), not "failed to spawn 'islo'". | `islo-modal/`: `node e2big2.mjs`; `node e2big3.mjs` | Write the payload in base64 chunks of about 64 KB each, appended to a temporary file, then decode it once. Each `exec` then stays under the limit. Stdin piping was rejected because it is unverified whether the islo CLI forwards stdin. | v2 |
| 21 | `sandbox--modal.md:237-241`, also `:34` (4310835427, P3) | Confirmed. The comment promises a GNU-then-BusyBox fallback, but the code makes one `stat -c` call. That BusyBox accepts it is unverified: no binary was available here. | `grep -c "Fall back"` returns 1 | Replace it with a one-line comment that one `stat -c` serves both, and reword `:34`. | rides #22 |
| 22 | `sandbox--modal.md:244` (4310835417, P3) | Confirmed. `2>/dev/null` reduces every failure to `exit 1`. | `stat … /nonexistent 2>/dev/null` | Remove the redirect. | v2 |
| 23 | `sandbox.md:86-87` (4310835183) | Confirmed. The text is stricter than the scanner: `findAgentDirectiveStatement` (`packages/agent-vite/src/agent-scan.ts:362-371`) accepts `'use agent'` anywhere in the directive prologue. | `cd packages/agent-vite && bun /tmp/bp-verify/islo-modal/scan-check.ts` | Say the directive prologue, which is everything before any import or other statement, must contain `'use agent';`. | none |

Every flagged line, N1 and N2, is identical in `vendor/flue/blueprints/` at `deee93b` apart from the rename. Each confirmed defect is therefore also Flue's.

**Version bump contract.** Upstream `blueprints/README.md` (Versions section) sets it, and `validateBlueprintBody` enforces it. A bump to version N updates:

- the frontmatter `version`;
- every `// amond-blueprint: <kind>/<slug>@N` marker example;
- a new `### Version N — YYYY-MM-DD` Upgrade Guide entry, with prose and a fenced unified diff that has `--- ` and `+++ ` headers against the previous version.

Editorial changes that don't alter implementation behavior need no bump.

This gives 8 bumps to version 2: exe.dev, Cloudflare, Cloudflare Computer, Mirage, vitest-evals, boxd, islo and Modal. Daytona and `sandbox.md` change text only.

### 4. Testing Requirements

- **Bug scenario:** each finding's check in Section 3, re-run against the fixed blueprint text. The existing suites must also pass, because they parse every blueprint and its Upgrade Guide (`packages/cli` blueprint index tests and `apps/registry` build tests).
- **Edge cases:**
  - exe.dev `cwd` with an invalid directory and a multi-statement command → exit 1 with no output.
  - exe.dev `cwd` valid, with env, `pwd; exit 4` → runs in `cwd`, exit 4.
  - exe.dev command ending in `# c` with an invalid `cwd` → exit 1.
  - exe.dev command killed by a signal (`exit-signal`) → rejects, not exit 0.
  - exe.dev `mkdir` with `recursive` through `writeFileCreatingParents` → still tolerated, because `packages/agent/src/sandbox.ts:150-170` swallows the error by design.
  - Cloudflare Computer signal already aborted when `exec()` returns → `AbortError`, the run killed once, the handle disposed.
  - Mirage `rm` with `force` on a missing path → resolves.
  - Mirage `rm` with `recursive` on a missing path → rejects.
  - Mirage `rm` with `force` on a directory without `recursive` → rejects.
  - Mirage `rm` on a path starting with `-` → handled through `--` plus quoting.
  - Mirage `readdir` of `/` or `//` → dropped.
  - Mirage `readdir` of `/data/a//` → `a`.
  - vitest-evals usage present without cost → no throw.
  - vitest-evals agent without a usage hook → the starter eval passes.
  - boxd with `readyTimeoutMs <= 0` → no probe, unchanged.
  - boxd concurrent `createSandbox()` during a failing probe → all reject, and the next call probes again.
  - islo env key `''`, `1BAD`, `a-b` → throws before spawn.
  - islo `FOO`, `_ok9` → accepted.
  - islo 200 KB `writeFile` → succeeds.
  - Modal stat on a missing path → the error message carries "No such file or directory".

### 5. Similar Code Patterns

These were noted during the investigation. None was flagged, and all are out of scope:

- `blueprints/sandbox--cloudflare-computer.md:321-324`: `exists()` rethrows errors other than ENOENT and ENOTDIR, which breaks the contract's "must not throw" rule.
- `blueprints/sandbox--exedev.md:636-639`: `exists()` uses the same return-false-on-any-error pattern as Daytona, which the contract allows.
- `blueprints/sandbox--islo.md`: any `exec` command over about 130 KB hits the same argv limit as `writeFile`, not only writes.
- `blueprints/sandbox--boxd.md:131`: the 500 ms poll sleep can overrun `readyTimeoutMs` by up to 500 ms.
- `blueprints/tooling--vitest-evals.md`: the harness targets the `vitest-evals` 0.13 API; 0.17 needs a port.
