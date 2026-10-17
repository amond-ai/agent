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

- [ ] T001 Import the five packages with history and retire packages/amond (file: packages/agent/package.json)
  Validation: `git log -- packages/agent` lists Flue commits, and each subtree merge message names `deee93b`. Each imported tree matches `vendor/flue/packages/<name>`. `packages/amond` and its release-please and manifest entries are gone.
  Method: `git log --oneline -- packages/agent | head`; `diff -r` against `vendor/flue/packages/<name>`
  STOP: a package's split tree differs from `vendor/flue/packages/<name>`.
- [ ] T002 Build and test the packages with Bun workspaces (depends on T001, file: packages/cli/package.json)
  Validation: `bun install --frozen-lockfile`, `bun run build` and `bun run test` pass at the root with pnpm, Biome and Prettier files gone. The CLI builds with no `blueprints/` directory and no `tsx`. The two React tests run in the root test command.
  Method: `bun install --frozen-lockfile && bun run build && bun run test`
- [ ] T003 Type-check the packages under the repository's TypeScript (depends on T002, file: packages/agent/tsconfig.json)
  Validation: `bun run check` passes at the root, with only tsconfig and type-level edits, each listed in the commit body.
  Method: `bun run check`
- [ ] T004 Lint the packages with the repository's ESLint config (depends on T002, file: eslint.config.ts)
  Validation: `bun run lint` passes. The autofix is one commit containing nothing else. Each rule switched off for the imported packages carries its reason in `eslint.config.ts`.
  Method: `bun run lint`; `git show --stat` on the reformat commit

### Phase 2: Rename to amond

- [ ] T005 Rename the packages and every brand surface in source (depends on T003, T004, file: packages/agent-vite/src/amond-plugin.ts)
  Validation: names, bin and directories match the spec's table, and `amond --help` lists `init`, `run`, `docs`, `add` and `update`. The SC-2 search returns only attribution lines and `flueframework.com` links (Phase 3's). A project with only `flue.config.ts` gets an error naming `amond.config.ts`. Build, check, lint and test pass.
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
- A project with only `flue.config.ts` → not found, and the error names `amond.config.ts` (T005)

## Progress

- [x] (2026-10-17 16:13 KST) T001 Import the five packages with history and retire packages/amond
  Evidence: `git log --oneline -- packages/agent | wc -l` → 492 (oldest 96e13f8 "refactor: rename @flue/sdk to @flue/runtime ... (#121)", tip 90e9586 v2.3.0); `diff -r packages/<dir> vendor/flue/packages/<name>` → empty for all five; commits agent 492, agent-vite 27, cli 364, agent-sdk 267, agent-react 55

## Decision Log

- 2026-10-17: the spec's first draft named a Cloudflare integration suite that does not exist in
  2.3.0; the spec now drops scripts that point at missing files.

## Surprises & Discoveries
- Observation: `git subtree add` keeps the split commits at root-level paths, so `git log -- packages/agent`
  shows only the merge commit, not Flue's commits.
  Evidence: after subtree add, `git log --oneline -- packages/agent | wc -l` → 1 for every package; after rewriting
  each split history under its prefix (filter-branch) and merging, the counts are 492/27/364/267/55.
