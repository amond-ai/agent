---
name: cubic-exit-code-semantics
description: cubic review exit 1 with valid JSON listing issues and empty stderr has meant issues were found, not a crash. Check the issue list before treating it as failure.
metadata:
  type: reference
---

In the runs observed, `cubic review -j -b <base>` exited 1 when it reported one or more issues and 0 when it reported none. Stdout was valid JSON, stderr was empty, and `--print-logs --log-level DEBUG` showed a normal completion (`finishReason=stop`) with no error. This is observed behavior, not a documented exit-code contract.

**Why:** On PR #35 (`amond-ai/agent`, base `origin/tracks/cli-docs-blueprints-20261018`) the run exited 1 with 6 issues. The same tool against `origin/tracks/cli-docs-blueprints-20261018-phase-2-blueprints-from` exited 0 with 0 issues. The two runs used different bases, so they show the pattern but don't prove it. The `-b` value takes a ref string, and both `origin/` and bare forms were accepted by the CLI syntax.

**How to apply:** Parse stdout first. Read exit 1 as "issues found" only when stdout is valid JSON with a non-empty `issues` list and stderr is empty; then report the findings. Treat any other non-zero exit as a failure, including exit 1 with valid JSON but no issues.
