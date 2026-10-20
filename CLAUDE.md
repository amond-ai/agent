# CLAUDE.md

Project instructions for Claude Code in the `amond-ai/agent` repository.

<!-- please:knowledge v1 -->
## Project Knowledge

Consult these files for project context before exploring the codebase.
For full file listing with workspace artifacts, use `Skill("please:project-knowledge")`.

### Project Documents
- `ARCHITECTURE.md` — Repository map: entry points, module structure, architecture invariants
- `SECURITY.md` — Security policies, vulnerability reporting
- `CONTRIBUTING.md` — Contribution guide, code review process

### Domain Knowledge (docs/knowledge/)
- `product.md` — Product vision, goals, target users
- `product-guidelines.md` — Prose style, ADR format, API design principles
- `tech-stack.md` — Technology choices with rationale
- `workflow.md` — Task lifecycle, testing policy, quality gates, dev commands

### Decision Records
- `docs/adr/` — Architecture Decision Records (ADR)
<!-- /please:knowledge -->

## Gotchas

- `packages/cli/src/lib/docs-content.test.ts` guards every file in `blueprints/`,
  `README.md` included: no upstream (Flue) name except on the one line that credits Flue and
  links its repository, no `-blueprint:` marker but `amond-blueprint`, and no relative link
  that leaves the tree. Content that must name Flue goes under `apps/registry/` (see
  `CHANGES.md`, `NOTICE`).
- When you check a blueprint's code sample, compile the whole extracted file against the
  version its install step resolves, not just its imports. A caret on a `0.0.x` version
  (`^0.0.2`) is an exact pin.
