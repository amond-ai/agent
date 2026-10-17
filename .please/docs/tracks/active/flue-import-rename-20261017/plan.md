# Plan: Import Flue's packages and rename them to amond

> Track: flue-import-rename-20261017
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: flue-import-rename-20261017
- **Issue**: #20
- **Created**: 2026-10-17
- **Approach**: three stacked PRs — import with history, rename, then website and content
- **Plan Depth**: standard
- **Planned At**: 6d7b8a3

## Context

### Problem

Phases 1–4 of ADR-0004 need Flue's packages here, under amond names, on this repository's tools.
What exploration found that the spec does not say:

- Flue 2.3.0 ships two test files, both in `react/src`. The CLI `test` script and the Vite
  integration script point at missing files. Behaviour preservation rests on the type check, the
  React tests, and the checks T006, T008 and T009 add.
- About 741 relative imports end in `.ts`, which TypeScript 5.9 allows only with `noEmit`. Flue's
  base adds `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `allowArbitraryExtensions`,
  `allowJs`. `runtime/src/mcp.ts:10` imports `../package.json`.
- Flue uses tabs and semicolons; this repository's ESLint config enforces two spaces and none, so
  `eslint --fix` touches nearly every line.
- The CLI prebuild runs `tsx scripts/generate-blueprint-index.ts`, which reads a repo-root
  `blueprints/` and writes the gitignored `src/generated/blueprints.ts`. No `tsx` here, no
  directory, so the build fails as imported.
- The `main` ruleset (id 25238896) allows squash merges only.

### STOP Conditions

- Before merging the Phase 1 PR: if the ruleset still allows squash only, stop and ask the user to
  allow a merge commit for it. Never squash it; that collapses the history.
- If type-checking or linting the code needs a runtime code change, not a type annotation, a
  config change or an autofix, stop and report the case.

### Non-Goals

Considered and not built:

- An ESLint override keeping Flue's style: blame stays intact, but the repository gets two styles.
- Stitching `packages/runtime`'s history from before its rename onto `packages/agent` with
  `git filter-repo`. The spec accepts history from the rename on.

## Architecture Decision

**History first, renames second, in separate PRs.** In a full clone of withastro/flue at
`deee93b`, `git subtree split --prefix=packages/<name>` runs per package, and `git subtree add`
brings each split into `packages/<dir>` with the revision in the merge message. Phase 1 gets the
packages green under their Flue names; Phase 2 renames on that baseline, so a rename that breaks
something shows as its own diff. Phase 1 merges with a merge commit, the only way Flue's commits
reach `main`; Phases 2 and 3 squash as usual.

**Reformat once, ignore it in blame.** The ESLint autofix is a commit with no other change. T012
records its SHA and Phase 2's, once final on `main`, in `.git-blame-ignore-revs`. Rules autofix
cannot satisfy are switched off for the imported packages in `eslint.config.ts`, one by one,
mirroring what Flue's Biome config relaxed. Code is not rewritten to satisfy a rule.

**tsconfigs extend the root and restore Flue's compiler options** (`noEmit`,
`allowImportingTsExtensions`, `composite: false`, the stricter flags, per-package `types` and
`lib`). tsdown keeps emitting the build, so `check` is `tsc --noEmit`. Shared tooling moves to
`catalog:`; runtime dependencies keep Flue's ranges.

**CLI content:** the blueprint generator runs under Bun and writes an empty index when the
directory is absent, so track 2 only adds the directory. `docs`, `add` and `update` check for a
missing docs root or an empty index first and exit with one message.

**Release wiring waits for the renames** (Phase 2), so no release PR proposes `@flue/*` names.

Rejected: one PR for the whole track, which cannot be merge-committed and stay reviewable.

## Tasks

### Phase 1: Import with history onto the toolchain

- [x] T001 Import the five packages with history and retire packages/amond (file: packages/agent/package.json)
  Validation: `git log -- packages/agent` lists Flue commits, and each subtree merge message names `deee93b`. Each imported tree matches `vendor/flue/packages/<name>`. `packages/amond` and its release-please and manifest entries are gone.
  Method: `git log --oneline -- packages/agent | head`; `diff -r` against `vendor/flue/packages/<name>`
  STOP: a package's split tree differs from `vendor/flue/packages/<name>`.
- [x] T002 Build and test the packages with Bun workspaces (depends on T001, file: packages/cli/package.json)
  Validation: `bun install --frozen-lockfile`, `bun run build` and `bun run test` pass at the root with pnpm, Biome and Prettier files gone. The CLI builds with no `blueprints/` directory and no `tsx`. The two React tests run in the root test command.
  Method: `bun install --frozen-lockfile && bun run build && bun run test`
- [x] T003 Type-check the packages under the repository's TypeScript (depends on T002, file: packages/agent/tsconfig.json)
  Validation: `bun run check` passes at the root, with only tsconfig and type-level edits, each listed in the commit body.
  Method: `bun run check`
- [x] T004 Lint the packages with the repository's ESLint config (depends on T002, file: eslint.config.ts)
  Validation: `bun run lint` passes. The autofix is one commit containing nothing else. Each rule switched off for the imported packages carries its reason in `eslint.config.ts`.
  Method: `bun run lint`; `git show --stat` on the reformat commit

### Phase 2: Rename to amond

- [x] T005 Rename the packages and every brand surface in source (depends on T003, T004, file: packages/agent-vite/src/amond-plugin.ts)
  Validation: names, bin and directories match the spec's table, and `amond --help` lists `init`, `run`, `docs`, `add` and `update`. The SC-2 search returns only attribution lines and `flueframework.com` links (Phase 3's). A project with only `flue.config.ts` runs on defaults (the old name is never read), and a missing explicit config file errors naming `amond.config.ts`. Build, check, lint and test pass.
  Method: `grep -rniE "@flue/|\bflue\b|FLUE_" packages/` plus the root commands
- [ ] T006 Prove the Worker build on a minimal 'use agent' fixture (depends on T005, file: packages/agent-vite/src/worker-build.test.ts)
  Validation: `vite build` with `@amond-ai/agent-vite` on a one-agent fixture emits a Worker that exports `Amond<Name>Agent`, binds it as `AMOND_<NAME>_AGENT`, and contains no `@flue/` or `virtual:flue/` string.
  Method: `bun run --filter @amond-ai/agent-vite test`
- [ ] T007 Wire the packages into release-please at 0.1.0 (depends on T005, file: release-please-config.json)
  Validation: config and manifest list the five directories at 0.1.0, matching each package version. `scripts/publish.ts` orders the CLI after the runtime and the plugin.
  Method: `jq` over both files; a dry-run listing from `scripts/publish.ts`

### Phase 3: Website, content, attribution

- [ ] T008 Make docs, add and update fail cleanly with no bundled content (file: packages/cli/src/commands/blueprints.ts)
  Validation: `amond docs`, `amond docs read guide/tools`, `amond add` and `amond update channel slack` each exit non-zero saying no content is bundled, with no network request, including when `AMOND_REGISTRY_URL` names an unreachable host.
  Method: a CLI test that runs the built binary (`bun run --filter amond test`)
- [ ] T009 Replace links to Flue's website in code, scaffolds and package metadata (file: packages/cli/src/lib/init.ts)
  Validation: no `flueframework.com` remains in the five packages. Docs links read `amond docs read <page>`, except links to pages mostly about a package left in Flue, which are dropped. `homepage` and `repository` point at amond-ai/agent. `amond init` writes files that name amond, not Flue.
  Method: `grep -rn flueframework.com packages/`; a CLI test running `amond init` in a temp dir
- [ ] T010 Add Flue's notice to NOTICE and rewrite the package READMEs (file: NOTICE)
  Validation: `NOTICE` carries Flue's copyright and license notice. Each imported README describes the amond package and states that it is derived from Flue.
  Method: read the files; the SC-2 search over `packages/`
- [ ] T011 Update README, ARCHITECTURE and tech-stack for the imported packages (file: ARCHITECTURE.md)
  Validation: the three documents describe the five packages and their build path, and none describes `packages/amond` as present.
  Method: `grep -n "packages/amond" README.md ARCHITECTURE.md docs/knowledge/tech-stack.md`
- [ ] T012 Record the reformat and rename commits in .git-blame-ignore-revs (file: .git-blame-ignore-revs)
  Validation: the file lists T004's reformat commit and Phase 2's squash commit as they are on `main`, and `git blame` with it attributes a reformatted line to an upstream commit.
  Method: `git blame --ignore-revs-file .git-blame-ignore-revs packages/agent/src/session.ts | head`
  STOP: Phase 1 or Phase 2 is not merged, so the SHAs are not final.

## Key Files

- `packages/{agent,agent-vite,cli,agent-sdk,agent-react}/` — the imported packages
- `package.json`, `bun.lock`, `turbo.json`, `tsconfig.json`, `eslint.config.ts`, `vitest.shared.ts`
- `release-please-config.json`, `.release-please-manifest.json`, `scripts/publish.ts`

## Verification

### Automated Tests

- [ ] `bun run build && bun run check && bun run lint && bun run test` pass at the root in CI (SC-3)

### Observable Outcomes

- On `main` after Phase 1, `git log -- packages/agent` shows Flue's commits (SC-1)
- After Phase 3, the SC-2 search over the five packages returns only attribution lines (SC-2)
- SC-4 through SC-10 map to T006, T005, T008, T009, T007, T010 and T011
- Follow-ups after Phase 3: correct #20's done criteria (`vite build`) and open track 2

## Review Focus

- `AMOND_REGISTRY_URL` set to an unreachable host → `add` fails with the no-content message (T008)
- A project with only `flue.config.ts` → the old file is ignored and defaults apply, as with no config (T005)

## Progress

- [x] (2026-10-17 16:13 KST) T001 Import the five packages with history and retire packages/amond
  Evidence: `git log --oneline -- packages/agent | wc -l` → 492 (oldest 96e13f8 "refactor: rename @flue/sdk to @flue/runtime ... (#121)", tip 90e9586 v2.3.0); `diff -r packages/<dir> vendor/flue/packages/<name>` → empty for all five; commits agent 492, agent-vite 27, cli 364, agent-sdk 267, agent-react 55
- [x] (2026-10-17 17:00 KST) T002 Build and test the packages with Bun workspaces
  Evidence: `bun install --frozen-lockfile && bun run build && CI=true bun run test` → install clean (854 installs, no changes); build exit 0 (10/10 tasks, CLI built with no blueprints/ and no tsx); test exit 0 (20/20 tasks; @flue/react 2 files / 27 tests passed; agent, vite, sdk, cli: no test files, exit 0 via --passWithNoTests)
- [x] (2026-10-17 18:00 KST) T004 Lint the packages with the repository's ESLint config
  Evidence: `bun run lint` → exit 0 (10/10 tasks); `git show --stat 135eed5` → 209 files changed, 41818 insertions(+), 41438 deletions(-), nothing but the five packages; `bun run build` → exit 0; `CI=true bun run test` → exit 0 (20/20 tasks, @flue/react 2 files / 27 tests passed)
  Reformat commit: 135eed5 (config commit 8750eef). T012 lists 135eed5 in `.git-blame-ignore-revs`.
  Switched off for the five packages in `eslint.config.ts` (reason beside each there): perfectionist/sort-imports (moves `import 'virtual:flue/providers'`); behaviour-changing autofixes unicorn/prefer-type-error, unicorn/prefer-number-properties, unicorn/prefer-string-starts-ends-with, unicorn/no-new-array, e18e/prefer-timer-args, antfu/top-level-function, perfectionist/sort-exports, import/first, regexp/use-ignore-case, regexp/prefer-w, regexp/prefer-d, regexp/optimal-quantifier-concatenation; unfixable layout style/max-statements-per-line, style/no-tabs, style/no-mixed-spaces-and-tabs, style/no-trailing-spaces, style/operator-linebreak; Flue-style rules no-console, ts/no-use-before-define, node/prefer-global/process, antfu/no-top-level-await, no-fallthrough, no-unmodified-loop-condition, no-new, prefer-const, ts/no-this-alias, unused-imports/no-unused-vars, e18e/prefer-url-canparse, ts/method-signature-style, jsdoc/check-param-names, regexp/no-super-linear-backtracking, regexp/no-unused-capturing-group.
- [x] (2026-10-17 19:00 KST) T003 Type-check the packages under the repository's TypeScript
  Evidence: `bun run check` → exit 0 (15/15 tasks, all five packages included; repeated runs stable); `bun run build` → exit 0; `CI=true bun run test` → exit 0 (20/20); `bun run lint` → exit 0 (10/10) with no generated blueprints.ts, exit 1 right after a build (see Surprises)
  Commit: 273749c. Edits are config or type-level only: `check:types` renamed `check` (5 package.json); agent tsconfig `include` src and types; agent-vite and cli tsconfig `exclude` dist; provider-diagnostics.ts and telemetry/projection.ts type assertions.
- [x] (2026-10-17 17:58 KST) T005 Rename the packages and every brand surface in source
  Evidence: `git grep -niE "@flue/|\bflue\b|FLUE_" -- packages/{agent,agent-vite,cli,agent-sdk,agent-react}` → 44 lines: 38 README.md, 5 package.json `repository.url` (withastro/flue), 1 withastro/flue/issues/753 link; camelCase grep `[a-z0-9_@./:-]*flue[a-z0-9_./:-]*` outside READMEs → only flueframework.com (14 lines: 5 homepage, 9 code/scaffold) and withastro/flue; `node packages/cli/bin/amond.mjs --help` → `amond/2.3.0`, commands run, init, add, update, docs; `bun install --frozen-lockfile` → no changes; `bun run build` 10/10, `bun run check` 15/15, `bun run lint` 10/10, `CI=true bun run test` 20/20 (@amond-ai/agent-react 27 tests passed)
  Config: a temp project with only `flue.config.ts` → `resolveAmondConfigPath` returns undefined, `loadAmondConfig` → `{"config":{}}` (the file is ignored); explicit lookup → `[amond] Config file not found: amond.config.ts`. See Decision Log.
  Commit: 6bc581e. Root files beyond the packages: `eslint.config.ts` (virtual:amond/providers in a comment), `bun.lock` (new names). No false positives (influence, fluent, …) in the five packages.
- [x] (2026-10-17 18:20 KST) T007 Wire the packages into release-please at 0.1.0
  Evidence: `jq` over release-please-config.json and .release-please-manifest.json → nine packages listed, the five new ones at 0.1.0 matching each package.json; `bun scripts/publish.ts --dry-run` → would publish order: agent, agent-react, agent-sdk, agent-vite, amond, then the four existing packages; `bun run build && bun run lint` → 10/10 tasks successful. Release-please dry run not run: it reads config from the remote branch, so it needs the push first.

## Decision Log

- 2026-10-17: the spec's first draft named a Cloudflare integration suite that does not exist in
  2.3.0; the spec now drops scripts that point at missing files.

- Decision: pinned `react` to 19.2.8 in packages/agent-react (Flue declares ^19.1.1).
  Rationale: bun resolved ^19.1.1 to 19.3.1 while react-dom is pinned to 19.2.8, so both React tests failed with "Incompatible React versions"; Flue's pnpm lock had both at 19.2.8.
  Date/Author: 2026-10-17 / implement-executor
- Decision: packages/cli/scripts/generate-blueprint-index.ts got two lint-driven edits (block body on the ENOENT `if`, `import process from 'node:process'`).
  Rationale: the pre-commit hook lints staged files and T004 has not landed; both are behaviour-neutral.
  Date/Author: 2026-10-17 / implement-executor

- Decision: switched off the autofixes that change behaviour (error class, re-export or import evaluation order, expressions, regexes), not only the ones that cannot be fixed.
  Rationale: the reformat commit has to stay mechanical; the first autofix run moved `import 'virtual:flue/providers'`, turned 26 `Error` throws into `TypeError` and reordered re-exports.
  Date/Author: 2026-10-17 / implement-executor

- Decision: T005 adds no error for a project with only `flue.config.ts`; the old name is ignored, so the project runs on defaults with no config.
  Rationale: Flue's config is optional: `resolveFlueConfigPath` returns undefined when no file is found, and only an explicit `configFile` that is missing throws. A new error would change behaviour (spec Constraints). The T005 Validation clause and the Review Focus line expect an error naming `amond.config.ts`; the orchestrator decides whether to add one.
  Date/Author: 2026-10-17 / implement-executor
- Decision: T005 also ran the ESLint autofix for `perfectionist/sort-named-imports` and `sort-named-exports` (26 hits).
  Rationale: the renames changed the alphabetical order of names inside braces; reordering specifiers within one statement does not change evaluation order.
  Date/Author: 2026-10-17 / implement-executor

- Decision: anchored release-please with the top-level `bootstrap-sha` 7c8f94c (phase 1 checkpoint), not a per-package option.
  Rationale: `bootstrap-sha` and `last-release-sha` are top-level only in the schema and manifest docs; the existing four packages have never released either, and no commit before the checkpoint touches them in a way worth a changelog. Ignored once the first release PR merges, so it can be removed then.
  Date/Author: 2026-10-17 / implement-executor

## Surprises & Discoveries
- Observation: `git subtree add` keeps the split commits at root-level paths, so `git log -- packages/agent`
  shows only the merge commit, not Flue's commits.
  Evidence: after subtree add, `git log --oneline -- packages/agent | wc -l` → 1 for every package; after rewriting
  each split history under its prefix (filter-branch) and merging, the counts are 492/27/364/267/55.
- Observation: the lint rules switched off in T004 flag code worth a look in a later track: seven `regexp/no-super-linear-backtracking` hits (skill-frontmatter.ts:29, cli blueprint-index.ts:52, docs-pages.ts:48 and :108), `ts/no-this-alias` in session.ts, and `no-unmodified-loop-condition` in agent-coordinator.ts. None looked like a defect, so none was changed.
  Evidence: `bunx eslint` on the pre-autofix tree listed them with the rules on.
- Observation: After `bun run build`, `bun run lint` fails on the gitignored generated `packages/cli/src/generated/blueprints.ts` (7 style errors: member-delimiter, semi).
  Evidence: `bun run lint` → @flue/cli:lint 7 errors; with `src/generated` moved away → 10/10 tasks pass. Not caused by T003; needs an ESLint ignore for generated files (T004 follow-up).

- Decision: corrected T005's Validation and Review Focus to the config behaviour Flue has: no config file is optional, so a stray `flue.config.ts` is ignored, and only a missing explicit config file errors (naming `amond.config.ts`).
  Rationale: the plan's original clause assumed an error that would be a behaviour change, which the spec's Constraints rule out.
  Date/Author: 2026-10-17 / lead
- Decision: T004 ran before T003.
  Rationale: the pre-commit hook lints staged files, so T003's type-level edits needed the imported packages lint-clean first.
  Date/Author: 2026-10-17 / lead
