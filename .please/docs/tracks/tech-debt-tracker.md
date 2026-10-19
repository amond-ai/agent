# Tech Debt Tracker

> Tracked across all tracks. Updated during implementation and retrospectives.

## Active

| ID | Source Track | Description | Priority | Created |
|----|------------|-------------|----------|---------|
| TD-001 | flue-import-rename-20261017 | `amond docs` "not bundled" message (`packages/cli/src/commands/docs.ts:86`) also shows for a broken install | Low | 2026-10-18 |
| TD-002 | flue-import-rename-20261017 | CLI tests spawn the built `bin/amond.mjs` (need `dist/`) and run under Bun via `process.execPath`, not Node | Medium | 2026-10-18 |
| TD-003 | flue-import-rename-20261017 | Lint rules disabled for imported code: `regexp/no-super-linear-backtracking` (7 hits), `ts/no-this-alias`, `no-unmodified-loop-condition` | Medium | 2026-10-18 |
| TD-006 | flue-import-rename-20261017 | No test asserts `amond --help` output (SC-5 partial) | Low | 2026-10-18 |

## Resolved

| ID | Source Track | Description | Resolved In | Date |
|----|------------|-------------|-------------|------|
| TD-005 | flue-import-rename-20261017 | `docs-pages.ts` candidate to move to `apps/docs`: dropped, pages live in `packages/cli/docs` | cli-docs-blueprints-20261018 (T002) | 2026-10-19 |
| TD-004 | flue-import-rename-20261017 | Blueprint registry came only from internal `AMOND_REGISTRY_URL`: default is now `https://blueprints.amond.ai`, docs and blueprints are bundled | cli-docs-blueprints-20261018 (T005) | 2026-10-19 |
