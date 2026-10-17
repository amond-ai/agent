---
name: ocr-scoping-amond-repo
description: ocr delegate default exclusions observed in the amond-ai/agent monorepo (turbo/bun workspace)
metadata:
  type: project
---

In this repo (turbo + bun workspace, packages/{amond,core,durable,...}), `ocr delegate preview`
excludes `*.md` files (`unsupported_ext`) and every `*.test.ts` file (`default_path`) from the
reviewable set by default. Only non-test `.ts` source files are reviewable. A `.please/config.yml`
exists in this repo; its current `review` section leaves OCR defaults unset, but re-check it before
assuming `REVIEW_OCR_DEFAULT_FLAGS` is empty; use `setup-env.sh --print` to verify the exports.

**How to apply:** when scoping a review here, expect roughly half the changed files (README.md,
`*.test.ts`) to show up struck through in the preview as excluded — that's expected, not a gap.
Tests use vitest (`vi.hoisted`, `vi.mock`), not `bun test` directly — `bun test packages/amond/...`
fails with `vi.hoisted is not a function` even though most individual tests still pass, which reads
as green but silently skips the mocked-fs tests. Use `bunx turbo run test --filter=<pkg> --force`
(runs `bun --bun vitest run`) instead. `bunx turbo run check --filter=<pkg> --force` and `bunx
turbo run lint --filter=<pkg> --force` also work cleanly from the repo root and are fast/cheap ways
to corroborate (or rule out) suspected type/lint issues found during manual diff review before
reporting them as findings.
