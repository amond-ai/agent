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

1. **One brand in the public surface.** Users install, import, configure, and run amond names
   only: `@amond-ai/*`, the `amond` command, `amond.config.ts`, `AMOND_*`, `virtual:amond/*`, and
   `Amond<Name>Agent`. Flue's name appears only in `NOTICE` and in each imported package's README.
2. **What ships is what the source says.** Renames happen in source, never as a publish-time
   rewrite, so stack traces, source, and packages agree.
3. **Keep upstream reachable.** Imported Flue code keeps its history. Keep changes to it focused,
   so an upstream fix can still be judged and ported by hand.
4. **The harness is the agent.** Agent turns run through the AI SDK harness inside a sandbox. Do
   not add a host-side model loop.
5. **One sandbox object.** Flue's tools and the harness share the same sandbox session. Extend the
   AI SDK sandbox shape rather than adding a parallel one.
6. **Fail loudly.** An unimplemented surface throws. It never returns a plausible placeholder.
7. **Do not own the user's deploy config.** `wrangler.jsonc`, including the Sandbox container,
   stays with the user.

## Code conventions

- TypeScript strict mode, ES modules only.
- Lint and format through `@pleaseai/eslint-config`. Shared rule overrides live in
  `eslint.rules.ts` so package configs cannot drift apart.
- A comment explains *why*, including measured runtime quirks (see `vitest.shared.ts`). It does not
  restate the code.
- Every package publishes from `dist/` with a `NOTICE` file and the Apache-2.0 license.

## Developer experience

- `amond dev` runs agents locally on Node, the development target.
- Error messages name the file, option, or environment variable at fault, using its amond name.
- Documentation and examples are our own. Flue's docs use Flue's names and do not apply as written.

## Contribution flow

Follow [the contributing guide](../../CONTRIBUTING.md) for issues, discussions, pull requests,
and security reports.
