# Import Flue's packages and rename them to amond

> Track: flue-import-rename-20261017

## Overview

Phase 0 of [ADR-0004](../../../../../docs/adr/0004-ship-flue-as-amond-packages.md), tracked in
[#20](https://github.com/amond-ai/agent/issues/20). Flue's runtime, Vite plugin, CLI, SDK and
React packages move into this repository with their history. They are renamed to amond in source
and moved onto this repository's toolchain, so that phases 1–4 (#15–#18) can work on them here.

Users of the result install, import, configure and run amond names only. Behaviour stays Flue
2.3.0's: this phase renames and re-tools. It does not change what the code does, except where
Flue's behaviour points at Flue's own website or content, as described below. Pi stays in place
until #16–#18.

This track is the code half of #20. The content the CLI's `docs`, `add` and `update` commands
show (Flue's docs pages and blueprints) is imported by a second track.

## Scope

### Packages imported with history

Imported from withastro/flue v2.3.0 (`deee93b`, the revision `vendor/flue` pins). The import
records that upstream commit.

| Flue package | Published as | Directory |
| --- | --- | --- |
| `@flue/runtime` | `@amond-ai/agent` | `packages/agent` |
| `@flue/vite` | `@amond-ai/agent-vite` | `packages/agent-vite` |
| `@flue/cli` | `amond`, binary `amond` | `packages/cli` |
| `@flue/sdk` | `@amond-ai/agent-sdk` | `packages/agent-sdk` |
| `@flue/react` | `@amond-ai/agent-react` | `packages/agent-react` |

The current `packages/amond` is retired in this track rather than in #18. A workspace cannot hold
two packages named `amond`, and the new CLI takes the name. Nothing in the workspace depends on the
old CLI. `packages/core`, `durable` and `durable-cloudflare` stay until #18.

### Brand surfaces renamed in source

- `@flue/*` import specifiers, including those in code the Vite plugin generates.
- The `flue` command becomes `amond`.
- `flue.config.ts` becomes `amond.config.ts`, including the config file lookup.
- `FLUE_*` environment variables and constants become `AMOND_*`.
- `virtual:flue/*` module ids become `virtual:amond/*`.
- `Flue<Name>Agent` Durable Object classes become `Amond<Name>Agent`, and their generated
  bindings take the `AMOND_` prefix.
- Exported names and internal identifiers that carry Flue's name take amond's, for example
  `FlueError` becomes `AmondError`, `useFlueAgent` becomes `useAmondAgent`, and the `flue()` Vite
  plugin becomes `amond()`. Source files named after Flue are renamed the same way.
- Names the packages write or emit take amond's too: stored table names (`flue_*`), telemetry
  span and attribute names, and working directories such as `.flue/`. Nothing stored under the
  old names needs migrating, because no amond release has shipped.
- Flue's name in user-facing text becomes amond: CLI help and errors, the files `amond init`
  scaffolds, and the package READMEs.

The `'use agent'` directive is not a brand and stays.

### Links to Flue's website

Flue's packages point users at `flueframework.com`: package homepages, the package READMEs, and
comments in the files `init` scaffolds. None of those links remain.

- A link to a docs page becomes a reference to the same page through the CLI, in the form
  `amond docs read <page>`. The second track bundles those pages.
- A package homepage points at this repository.
- A link to Flue's site as a whole is dropped, or replaced by this repository where the text needs
  a link.

### CLI content left for the second track

The `docs` command and the blueprint commands (`add` and `update`) read content kept outside
Flue's packages: the docs site's pages and the repository's blueprints. Neither is imported in
this track.

- `amond docs` and its subcommands report that no docs are bundled with this version and exit
  with an error. They do not crash, and they do not show Flue's pages.
- `amond add` and `amond update` report that no blueprints are available and exit with an
  error. Flue fetches blueprints from a registry on Flue's website by default. That default is
  removed, so no request reaches Flue's website. The registry override is renamed to
  `AMOND_REGISTRY_URL` with the other variables. With no blueprint index bundled, it has nothing
  to look up until the second track lands.
- Building the CLI does not require the blueprints directory to exist.

### Toolchain

- Bun workspaces and the root catalog replace pnpm's workspace and catalog. pnpm's
  `minimumReleaseAge` gate, Biome and Prettier configuration are dropped.
- ESLint, with this repository's shared configuration, replaces Biome.
- tsdown and Vitest stay, aligned with this repository's shared Vitest configuration.
- The imported code type-checks under this repository's TypeScript, not Flue's TypeScript 7.
- Scripts that point at files absent from Flue 2.3.0 are dropped: the CLI's `test` directory and
  the Vite plugin's Cloudflare integration config.
- Every imported package is wired into the task runner and into release-please. Each starts at
  version 0.1.0.

### Attribution

- `NOTICE` carries Flue's copyright and license notice.
- Each imported package's README states that it is derived from Flue.

### Repository documentation

`README.md`, `ARCHITECTURE.md` and `docs/knowledge/tech-stack.md` describe the imported packages
and no longer describe the retired `packages/amond` as present.

## Success Criteria

- [ ] SC-1: The history of `packages/agent` shows Flue's commits for the imported files, and the
  import commit names upstream revision `deee93b`.
- [ ] SC-2: A case-insensitive search for `@flue/`, the word `flue`, `FLUE_` and
  `flueframework.com` over the imported packages returns only attribution lines.
- [ ] SC-3: The repository's build, type check, lint and test commands pass at the root. The
  imported packages' regular test suites run as part of them.
- [ ] SC-4: Building a minimal `'use agent'` example with `vite build` and `@amond-ai/agent-vite`
  produces a Cloudflare Worker with an `Amond<Name>Agent` Durable Object class, as `vite build` did
  under Flue.
- [ ] SC-5: `amond --help` lists the imported commands under the `amond` name.
- [ ] SC-6: `amond docs`, `amond add` and `amond update` each exit with an error that says no
  content is bundled, and none of them makes a request to Flue's website.
- [ ] SC-7: `amond init` scaffolds a project whose files name amond, not Flue, and link to no
  Flue website page.
- [ ] SC-8: release-please lists each imported package at 0.1.0, and the retired `packages/amond`
  entry is gone.
- [ ] SC-9: `NOTICE` carries Flue's copyright and license notice, and each imported package's
  README states that it is derived from Flue.
- [ ] SC-10: `README.md`, `ARCHITECTURE.md` and `docs/knowledge/tech-stack.md` describe the
  imported packages and do not describe `packages/amond` as present.

## Constraints

- No behaviour change beyond renames, toolchain moves, and the website and content changes in
  Scope. A test changes only to follow one of those, never to accommodate anything else.
- Renames happen in source. There is no publish-time rewrite (ADR-0004).
- Pi stays in this phase.
- Flue's name appears in code and published packages only in `NOTICE`, the package READMEs'
  attribution lines (product guidelines, principle 1), and links to upstream withastro/flue
  issues or commits that explain why a piece of code is the way it is. Those links count as
  attribution lines for SC-2.

## Out of Scope

- Importing, renaming and bundling Flue's docs pages and blueprints for `amond docs`, `amond add`
  and `amond update` (the second track).
- Removing Pi, the agent-loop seam, the sandbox extension and the harness integration (#15–#18).
- Flue's channel, persistence adapter and OpenTelemetry packages.
- Flue's docs website, marketing site, examples and demo apps.
- Hosting an amond blueprint registry.
- Retiring `packages/core`, `durable` and `durable-cloudflare` (#18).
- A new `amond build` command. Building stays `vite build` with the Vite plugin, as in Flue.
- Publishing to npm. Wiring into release-please makes the packages releasable. Whether a release
  ships before #18 is decided separately.

## Assumptions

- The pull request that carries the imported history merges with a merge commit. A squash merge
  would collapse Flue's commits into one and fail SC-1. The `main` ruleset currently allows squash
  merges only, so it has to allow a merge commit for that pull request.
- `packages/runtime` was renamed from an earlier `packages/sdk` on 2026-05-13. A split by path
  does not follow renames, so the imported history of `packages/agent` starts at that rename.
  That satisfies SC-1, which asks for Flue's commits, not for every commit.

- Correction to #20's done criteria: they say `amond build` produces a Worker. Flue 2.3.0's CLI
  has no build command (it has `init`, `run`, `docs`, `add` and `update`), so SC-4 checks the
  `vite build` path Flue actually uses. #20 should be updated to match.
- A docs page reference written in this track names the page by its path in Flue's docs tree
  (for example `guide/tools`). The second track keeps those paths when it bundles the pages, so
  the references resolve once it lands. A link to a page that is mostly about a package left in
  Flue (channels, persistence adapters, OpenTelemetry) is dropped rather than rewritten, because
  the second track does not bundle those pages.
