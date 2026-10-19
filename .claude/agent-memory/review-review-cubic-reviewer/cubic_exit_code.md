---
name: cubic-exit-code-semantics
description: cubic review exit 1 with valid JSON on stdout and empty stderr means issues were found, not a crash. Check issue count before treating as failure.
metadata:
  type: reference
---

`cubic review -j -b <base>` exits 1 when it reports one or more issues, and exits 0 when it reports none. Stdout is always valid JSON, stderr is empty, and `--print-logs --log-level DEBUG` shows a normal completion (`finishReason=stop`) with no error.

**Why:** On PR #35 (`amond-ai/agent`, base `origin/tracks/cli-docs-blueprints-20261018`) the run exited 1 with 6 issues. The same tool against `origin/tracks/cli-docs-blueprints-20261018-phase-2-blueprints-from` exited 0 with 0 issues. The `-b` value takes a ref string, and both `origin/` and bare forms were accepted by the CLI syntax.

**How to apply:** Parse stdout first. Treat non-zero exit as a failure only when stdout is missing or invalid JSON, or stderr has content. If `issues` is non-empty, report the findings even when the exit code is 1.
