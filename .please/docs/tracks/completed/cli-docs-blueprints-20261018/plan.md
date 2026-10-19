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
- [x] T004 Build and serve blueprint text from the registry site (file: apps/registry/wrangler.jsonc) (depends on T003) [FR-10]
  Validation: the build writes exactly one frontmatter-free `<slug>.md` per indexed blueprint and kind root, and none for an alias; served locally, a slug returns Markdown and an unknown name returns 404; `apps/*` is a turbo-built workspace; `ARCHITECTURE.md` and `tech-stack.md` describe the site.
  Method: `bun --filter @amond-ai/registry test` plus `bunx wrangler deploy --dry-run` in `apps/registry`
- [x] T005 Default amond add and update to the registry site (file: packages/cli/src/commands/blueprints.ts) (depends on T003) [FR-4, NFR-2, NFR-3, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009]
  Validation: against a local HTTP registry, `amond add` lists the bundled blueprints and kinds, `amond add sandbox daytona --print` prints that blueprint, and `amond add channel <url>` fills in the URL; `AMOND_REGISTRY_URL` overrides the default even with a trailing slash or a plain `http://127.0.0.1` URL; an unreachable registry fails with its URL in the message; `amond add channel slack` reports an unknown blueprint; the built-in default is `https://blueprints.amond.ai`; the CLI README and tech-debt tracker (TD-004, TD-005) are updated.
  Method: `bun --filter amond test`
- [x] T006 Deploy the registry site from main (file: .github/workflows/deploy-registry.yml) (depends on T004) [FR-10]
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

- [x] (2026-10-19 15:37 KST) Review-stage commits (SHA: `492d8d29`, `c17aaef8`, `1b2b70e2`, `bbf3ed3a`, `6c443da5`, `e31ac31b`, `eb28c769`, `6b187fe3`, `92027822`, `939fa206`, `d5112b82`, `d0aafc82`, `ccab9d3e`)
  Note: the phase 2 SHAs are the ones after `gh stack rebase --no-trunk` onto phase 1's `d0aafc82`; they were recorded before the rebase as `647b11e9`, `c279558f`, `6d3afd9e`, `4b7c9b2c`, `6b9ca0d4`, `0555e68f` and `dad85206`
- [x] (2026-10-19 13:00 KST) T006 Deploy the registry site from main
  Evidence: `uvx zizmor .github/workflows/` (v1.31.1) → "No findings to report"; `node ../../node_modules/wrangler/bin/wrangler.js deploy --dry-run` in apps/registry → read 16 files from dist, "--dry-run: exiting now"; `bunx eslint .github/workflows/deploy-registry.yml` clean
  Deferred: first deploy and `curl -fsS https://blueprints.amond.ai/daytona.md` — waiting on the user adding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (as `registry` environment secrets) and on the `amond.ai` zone check
- [x] (2026-10-19 10:20 KST) T004 Build and serve blueprint text from the registry site
  Evidence: `bun --bun vitest run` in apps/registry → 9 tests passed (exact 16-file set, no alias file, byte-identical frontmatter-free bodies, collision/invalid-frontmatter failures, real `wrangler dev`: daytona.md 200 text/markdown, unknown/alias/bare paths 404); `bunx wrangler deploy --dry-run` in apps/registry → "Read 16 files from the assets directory ... No bindings found. --dry-run: exiting now." exit 0; manual `wrangler dev` + curl → /daytona.md 200 `Content-Type: text/markdown; charset=utf-8`, /slack.md 404 Content-Length 0

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

