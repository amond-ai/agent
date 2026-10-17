# Project Workflow

The development workflow for this repository: how tracked work moves from plan to commit, the
quality gates a task must pass, and the commands that run them. `/please:implement` follows it.

## Guiding principles

1. **The Plan is the Source of Truth**: Tracked work lives in the track's `plan.md`. A bug fix or refactor skips the track and goes straight to a branch and PR when all of these hold (see `new-track` Track check):
   - The user did not ask for a track, spec, or plan.
   - The work has no requirements doc, Asana-linked report, or multi-part issue or Epic.
   - Nothing is left to decide: the approach is settled and, for a bug, the cause is known.
   - The change is low-risk and easy to reverse: no authentication, payments, data migration, other security/compliance-sensitive work, or breaking public API change.
2. **The Tech Stack is Deliberate**: Changes to the tech stack must be documented in `tech-stack.md` before implementation
3. **Outcome-Gated Testing**: A task is done when its affected tests, the project's quality gates, and its `Method:` pass. Test-first (RED-GREEN-REFACTOR) applies only to tasks the plan opts in with `Testing: tdd` or a `[TDD]` marker
4. **High Code Coverage**: Aim for >80% code coverage for new code
5. **Non-Interactive & CI-Aware**: Prefer non-interactive commands. Use `CI=true` for watch-mode tools

## Task workflow

Track tasks follow a strict lifecycle within `/please:implement`:

### Standard task lifecycle

1. **Select Task**: Choose the next available task from `plan.md`
2. **Mark In Progress**: Update task status from `[ ]` to `[~]`
3. **Implement**: Make the change the task describes. For a task opted into TDD (`Testing: tdd` or `[TDD]`), first write a failing test and confirm it fails, then write the minimum code to make it pass
4. **Prove**: Run the affected tests, the project's quality gates, and the task's `Method:`, and confirm they pass
5. **Refactor (Optional)**:
   - Improve clarity, remove duplication, enhance performance
   - Rerun tests to ensure they still pass
6. **Verify Coverage**: Run coverage reports. Target: >80% for new code
7. **Document Deviations**: If implementation differs from tech stack, update `tech-stack.md` first
8. **Commit**: Stage and commit with conventional commit message
9. **Update Progress**: Mark the task as completed in `## Progress` with a timestamp

### Phase completion protocol

Executed when all tasks in a phase are complete:

1. **Verify Test Coverage**: Identify all files changed in the phase, ensure test coverage
2. **Run Full Test Suite**: Execute all tests, debug failures (max 2 fix attempts)
3. **Manual Verification Plan**: Generate step-by-step verification instructions for the user
4. **User Confirmation**: Wait for explicit user approval before proceeding
5. **Create Checkpoint**: Commit with message `chore(checkpoint): complete phase {name}`. If the stacked PR workflow is enabled (`workflow.stacked_pr.enabled=true` AND `workflow.stacked_pr.tool=gh-stack` in `.please/config.yml`), `/please:implement` additionally runs `gh stack submit --auto` at this step to refresh all PRs in the stack. The PRs it creates are drafts, gh-stack's default. Draft-first is intentional: Gemini Code Assist skips drafts (`include_drafts: false` in `.gemini/config.yaml`), and AI review starts when a PR is marked ready with `/github:mark-pr-ready`.
6. **Update Plan**: Mark phase as complete in `plan.md`

## Quality gates

Before marking any task complete:

- [ ] All tests pass
- [ ] Code coverage meets requirements (>80%)
- [ ] Code follows project style guidelines
- [ ] No linting or static analysis errors
- [ ] No security vulnerabilities introduced
- [ ] Documentation updated if needed

## Development commands

Every command runs from the repository root. Turborepo fans each one out to the packages.

### Setup

```bash
mise install        # bun 1.4.2 and node 24, pinned in .mise.toml
bun install         # dependencies and husky git hooks
gh extension install github/gh-stack   # `gh stack`, used by the stacked PR workflow
```

### Daily development

```bash
bun run build       # tsdown, per package, into dist/
bun run check       # tsc --noEmit across the workspace
```

A package's `exports` point at `dist/`, so a package has to be built before anything resolves it.
`check` builds only a package's dependencies, not the package being checked.

### Testing

```bash
CI=true bun run test           # vitest under bun; builds each package first
CI=true bun run test:coverage  # istanbul coverage, lcov output per package
bunx turbo run test --filter=@amond-ai/agent-durable  # one package
```

### Before committing

```bash
bun run lint        # eslint, including Markdown, YAML, and JSON
bun run build
bun run check
CI=true bun run test
```

This is the same sequence CI runs in `.github/workflows/ci.yml`. lint-staged and commitlint run
automatically in the husky hooks.

## Testing requirements

### Unit testing

- Every module must have corresponding tests
- Mock external dependencies
- Test both success and failure cases

### Imported upstream code

- Code imported from Flue keeps its own tests. Port them to Vitest together with the code.
- A behaviour-preserving refactor of imported code, such as the agent-loop seam, lands as its own
  commit, separate from behaviour changes.
- A ported upstream fix is a manual port that names the upstream commit. After the renames an
  upstream commit no longer applies directly.

## Commit guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint. release-please derives versions and changelogs from these messages, so accurate types matter. Breaking changes carry a `BREAKING CHANGE:` footer. See `Skill("standards:commit-convention")` for details.

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting changes
- `refactor`: Code change without behavior change
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

## Definition of done

A task is complete when:

1. All code implemented to specification
2. Unit tests written and passing
3. Code coverage meets project requirements
4. Code passes all configured checks
5. Progress updated in `plan.md`
6. Changes committed with proper message
