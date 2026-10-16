# ADR-0004: Ship Flue as amond-branded packages from this repository

## Status

Accepted

## Date

2026-10-16

## Context

ADR-0003 made Flue the base as a fork, `amond-ai/flue`, kept close enough to upstream that the
agent-loop seam could be offered back. It did not say how the result reaches users. The product is
an npm-published framework under the amond name, and that changes what the fork has to be. This
supersedes decision 1 of ADR-0003 (0003-build-on-flue-with-ai-sdk-harness.md).

**Flue's names are not ours to ship under.** The `@flue/*` scope belongs to withastro on npm, so
publishing there is not an option. Elsewhere it is a branding choice: the product is amond, so it
is not published as Flue or under a Flue-derived name such as `@amond-ai/flue-runtime`. Apache-2.0
§6 grants no trademark rights beyond describing where the code came from, so building a product
name on Flue's would rest on no grant at all. Installing our fork through an npm alias
(`"@flue/runtime": "npm:@amond-ai/..."`) would still put Flue's name in every user's imports.

**The brand runs deeper than package names.** Flue's packages import each other as `@flue/*`, and
the code its Vite plugin generates does the same. Beyond imports, the brand is in what a user
touches: the `flue` command, `flue.config.ts`, three `FLUE_*` environment variables
(`FLUE_DEV_SQLITE_PATH`, `FLUE_REGISTRY_URL`, `FLUE_REGISTRY_TIMEOUT_MS`), `virtual:flue/*` module ids, and the `Flue<Name>Agent` Durable Object classes — 23 source files
across the runtime, Vite plugin and CLI. Rewriting names in the build output at publish time can
reach package names and specifiers, but not a config filename, a CLI name or a class prefix.

**The fork diverges anyway.** Removing Pi (ADR-0003 decision 3) rewrites the core of Flue's
runtime — `session.ts` and about twenty files around it. Staying mergeable with upstream was
already going to be expensive; renaming in source adds less to that cost than it first appears.

**This repository already publishes.** release-please, npm trusted publishing and provenance are
set up here, under the `@amond-ai` scope, along with the bun, ESLint, tsdown and Vitest toolchain.
A separate fork would need all of that rebuilt on pnpm, Biome and its own release flow.

## Decision Drivers

- Users install and import amond names only; Flue's name appears in attribution, not in the API.
- One repository builds, tests and publishes the framework.
- What ships is what the source says — no rename step between the code and the package.
- Flue's history stays reachable for blame and for evaluating upstream changes.

## Decision

1. **Flue's packages move into this repository, renamed in source.** Each package is imported into
   `packages/` with its history (`git subtree split` per package in a full Flue clone, then
   `git subtree add`), then renamed:

   | Flue package | Published as | Notes |
   | --- | --- | --- |
   | `@flue/runtime` | `@amond-ai/agent` | the framework's main entry |
   | `@flue/vite` | `@amond-ai/agent-vite` | |
   | `@flue/cli` | `amond` | binary `amond`; replaces the current `amond` package |
   | `@flue/sdk` | `@amond-ai/agent-sdk` | |
   | `@flue/react` | `@amond-ai/agent-react` | |

   Channels, persistence adapters and OpenTelemetry are imported later, when a deployment needs
   them. On Cloudflare, persistence is the Durable Object's embedded SQLite, so none are needed for
   the first release.

2. **Brand surfaces are renamed with the packages.** The `flue` command becomes `amond`;
   `flue.config.ts` becomes `amond.config.ts`; `FLUE_*` environment variables and constants become `AMOND_*`; `virtual:flue/*` becomes
   `virtual:amond/*`; `Flue<Name>Agent` becomes `Amond<Name>Agent`. The `'use agent'` directive is
   not a brand and stays.

3. **The imported packages adopt this repository's toolchain** — bun workspaces, ESLint, tsdown,
   Vitest — and publish through the existing release-please and trusted-publishing flow, with
   provenance.

4. **Upstream is followed by manual ports, not by merge.** Changes in withastro/flue are reviewed
   and ported by hand into the renamed packages, case by case: after the move and the renames, an
   upstream commit's paths and identifiers no longer match ours, so it does not apply directly.
   `vendor/flue` points back to withastro/flue as a read-only reference, and the `amond-ai/flue`
   fork is archived.

5. **Attribution is kept.** Flue's copyright and license notice go into `NOTICE`, and each
   imported package's README says it is derived from Flue.

ADR-0003's other decisions stand: Cloudflare first, the AI SDK harness replacing Pi, the sandbox
extending the AI SDK sandbox, and Flue's agent model and durability replacing ADR-0001 and
ADR-0002. Their work now happens in this repository instead of the fork.

## Consequences

### Positive

- Users see one brand: `npm install @amond-ai/agent`, `amond dev`, `amond.config.ts`.
- One repository, one toolchain and one release flow for the whole framework.
- No publish-time rewrite to maintain or to debug through: source, stack traces and packages agree.
- Package history from Flue survives the import, so blame still explains why code is the way it is.

### Negative

- Upstream fixes stop arriving for free. Each one is a deliberate port, and the cost grows as the
  code diverges.
- The import is a one-time migration with real work in it: Flue v2.3.0, the revision
  `vendor/flue` pins, builds with pnpm, Biome and TypeScript 7 (`typescript: ^7.0.2`), this
  repository with bun, ESLint and TypeScript 5.9. Lint and type differences
  have to be resolved before the imported packages pass `check` and `lint`.
- The loop seam can no longer be offered upstream as a clean patch; it would have to be
  re-derived against upstream.
- Renaming environment variables and class names breaks compatibility with Flue's documentation,
  examples and blueprints; ours have to be written.

### Neutral

- The `amond` name reservation (#9) now covers the CLI that comes from Flue rather than the CLI
  built under ADR-0001.
- Packages left behind in Flue (channels, persistence, telemetry) stay available to import later
  with the same procedure.

## Alternatives Considered

- **Keep `@flue/*` names in source, rewrite them at publish time**: upstream merges stay easy.
  Rejected because the rewrite reaches only package names and specifiers, leaving the CLI, config
  file, environment variables and class names Flue-branded, and because shipped code would differ
  from the source it was built from.
- **Rename in the fork and publish from `amond-ai/flue`**: keeps Flue's toolchain untouched.
  Rejected because it splits the framework across two repositories and needs a second release
  setup, while this repository already publishes under `@amond-ai`.
- **Publish the fork as `@amond-ai/flue-*` and wrap it**: smallest change. Rejected because it ships
  under Flue's name rather than ours, with no trademark grant behind that use, and the wrapped
  packages still leak through imports and generated code.
- **Copy Flue's sources without history**: simplest import. Rejected because history is cheap to
  keep with `git subtree` and is what lets blame and an upstream diff explain a port.

## References

- ADR-0003 (0003-build-on-flue-with-ai-sdk-harness.md) — decision 1 superseded
- [withastro/flue](https://github.com/withastro/flue) — Apache-2.0
- [Apache License 2.0, §6 Trademarks](https://www.apache.org/licenses/LICENSE-2.0#trademarks)
- [git subtree](https://github.com/git/git/blob/master/contrib/subtree/git-subtree.adoc)
- [Issue #9](https://github.com/amond-ai/agent/issues/9) — reserve the `amond` name on npm

---

**Created**: 2026-10-16
**Author**: Minsu Lee
**Last Updated**: 2026-10-17
