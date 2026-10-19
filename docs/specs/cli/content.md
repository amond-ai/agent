---
id: SPEC-001
level: V_M
domain: cli
feature: content
depends: []
conflicts: []
traces: []
created_at: 2026-10-19T06:38:18.625Z
updated_at: 2026-10-19T06:38:18.625Z
source_tracks: ["cli-docs-blueprints-20261018"]
---

# Content Specification

## Purpose

Content Specification 관련 요구사항.

## Requirements

### Requirement: let users list, read and search the documentation pages through `amond docs`, `amond docs read <page>` and `amond docs search <query>`
<!-- req: REQ-001 tracks=cli-docs-blueprints-20261018 -->

The system MUST let users list, read and search the documentation pages through `amond docs`, `amond docs read <page>` and `amond docs search <query>`.

#### Scenario: When a user runs `amond docs read guide/tools`, the system shall print that page's content and exit successfully.

- WHEN a user runs `amond docs read guide/tools`
- THEN print that page's content and exit successfully

#### Scenario: When a user runs `amond docs search sandbox`, the system shall list the pages that match.

- WHEN a user runs `amond docs search sandbox`
- THEN list the pages that match

### Requirement: include Flue's guide, reference, CLI and SDK pages, and its sandbox, deploy and tooling ecosystem pages, except the pages FR-5 leaves out
<!-- req: REQ-002 tracks=cli-docs-blueprints-20261018 -->

The system MUST include Flue's guide, reference, CLI and SDK pages, and its sandbox, deploy and tooling ecosystem pages, except the pages FR-5 leaves out.

### Requirement: include Flue's sandbox and tooling blueprints and the build-from-scratch guides for the sandbox, tooling, channel and database kinds, and list them when `amond add` runs with no arguments
<!-- req: REQ-003 tracks=cli-docs-blueprints-20261018 -->

The system MUST include Flue's sandbox and tooling blueprints and the build-from-scratch guides for the sandbox, tooling, channel and database kinds, and list them when `amond add` runs with no arguments.

#### Scenario: When a user runs `amond add` with no arguments, the system shall list the sandbox and tooling blueprints and the build-from-scratch kinds (sandbox, tooling, channel and database).

- WHEN a user runs `amond add` with no arguments
- THEN list the sandbox and tooling blueprints and the build-from-scratch kinds (sandbox, tooling, channel and database)

#### Scenario: When a user runs `amond add channel <url>`, the system shall return the channel build-from-scratch guide with that URL filled in.

- WHEN a user runs `amond add channel <url>`
- THEN return the channel build-from-scratch guide with that URL filled in

### Requirement: deliver blueprint text to `amond add` and `amond update` from a hosted registry site on an amond-owned domain, which the CLI uses by default, with `AMOND_REGISTRY_URL` overriding that default
<!-- req: REQ-004 tracks=cli-docs-blueprints-20261018 -->

The system MUST deliver blueprint text to `amond add` and `amond update` from a hosted registry site on an amond-owned domain, which the CLI uses by default, with `AMOND_REGISTRY_URL` overriding that default.

#### Scenario: When a coding agent runs `amond add sandbox daytona` and the registry is reachable, the system shall write that blueprint's Markdown to standard output.

- WHEN a coding agent runs `amond add sandbox daytona` and the registry is reachable
- THEN write that blueprint's Markdown to standard output

#### Scenario: When a user runs `amond add channel <url>`, the system shall return the channel build-from-scratch guide with that URL filled in.

- WHEN a user runs `amond add channel <url>`
- THEN return the channel build-from-scratch guide with that URL filled in

#### Scenario: Where `AMOND_REGISTRY_URL` is set, the system shall fetch blueprint text from that location instead of the default.

- GIVEN `AMOND_REGISTRY_URL` is set
- THEN fetch blueprint text from that location instead of the default

### Requirement: publish the included blueprints to that registry site, so that every blueprint the CLI lists can be fetched
<!-- req: REQ-005 tracks=cli-docs-blueprints-20261018 -->

The system MUST publish the included blueprints to that registry site, so that every blueprint the CLI lists can be fetched.

### Requirement: leave out the blueprints and pages that depend on packages this repository did not import, and edit the remaining pages that mention those packages so they no longer direct users to them
<!-- req: REQ-006 tracks=cli-docs-blueprints-20261018 -->

The system MUST leave out the blueprints and pages that depend on packages this repository did not import, and edit the remaining pages that mention those packages so they no longer direct users to them.

#### Scenario: If a user asks for a left-out blueprint such as `amond add channel slack`, then the system shall report that it is unknown and list the available blueprints of that kind.

- WHEN a user asks for a left-out blueprint such as `amond add channel slack`
- THEN report that it is unknown and list the available blueprints of that kind

### Requirement: present every page and blueprint under amond names: packages, the `amond` command, `amond.config.ts`, `AMOND_*` environment variables and `Amond<Name>Agent` classes
<!-- req: REQ-007 tracks=cli-docs-blueprints-20261018 -->

The system MUST present every page and blueprint under amond names: packages, the `amond` command, `amond.config.ts`, `AMOND_*` environment variables and `Amond<Name>Agent` classes.

#### Scenario: The system shall not show a page or blueprint that names a `@flue/` package, the `flue` command, `flue.config.ts` or a `FLUE_` variable, except in attribution lines.

- THEN the system shall not show a page or blueprint that names a `@flue/` package, the `flue` command, `flue.config.ts` or a `FLUE_` variable, except in attribution lines

### Requirement: credit Flue as the source of the content, following the attribution convention set in #27
<!-- req: REQ-008 tracks=cli-docs-blueprints-20261018 -->

The system MUST credit Flue as the source of the content, following the attribution convention set in #27.

### Requirement: record the upstream Flue commit the content was taken from (v2.3.0, `deee93b`)
<!-- req: REQ-009 tracks=cli-docs-blueprints-20261018 -->

The system MUST record the upstream Flue commit the content was taken from (v2.3.0, `deee93b`).

### Requirement: make every `amond docs read <page>` pointer in the files `amond init` scaffolds resolve to an included page
<!-- req: REQ-010 tracks=cli-docs-blueprints-20261018 -->

The system MUST make every `amond docs read <page>` pointer in the files `amond init` scaffolds resolve to an included page.

#### Scenario: When a user runs `amond docs read` with each page that `amond init`'s scaffolded files point to, the system shall print that page.

- WHEN a user runs `amond docs read` with each page that `amond init`'s scaffolded files point to
- THEN print that page

## Non-functional Requirements

### Requirement: serve documentation pages without a network connection
<!-- req: REQ-011 tracks=cli-docs-blueprints-20261018 -->

The system SHOULD serve documentation pages without a network connection.

### Requirement: fail a registry request within a bounded time with a message that names the registry, instead of hanging
<!-- req: REQ-012 tracks=cli-docs-blueprints-20261018 -->

The system SHOULD fail a registry request within a bounded time with a message that names the registry, instead of hanging.

### Requirement: fetch blueprint text by default only over HTTPS from a location the amond project controls, because coding agents act on that text; an `AMOND_REGISTRY_URL` override is the user's own explicit choice
<!-- req: REQ-013 tracks=cli-docs-blueprints-20261018 -->

The system SHOULD fetch blueprint text by default only over HTTPS from a location the amond project controls, because coding agents act on that text; an `AMOND_REGISTRY_URL` override is the user's own explicit choice.
