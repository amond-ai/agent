---
name: pr-conventions-amond-ai-agent
description: amond-ai/agent opens PRs as drafts — AI reviewers start when a PR is marked ready; repo template has a checklist to tick
metadata:
  type: project
---

`amond-ai/agent` PRs are created as **drafts** unless the user passes `--ready`.

**Why:** Draft-first is the documented policy in `docs/knowledge/workflow.md`. The repository
runs AI reviewers as GitHub Apps, listed under `pr_review_bots` in `.please/config.yml`: Codex,
Gemini Code Assist, and cubic. Gemini skips drafts (`include_drafts: false` in
`.gemini/config.yaml`), so AI review starts when the PR is marked ready with
`/github:mark-pr-ready`, not while the branch is still changing. They are Apps, not workflows,
so `.github/workflows/` does not show them.

**How to apply:** Open with `--draft` and end the report with the `/github:mark-pr-ready`
guidance line. If `docs/knowledge/workflow.md` or `.please/config.yml` change the policy, follow
them over this note. The repo template is `.github/PULL_REQUEST_TEMPLATE.md` (Summary / Related
issue / Checklist): fill the checklist boxes rather than leaving them unticked, and verify the
claims first.