- Decision: T006 commits the deploy workflow without the first deploy; its `curl` check is deferred.
  Rationale: the repository has no `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secret (T006's STOP). The user chose to add both secrets before merge, so the first deploy, and the `amond.ai` zone check with it, runs after that.
  Date/Author: 2026-10-19 / user at implement

- Decision: Extract the generator's filename/kind/collision checks into an exported buildBlueprintIndex (plus stripBlueprintFrontmatter) in packages/cli/src/lib/blueprint-index.ts, imported by apps/registry through a relative path; committed separately as a structural refactor.
  Rationale: The site's slugs must match the CLI's exactly and fail on the same invalid inputs; one shared function rules out drift. The generated CLI index was diffed byte-identical before/after.
  Date/Author: 2026-10-19 / implement-executor
- Decision: The local-serve test spawns the real `wrangler dev` (with --assets pointed at a temp build) instead of a mimic static server.
  Rationale: Starts in about 1s and proves the 200/404 behaviour of Workers assets with this wrangler.jsonc rather than of a stand-in.
  Date/Author: 2026-10-19 / implement-executor
- Decision: Add apps/registry/turbo.json extending root with inputs on $TURBO_ROOT$/blueprints/** and blueprint-index.ts for build and test.
  Rationale: Turbo's default inputs are package-local, so a blueprint edit would otherwise replay a stale cached dist/.
  Date/Author: 2026-10-19 / implement-executor

- Decision: the deploy job uses a GitHub `environment: registry`, and wrangler runs as `node ../../node_modules/wrangler/bin/wrangler.js deploy`.
  Rationale: the environment lets the user scope the Cloudflare secrets to this job; running the bin with node avoids wrangler hanging under bun's runtime, and uses the workspace-pinned version with no third-party action.
  Date/Author: 2026-10-19 / implement-executor

## Surprises & Discoveries

- Observation: wrangler dev (and unstable_startWorker) starts under Bun but never answers a request; under `bun --bun vitest`, `node` on PATH is a Bun shim, so the test must locate a real Node binary.
  Evidence: `bun probe.ts` calling unstable_startWorker timed out (exit 124) while the same file under node returned 200 in 267ms; ps showed the test-spawned `node .../wrangler.js` running `bun --no-warnings` as its child

- Observation: Root `CI=true bun run test` fails in amond:test on src/commands/no-content.test.ts (12 tests) because T003 bundled 12 blueprints and those tests still assert "No blueprints are bundled"; T005 replaces them per the plan's Key Files. Not caused by T004: the generated index is byte-identical (resolved: T005 replaced those tests).
  Evidence: AssertionError: expected 'Blueprint "slack" not found for kind …' to contain 'No blueprints are bundled with this v…'; every other turbo task (21/22) passed

## Outcomes & Retrospective

### What Was Shipped

- **Phase 1 (#33).** Flue `deee93b`'s docs pages, renamed to amond and converted to plain Markdown, are committed in `packages/cli/docs` (67 pages). `amond docs` lists, reads and searches them with no network, and every `amond docs read` pointer in `amond init`'s scaffolds resolves. Pages for packages amond does not ship are left out or edited, and `guide/migration.md` was dropped in review.
- **Phase 2 (#35).** Twelve renamed blueprints and four kind roots are in `blueprints/`. `apps/registry` builds them into an assets-only Cloudflare Worker for `https://blueprints.amond.ai`, the CLI's new default registry, which `AMOND_REGISTRY_URL` still overrides. `.github/workflows/deploy-registry.yml` deploys it from `main`.
- `docs-content.test.ts` guards both snapshots against the upstream brand, MDX syntax and links that don't resolve. TD-004 and TD-005 are resolved.

### What Went Well

- One shared `buildBlueprintIndex` serves both the CLI index and the registry build, so their slugs cannot drift apart.
- The registry test runs the real `wrangler dev` rather than a stand-in server, so the 200 and 404 behavior is proven against this `wrangler.jsonc`.
- The review loop found real rename slips that the brand test cannot see: an `amond<Name>Workflow` name, a lowercase `Amond` type, 17 "a `AmondX`" articles, two broken anchors, the wrong instrumentation contract, and guidance pointing at packages amond doesn't ship.

### What Could Improve

- Both phases ran to `max_iterations` before exiting `needs_human_read`. A pass over the imported pages for references to packages amond doesn't ship, before review, would have caught most of those findings in one place.
- Both phases append to `.please/docs/review/rejected-findings.jsonl`, so every stack rebase conflicts there. Resolution is mechanical (keep both sides), but it recurs on each rebase.
- Root `bun run check` exits 0 while each package's `bun check` fails with `E2BIG` (since #31), so the check gate is not verified on this track.
- The `greptile` engine is enabled but its CLI is not installed, so no review here had it.

### Tech Debt Created

- The open review findings for both phases are in `known-issues.md`. None is a new tracker entry: each is a contained fix or a follow-up issue.
- FR-10's live check is pending: the first deploy and `curl -fsS https://blueprints.amond.ai/daytona.md` need the Cloudflare secrets in the `registry` environment.
