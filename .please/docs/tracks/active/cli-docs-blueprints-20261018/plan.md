# Plan: Bundle the CLI's documentation pages and blueprints

> Track: cli-docs-blueprints-20261018
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: cli-docs-blueprints-20261018
- **Issue**: #20
- **Created**: 2026-10-18
- **Approach**: Commit the renamed docs snapshot in `packages/cli/docs` (already in the package's `files`). Put the renamed blueprints in repo-root `blueprints/` (the index generator's input). Serve blueprint text from a static Cloudflare site on `blueprints.amond.ai`, the CLI's new default registry.
- **Plan Depth**: standard
- **Planned At**: b409fa6

## Context

### Problem

The code behind `amond docs`, `add` and `update` came over from Flue v2.3.0, but no content did. #27 also removed the default registry.

- **Docs:** `resolveDocsRoot()` (`packages/cli/src/lib/docs-pages.ts`) tries `<repo>/apps/docs/src/content/docs`, then `<package root>/docs`. The `docs` directory is in the package's `files`, but nothing fills it.
- **Blueprints:** `scripts/generate-blueprint-index.ts` reads repo-root `blueprints/`. The CLI bundles only that index and fetches each body from `<registry>/<slug>.md`. Flue's registry stripped the JSON frontmatter and served `<kind>--<name>.md` as `<name>.md` and `<kind>.md` as `<kind>.md`.
- **Content quirks:** two source pages are `.mdx` with a `CopyPrompt` component. Page links use `/docs/<path>/`, which `normalizeDocsPath` resolves. `// flue-blueprint:` markers and `FLUE_AGENT_URL` are blueprint text only.
- **Tests:** `no-content.test.ts` asserts today's "nothing bundled" behavior.

### Constraints

- The content set and the rename rules come from the spec, using #20's rules.
- The rename is done by hand. The spec rules out a sync script.

### Non-Goals

- The spec's Out of Scope applies as written.
- Considered and not built:
  - **Per-CLI-version registry paths.** Each blueprint carries its own `version` and Upgrade Guide, and a 404 already tells the user to update amond. Revisit if a blueprint needs a change older CLIs can't follow.
  - **Worker code for the registry.** Static assets already serve files and return 404.

### STOP Conditions

- `amond.ai` is not a zone in the deploying Cloudflare account. Only T006's first deploy can show this; stop there, before changing the hostname anywhere else.

## Architecture Decision

- **Docs live in `packages/cli/docs/`, committed.** The package already publishes that directory, so the pages work the same in the repo and after install, with no network and no copy step. `resolveDocsRoot()` drops the `apps/docs` candidate (TD-005). Rejected: Flue's release-time copy from a site directory. Its script is gone, and a second copy can go stale.
- **Blueprints live in repo-root `blueprints/`.** One directory feeds both the bundled index and the registry site, so the list and the text come from the same commit.
- **The registry is `apps/registry`, an assets-only Cloudflare Worker.** Its build writes each blueprint body to `dist/<slug>.md`. That matches the URLs `registryUrlFor` already builds, so `https://blueprints.amond.ai` becomes the default, and `AMOND_REGISTRY_URL` still overrides it.
  - The hostname was chosen at approval: its own subdomain on `amond.ai`, so a future `amond.ai` website keeps the apex.
  - Rejected: raw GitHub files (you chose an amond domain); a Worker with code (no per-request logic); an Astro site like Flue's (a site toolchain just to serve flat files).
- **A deploy workflow on `main`** publishes merged blueprint text without a CLI release (FR-4, FR-10).
- **A content test guards both snapshots.** It checks for brand names outside attribution lines, leftover MDX syntax, and `/docs/<path>/` links that don't resolve. This keeps AC-010 true as the snapshot is edited later.

## Tasks

### Phase 1: Docs in `amond docs`

- [x] T001 Import the renamed docs snapshot into packages/cli/docs (file: packages/cli/docs/guide/tools.md) [FR-2, FR-5, FR-6, FR-7, FR-8, AC-010]
  Validation: `packages/cli/docs` holds the spec's page set from `deee93b` as plain Markdown, with the pages that mention left-out packages edited; the new content test passes (brand search clean except attribution, no MDX syntax, every `/docs/<path>/` link resolves); `packages/cli/NOTICE` and `tech-stack.md` credit Flue and record `deee93b`.
  Method: `bun --filter amond test -- docs-content`
