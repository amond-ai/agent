# Known Issues

> Track: flue-import-rename-20261017
> Recorded: 2026-10-17, after the `/please:review` loop (3 iterations, exit `needs_human_read`) on
> PR #27 at 9bf82a2 (rebased onto `main` after #24 merged).

The review loop left these findings open. Each was validated as realistic but unproven, so none
was fixed automatically. None blocks this track.

- `packages/cli/src/commands/docs.ts:86`: the no-docs message replaced the old "installation may
  be incomplete" hint. Correct while no docs ship. Once track 2 bundles the docs, a broken install
  would get the same message, so track 2 should tell the two cases apart.
- `packages/cli/src/commands/init.test.ts` and `no-content.test.ts` spawn `bin/amond.mjs`, which
  loads the built `dist/`. `bun run test` builds first through turbo, but a direct `vitest run`
  in `packages/cli` tests whatever was last built.
- The same tests spawn the CLI with `process.execPath`, which under `bun --bun vitest run` is Bun.
  The CLI's behavior is never checked on Node, its supported runtime.

Coverage: the `greptile` review engine is enabled but its CLI is not installed, so it did not run.

Rejected as by design, for track 2 to settle: the `amond docs read <page>` pointers that
`amond init` scaffolds resolve only once track 2 bundles the pages, and with the default registry
removed, `amond add` and `amond update` need a registry decision once blueprints are bundled.
