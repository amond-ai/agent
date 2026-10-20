# amond blueprints

This directory holds the source Markdown for the implementation guides returned by `amond add` and
`amond update`. A blueprint is a guide for an AI coding agent, not an npm package or runtime
abstraction: the CLI fetches and prints the guide from the blueprint registry, and the coding agent
edits the user's project. The same complete guide serves both a new integration and an update.

## Supported kinds

| Kind       | Result                                                             |
| ---------- | ------------------------------------------------------------------ |
| `sandbox`  | A sandbox adapter for a remote execution provider.                 |
| `channel`  | Verified provider ingress, a client, and application-owned tools.  |
| `database` | A database adapter implementing amond's `PersistenceAdapter`.      |
| `tooling`  | A developer-tool integration such as observability or evaluation.  |

Only `sandbox` and `tooling` have named blueprints. The `channel` and `database` kinds ship their
build-from-scratch guide only, for use as `amond add channel <url>` and `amond add database <url>`.

## File naming

Named blueprints use `<kind>--<name>.md`. The generic guide for a kind uses `<kind>.md` and sets
`"root": true` in its frontmatter. The double dash keeps provider names that contain a single dash
unambiguous. Every file starts with JSON frontmatter and ends with an `## Upgrade Guide`; the index
generator, `packages/cli/scripts/generate-blueprint-index.ts`, validates both and ignores this
README.

## Attribution

These blueprints are derived from Flue's blueprints (https://github.com/withastro/flue) at commit
`deee93b` (v2.3.0), which is licensed under the Apache License, Version 2.0.
amond also corrected defects in some of the blueprints.
`apps/registry/CHANGES.md` describes the rename and lists every other change from that commit.