- [x] T002 Serve the bundled pages through amond docs (file: packages/cli/src/lib/docs-pages.ts) (depends on T001) [FR-1, FR-9, NFR-1, AC-001, AC-002, AC-003, AC-011]
  Validation: `amond docs read guide/tools` prints the page and exits 0; `amond docs search sandbox` lists matching pages; every `amond docs read <page>` pointer in `init.ts`'s scaffolds resolves; link-style paths taken from page text resolve too; `bun pm pack` includes `docs/`; `resolveDocsRoot()` no longer looks at `apps/docs`, and the CLI README drops the "exits with an error" note for `docs`.
  Method: `bun --filter amond test` plus `bun pm pack --dry-run` in `packages/cli`

### Phase 2: Blueprints from the registry site

- [x] T003 Import the renamed blueprint snapshot into blueprints/ (file: blueprints/README.md) (depends on T001) [FR-3, FR-5, FR-6, FR-7, FR-8, AC-010]
  Validation: `blueprints/` holds the spec's 16 files and a README that credits Flue and records `deee93b`; markers read `// amond-blueprint:`; the generator indexes 12 blueprints and 4 kind roots with no validation error; the content test covers `blueprints/` and passes.
  Method: `bun --filter amond check` plus `bun --filter amond test -- docs-content`
- [ ] T004 Build and serve blueprint text from the registry site (file: apps/registry/wrangler.jsonc) (depends on T003) [FR-10]
  Validation: the build writes exactly one frontmatter-free `<slug>.md` per indexed blueprint and kind root, and none for an alias; served locally, a slug returns Markdown and an unknown name returns 404; `apps/*` is a turbo-built workspace; `ARCHITECTURE.md` and `tech-stack.md` describe the site.
  Method: `bun --filter @amond-ai/registry test` plus `bunx wrangler deploy --dry-run` in `apps/registry`
- [ ] T005 Default amond add and update to the registry site (file: packages/cli/src/commands/blueprints.ts) (depends on T003) [FR-4, NFR-2, NFR-3, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009]
  Validation: against a local HTTP registry, `amond add` lists the bundled blueprints and kinds, `amond add sandbox daytona --print` prints that blueprint, and `amond add channel <url>` fills in the URL; `AMOND_REGISTRY_URL` overrides the default even with a trailing slash or a plain `http://127.0.0.1` URL; an unreachable registry fails with its URL in the message; `amond add channel slack` reports an unknown blueprint; the built-in default is `https://blueprints.amond.ai`; the CLI README and tech-debt tracker (TD-004, TD-005) are updated.
  Method: `bun --filter amond test`
