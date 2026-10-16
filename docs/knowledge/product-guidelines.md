# Product Guidelines

The rules for how this project writes prose, records decisions, and designs its public surface.
Read it before writing documentation, an ADR, or a new package API.

## Language

- All documentation, code, comments, and commit messages are written in **English**. This is a
  public open-source repository (see [the contributing guide](../../CONTRIBUTING.md)).

## Prose style

- Write in plain, direct sentences that state a decision and its reason. The README and ADRs are
  the reference voice: they say what was chosen, why, and what it costs.
- Prefer concrete trade-offs to adjectives. A comparison table beats a list of benefits.
- Say what is not done yet. Status sections name the unimplemented parts explicitly.
- British spelling already appears in existing prose ("optimises", "behaviour", "neighbours").
  Keep a document internally consistent rather than rewriting existing text.

## Architecture decisions

- Any change to a recorded decision starts with its ADR in `docs/adr/`.
- New ADRs follow the existing shape: Status, Date, Context, Decision Drivers, Decision,
  Consequences (Positive, Negative, Neutral), Alternatives Considered, References.
- Alternatives are recorded with the reason they were rejected.

## API and design principles

1. **One concern per file.** The change unit is a file, because the expected editor is an agent.
   This applies to the framework's own code as much as to agent definitions.
2. **Convention is API.** A directory name in the agent layout is a public contract. Renaming one
   is a breaking change.
3. **Explicit over hidden.** Choices that decide which adapter runs, such as the harness, live in
   typed code that the user writes.
4. **Narrow contracts, escape hatches for the rest.** A contract expresses what an agent session
   needs and nothing else. Platform-specific capabilities stay reachable without being lifted into
   the contract.
5. **Fail loudly.** An unimplemented surface throws. It never returns a plausible placeholder.
6. **Do not own the user's deploy config.** The framework emits handlers. Platform config files
   stay with the user.

## Code conventions

- TypeScript strict mode, ES modules only.
- Lint and format through `@pleaseai/eslint-config`. Shared rule overrides live in
  `eslint.rules.ts` so package configs cannot drift apart.
- A comment explains *why*, including measured runtime quirks (see `vitest.shared.ts`). It does not
  restate the code.
- Every package publishes from `dist/` with a `NOTICE` file and the Apache-2.0 license.

## Developer experience

- `amond dev` runs the full durable model locally with no cloud account.
- Adding a tool, skill, schedule, or channel requires adding a file and nothing else.
- Error messages for convention violations, such as a mistyped filename, should name the file and
  the expected layout, because the loader turns these into runtime discoveries.

## Contribution flow

Follow [the contributing guide](../../CONTRIBUTING.md) for issues, discussions, pull requests,
and security reports.
