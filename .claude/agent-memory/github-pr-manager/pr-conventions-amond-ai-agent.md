---
name: pr-conventions-amond-ai-agent
description: amond-ai/agent opens PRs ready (not draft) — no AI-review-on-open workflow; repo template has a checklist to tick
metadata:
  type: project
---

`amond-ai/agent` PRs are created **ready for review**, not draft.

**Why:** The draft-by-default rule exists because `chatbot-pf` / `pleaseai` org repos run
automatic AI review on PR open. `amond-ai` is a different org, and the repo's only
`pull_request`-triggered workflows are `ci.yml` and `zizmor.yml` — no AI reviewer fires on open,
so a draft buys nothing.

**How to apply:** Skip `--draft` here unless the user asks for one. Re-check
`.github/workflows/` for a new AI-review workflow before relying on this. The repo template is
`.github/PULL_REQUEST_TEMPLATE.md` (Summary / Related issue / Checklist) — fill the checklist
boxes rather than leaving them unticked, and verify the claims first.
