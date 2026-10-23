# Tech Debt Tracker

> Tracked across all tracks. Updated during implementation and retrospectives.

## Active

| ID | Source Track | Description | Priority | Created |
|----|------------|-------------|----------|---------|
| TD-001 | flue-import-rename-20261017 | `amond docs` "not bundled" message (`packages/cli/src/commands/docs.ts:86`) also shows for a broken install | Low | 2026-10-18 |
| TD-002 | flue-import-rename-20261017 | CLI tests spawn the built `bin/amond.mjs` (need `dist/`) and run under Bun via `process.execPath`, not Node | Medium | 2026-10-18 |
| TD-003 | flue-import-rename-20261017 | Lint rules disabled for imported code: `regexp/no-super-linear-backtracking` (7 hits), `ts/no-this-alias`, `no-unmodified-loop-condition` | Medium | 2026-10-18 |
| TD-006 | flue-import-rename-20261017 | No test asserts `amond --help` output (SC-5 partial) | Low | 2026-10-18 |
| TD-008 | blueprint-findings-20261020 | No check compiles or runs blueprint code samples against their SDKs; only blueprint structure is validated | Medium | 2026-10-20 |
| TD-009 | blueprint-findings-20261020 | vitest-evals blueprint pinned to `^0.13.1`; harness not ported to the 0.17 API | Low | 2026-10-20 |
| TD-011 | ai-sdk-sandbox-20261020 | `sandboxFromDriver` reports a failed read as a missing file when the driver's `exists()` returns false on error (Daytona blueprint), losing the provider error | Medium | 2026-10-21 |
| TD-012 | ai-sdk-sandbox-20261020 | Cloudflare live `spawn` rejects `wait()` on a stream `error` event; `run` and `local()` report launch failures as exit 1 | Low | 2026-10-21 |
| TD-013 | ai-sdk-sandbox-20261020 | `cloudflareSandbox` supports only `@cloudflare/sandbox` 0.x; 1.x removes the `getSandbox()` stub | Medium | 2026-10-21 |
| TD-014 | ai-sdk-sandbox-20261020 | `cf-spawn.test.ts` 1 MiB frame parse test asserts < 500 ms; timing-sensitive on slow CI | Low | 2026-10-21 |
| TD-017 | cf-bare-exit-20261022 | Cloudflare subshell wrapper edge cases kept as plausible in review: `kill()`, an abort and `timeoutMs` on a wrapped single long-running child (`sleep 600`) not checked on a real container (the T002 kill run stopped a loop that runs in the subshell itself); `execReplacesShellStub` accepts an `eval` wrapper without the subshell; the AC-014 test cannot see trap output on just-bash; the fake's completion marker is fooled by a command that prints it and then ends the shell | Low | 2026-10-23 |
| TD-015 | cf-spawn-kill-20261022 | Cloudflare process-path edge cases kept as plausible in review: process-log `error` message in `data`, no deadline on `kill()` while `startProcess` is pending, undisposed `startProcess` RPC stubs, `complete` frame ignored, `null` exit code from the `getProcess` fallback, orphan after a misdetected death during start (plan.md Decision Log) | Low | 2026-10-22 |

## Resolved

| ID | Source Track | Description | Resolved In | Date |
|----|------------|-------------|-------------|------|
| TD-016 | cf-spawn-kill-20261022 | A Cloudflare command ending in a bare `exit N` killed the session shell: `cloudflareSandbox` now runs each caller command in its own subshell, so `run` and both live `spawn` paths report exit code N. Verified on a real container | cf-bare-exit-20261022 (#52) | 2026-10-22 |
| TD-010 | ai-sdk-sandbox-20261020 | Cloudflare live `spawn` `kill()` left the remote command running: live spawn now runs through `startProcess`/`streamProcessLogs`, and `kill()`, a caller abort, the output cap and `timeoutMs` stop it with `killProcess`. Verified on a real container | cf-spawn-kill-20261022 (#51) | 2026-10-22 |
| TD-007 | blueprint-findings-20261020 | islo `writeFile` left its `/tmp` staging file when an `exec` rejected: cleanup now runs in a `finally` (best-effort: a failed `rm -f` is ignored) | blueprint-findings-20261020 (PR #42 review) | 2026-10-20 |
| TD-005 | flue-import-rename-20261017 | `docs-pages.ts` candidate to move to `apps/docs`: dropped, pages live in `packages/cli/docs` | cli-docs-blueprints-20261018 (T002) | 2026-10-19 |
| TD-004 | flue-import-rename-20261017 | Blueprint registry came only from internal `AMOND_REGISTRY_URL`: default is now `https://blueprints.amond.ai`, docs and blueprints are bundled | cli-docs-blueprints-20261018 (T005) | 2026-10-19 |