- [ ] T006 Deploy the registry site from main (file: .github/workflows/deploy-registry.yml) (depends on T004) [FR-10]
  Validation: the workflow runs `wrangler deploy` for `apps/registry` on a push to `main` that touches `blueprints/**` or `apps/registry/**`, and on manual dispatch, never on a pull request; it runs with `permissions: contents: read`, its actions are pinned, and zizmor passes; after the first deploy, `curl -fsS https://blueprints.amond.ai/daytona.md` returns that blueprint's body.
  Method: zizmor in CI, then the `curl` check after merge
  STOP: the repository has no `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secret, or the first deploy rejects the `blueprints.amond.ai` custom domain because `amond.ai` is not a zone in that account

## Key Files

Each task's `(file: ...)` names its primary file. Also touched: `packages/cli/src/commands/no-content.test.ts` (replaced by the T002 and T005 cases), `packages/cli/src/lib/docs-content.test.ts` (new, T001 and T003), and root `package.json` and `turbo.json` (the `apps/*` workspace, T004).

## Verification

- [ ] AC-001, AC-002, AC-003 and AC-011 pass in T002's tests, which use no network.
- [ ] AC-004 through AC-009, NFR-2 and NFR-3 pass in T005's tests against a local and an unreachable registry.
- [ ] AC-010 holds by the content test over `packages/cli/docs` and `blueprints/`.
- [ ] FR-10 holds by T004's build-output test, and by T006's `curl` check after the first deploy.
- [ ] `bun run build && bun run check && bun run lint && bun run test` pass at the root.

## Review Focus

- T002: link-style page paths taken from page text (`/docs/guide/tools/`, or a full URL ending in it) resolve in `amond docs read`.
- T005: an `AMOND_REGISTRY_URL` with a trailing slash, or a plain `http://127.0.0.1` URL, still works; only the default is held to HTTPS.
- T004: a blueprint with `aliases` is served under its slug only, because the CLI resolves aliases before fetching.

## Progress

- [x] (2026-10-19 12:00 KST) T005 Default amond add and update to the registry site
  Evidence: `CI=true bun --filter amond test` → 4 files, 55 tests passed (22 new in blueprints.test.ts, local node:http registry + unreachable + blackhole + default-URL unit tests); `bunx tsc --noEmit -p packages/cli` clean; `bun run lint` 10/10 tasks successful
- [x] (2026-10-19 11:00 KST) T003 Import the renamed blueprint snapshot into blueprints/
  Evidence: `bun packages/cli/scripts/generate-blueprint-index.ts` → "(12 blueprints, 4 kind roots)"; `bun --filter amond test -- docs-content` → 14 tests passed; `bunx tsc --noEmit -p packages/cli` clean (`bun check` half skipped: pre-existing E2BIG recursion)
- [x] (2026-10-19 10:30 KST) T002 Serve the bundled pages through amond docs
  Evidence: `bun --filter amond test` → 4 files, 39 tests passed; `bun pm pack --dry-run` in packages/cli → 75 files, 68 under docs/
- [x] (2026-10-19 10:00 KST) T001 Import the renamed docs snapshot into packages/cli/docs
  Evidence: `bun --filter amond test -- docs-content` → 8 tests passed; page count 68, no `.mdx`; brand grep over packages/cli/docs → no matches

## Decision Log

- Decision: designed inline from one exploration pass instead of spawning an architect agent.
  Rationale: the exploration settled each open choice against the existing code and Flue's precedent, leaving one clear approach.
  Date/Author: 2026-10-18 / plan
- Decision: serve the registry at `blueprints.amond.ai`.
  Rationale: chosen at approval over the apex `amond.ai` and an `amond.ai/blueprints` route; a subdomain keeps the apex free for a website and works as a Worker custom domain.
  Date/Author: 2026-10-18 / approval
- Decision: code samples inside `packages/cli/docs/**/*.md` are ignored by ESLint (`packages/cli/docs/**/*.md/**` in `eslint.config.ts`); prose stays linted.
  Rationale: the samples are elided fragments in Flue's own style (semicolons, `...` bodies, mixed languages); dozens fail to parse and autofix would rewrite the teaching code.
  Date/Author: 2026-10-19 / luna-implementer
- Decision: the Braintrust page's abridged snippet no longer imports a named observer from `braintrust`.
  Rationale: the upstream name embeds the Flue brand and an amond-named export cannot be verified here; the snippet forwards events through a placeholder and says the blueprint writes the real import.
  Date/Author: 2026-10-19 / luna-implementer
- Decision: the Braintrust blueprint and docs page keep the import name `braintrustFlueObserver`; the brand check exempts exactly that identifier.
  Rationale: it is the real export of the pinned `braintrust@3.17.0` SDK (the vendored example uses it), so renaming it would tell an agent to import a name that does not exist. This supersedes the placeholder the docs page used in T001.
  Date/Author: 2026-10-19 / luna-implementer
- Decision: code samples in `blueprints/**/*.md` are ignored by ESLint, as for the docs pages.
  Rationale: the samples are templates for a coding agent, not compiled project code.
  Date/Author: 2026-10-19 / luna-implementer

- Decision: `amond add channel slack` needed no special handling. `slack` is not an absolute URL, so it is looked up among channel blueprints; none are bundled, so it reports "not found" and lists `(none)` plus the `amond add channel <url>` hint.
  Rationale: this already matches AC-009 and keeps one rule (absolute URL means kind root, anything else is a name).
  Date/Author: 2026-10-19 / implement-executor
- Decision: kept the `NO_BLUEPRINTS_MESSAGE` guard and exported `registryUrlFor`/`DEFAULT_REGISTRY_URL` for a network-free default-URL test.
  Rationale: the guard still protects an install whose generated index is empty; the export is the smallest way to assert the default.
  Date/Author: 2026-10-19 / implement-executor

## Surprises & Discoveries
