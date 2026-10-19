---
name: wrangler-under-bun
description: wrangler dev / unstable_startWorker hang under Bun; in `bun --bun vitest` the `node` on PATH is a Bun shim
metadata:
  type: project
---

wrangler's dev server (CLI `wrangler dev` and `unstable_startWorker`) starts under Bun but never answers requests. Tests here run as `bun --bun vitest run`, which puts a `node` shim (realpath basename `bun`) on PATH, so `spawn('node', ...)` silently runs Bun.

**Why:** cost ~10 tool calls of debugging on 2026-10-19 (T004, apps/registry).
**How to apply:** when a test must run wrangler, spawn a real Node binary found by walking PATH and skipping entries whose realpath basename starts with `bun` (see `realNode()` in apps/registry/src/build.test.ts). Also: the worktree-isolation guard refuses heredocs and compound `env -u` commands — write files with the Write tool.
