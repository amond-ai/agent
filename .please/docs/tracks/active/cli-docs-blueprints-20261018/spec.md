---
product_spec_domain: cli/content
---

# Bundle the CLI's documentation pages and blueprints

> Track: cli-docs-blueprints-20261018

## Overview

`amond docs`, `amond add` and `amond update` are in the `amond` CLI today, but they only report that no content is bundled. This is the second half of #20. It brings in Flue's documentation pages and blueprints for the packages this repository imported, under the amond name, so these commands work.

`amond docs` lets a developer or a coding agent read and search the documentation from the terminal. `amond add` and `amond update` hand a coding agent a step-by-step guide (a blueprint) for adding a sandbox provider, a tooling integration, or a channel or database adapter built from scratch.

The content is a snapshot of Flue v2.3.0, the same upstream commit as the code import. Content for packages this repository did not import (Flue's channel packages, persistence adapters and OpenTelemetry) stays out. Documentation pages ship with the CLI. Blueprint text is served from a registry site on an amond-owned domain, so the text of a blueprint can change without a CLI release. The list of blueprints is still built into each CLI release, so adding a new blueprint needs one.

## Requirements

### Functional Requirements

- [ ] FR-1: let users list, read and search the documentation pages through `amond docs`, `amond docs read <page>` and `amond docs search <query>`
- [ ] FR-2: include Flue's guide, reference, CLI and SDK pages, and its sandbox, deploy and tooling ecosystem pages, except the pages FR-5 leaves out
- [ ] FR-3: include Flue's sandbox and tooling blueprints and the build-from-scratch guides for the sandbox, tooling, channel and database kinds, and list them when `amond add` runs with no arguments
- [ ] FR-4: deliver blueprint text to `amond add` and `amond update` from a hosted registry site on an amond-owned domain, which the CLI uses by default, with `AMOND_REGISTRY_URL` overriding that default
- [ ] FR-10: publish the included blueprints to that registry site, so that every blueprint the CLI lists can be fetched
- [ ] FR-5: leave out the blueprints and pages that depend on packages this repository did not import, and edit the remaining pages that mention those packages so they no longer direct users to them
- [ ] FR-6: present every page and blueprint under amond names: packages, the `amond` command, `amond.config.ts`, `AMOND_*` environment variables and `Amond<Name>Agent` classes
- [ ] FR-7: credit Flue as the source of the content, following the attribution convention set in #27
- [ ] FR-8: record the upstream Flue commit the content was taken from (v2.3.0, `deee93b`)
- [ ] FR-9: make every `amond docs read <page>` pointer in the files `amond init` scaffolds resolve to an included page

### Non-functional Requirements

- [ ] NFR-1: serve documentation pages without a network connection
- [ ] NFR-2: fail a registry request within a bounded time with a message that names the registry, instead of hanging
- [ ] NFR-3: fetch blueprint text by default only over HTTPS from a location the amond project controls, because coding agents act on that text; an `AMOND_REGISTRY_URL` override is the user's own explicit choice

## Acceptance Criteria

- [ ] AC-001 (FR-1): When a user runs `amond docs read guide/tools`, the system shall print that page's content and exit successfully.
- [ ] AC-002 (FR-1): When a user runs `amond docs search sandbox`, the system shall list the pages that match.
- [ ] AC-003 (FR-1, NFR-1): While the machine has no network connection, the system shall still list, read and search documentation pages.
- [ ] AC-004 (FR-3): When a user runs `amond add` with no arguments, the system shall list the sandbox and tooling blueprints and the build-from-scratch kinds (sandbox, tooling, channel and database).
- [ ] AC-005 (FR-4): When a coding agent runs `amond add sandbox daytona` and the registry is reachable, the system shall write that blueprint's Markdown to standard output.
- [ ] AC-006 (FR-3, FR-4): When a user runs `amond add channel <url>`, the system shall return the channel build-from-scratch guide with that URL filled in.
- [ ] AC-007 (FR-4): Where `AMOND_REGISTRY_URL` is set, the system shall fetch blueprint text from that location instead of the default.
- [ ] AC-008 (FR-4, NFR-2): If the registry cannot be reached, then the system shall exit with an error that names the registry location.
- [ ] AC-009 (FR-5): If a user asks for a left-out blueprint such as `amond add channel slack`, then the system shall report that it is unknown and list the available blueprints of that kind.
- [ ] AC-010 (FR-6): The system shall not show a page or blueprint that names a `@flue/` package, the `flue` command, `flue.config.ts` or a `FLUE_` variable, except in attribution lines.
- [ ] AC-011 (FR-9): When a user runs `amond docs read` with each page that `amond init`'s scaffolded files point to, the system shall print that page.

## Out of Scope

- A documentation website. Flue's docs site is not imported; publishing the pages on the web is a separate decision. The registry site serves blueprint text only.
- Content for packages this repository did not import: Flue's channel packages, persistence adapters (Postgres, Redis, libSQL, MySQL, MongoDB, Supabase, Turso, Valkey) and OpenTelemetry. That is 26 blueprints, including Sentry, and the channel and database ecosystem pages.
- Rewriting the left-out blueprints as build-it-yourself guides.
- A repeatable sync with upstream Flue. Later upstream changes are pulled by hand in a future track.
- Changes to the CLI's commands beyond what serving the content needs.

## Assumptions

- The snapshot is taken from `vendor/flue` at `deee93b` (v2.3.0), the commit the five packages were imported from (`docs/knowledge/tech-stack.md`).
- By the content split as of `deee93b`, 16 of the 42 blueprint files stay: 11 sandbox (10 providers plus the kind root), 3 tooling (Braintrust, vitest-evals and the kind root), and the channel and database kind roots. The Sentry blueprint needs OpenTelemetry and stays out. Four non-ecosystem pages mention unimported packages and need edits: `guide/channels`, `guide/database`, `guide/observability` and `reference/events`. `guide/migration`, Flue's guide for upgrading a 1.0 beta app to 2.0, describes releases amond never had and stays out. Two of them, `guide/database` and `guide/observability`, are scaffold pointers (FR-9). In the ecosystem section, `tooling/opentelemetry` and `tooling/sentry` need OpenTelemetry and stay out, and six deploy pages (`aws`, `docker`, `fly`, `railway`, `render`, `sst`) mention persistence adapters and need edits. These lists are the plan-time estimate: FR-5 is the authority, so the review sweeps every page against it, and the track's `known-issues.md`, added with the blueprints in #35, lists the references left.
- Documentation pages ship inside the published CLI package, as Flue's CLI did, while blueprint text comes from the registry (FR-4).
- The plan picks the registry hostname on an amond-owned domain and how the site is deployed; the user confirms both at plan approval.
- Renaming follows the rules the #20 code import used. Content keeps its meaning; only names, links to Flue's website and references to left-out packages change.
- The content carries Flue's Apache-2.0 license, under the attribution convention set in #27.
