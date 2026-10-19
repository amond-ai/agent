# Known Issues

> Track: cli-docs-blueprints-20261018
> Recorded: 2026-10-19, after the `/please:review` loop on PR #35 (phase 2) at 6b9ca0d4: 3
> iterations to `max_iterations`, then a re-run of 2 iterations to exit `needs_human_read`.

The review loop left these findings open. Each was validated as realistic but unproven, so none
was fixed automatically. None blocks this track. The PR bot reviews after finalize fixed the empty
slug, the deploy timeout, the main-only deploy, the served blueprints' attribution and the blank
`AMOND_REGISTRY_URL`; one finding remains:

- `packages/cli/src/commands/blueprints.test.ts`: the piping-instructions test clears every agent
  env var `@vercel/detect-agent` reads, but the library also detects Devin by `/opt/.devin`, so
  the test fails on a machine that has that file.

Coverage: the `greptile` review engine is enabled but its CLI is not installed, so it did not run.

## Phase 1 (PR #33, the docs pages)

Recorded 2026-10-19, after the review loop on PR #33 at d0aafc82: 3 iterations to
`max_iterations`, then a re-run of 2 iterations to exit `needs_human_read`. `guide/migration.md`
was dropped during the review: it was Flue's beta-to-2.0 upgrade guide and described releases
amond never had. These findings were validated as real but low impact, so none was fixed
automatically:

- Leftover references to things amond does not ship: channel packages wrapping
  `channel.route()` (`reference/agent-api.md:375`), the Ecosystem catalog page
  (`ecosystem/deploy/node.md:254`), the channel catalog section (`guide/channels.md:7`),
  per-integration Sentry and OpenTelemetry guides
  (`guide/observability.md:175`), and Sentry and OpenTelemetry exporters
  (`ecosystem/deploy/cloudflare.md:578`).
- `guide/observability.md:160` says amond ships no packaged exporters, but the Cloudflare tracing
  adapter is one.
- `guide/getting-started.md:19`: the setup prompt runs a bare `amond init`, which is not on
  `PATH` in a fresh directory and errors without `--target` when there is no TTY.
- `ecosystem/deploy/docker.md:63` ends in a colon whose code block was removed.
- `packages/cli/NOTICE` says the pages were edited to drop pages, not that remaining pages were
  edited too.
- `packages/cli/src/lib/docs-content.test.ts`: the link guard does not check `#anchors` or
  reference-style links. Every current anchor resolves.
- No test covers the missing-docs error path in `packages/cli/src/commands/docs.ts`.
- `packages/cli/src/commands/docs.test.ts`: the listing test would miscount a page whose
  description contained ` -- `. None does.

Outside the phase 1 diff, for follow-up issues: the engines found defects in Flue's own docs text
(the approval bypass in `guide/tools.md`, Cloudflare setups without `amondWorkerConfig()`,
examples without a sandbox or model, the GitLab token name, and others; cubic's PR findings of
this kind are in #38), `amond dev` named in
`reference/errors.md` and `packages/agent/src/errors.ts`, the search index stripping `<path>`-style
placeholders, and the "No documentation is bundled" message for a broken install (TD-001).

Outside this diff, for follow-up issues:

- `packages/cli/src/commands/blueprints.ts`: `replaceAll('{{URL}}', url)` expands `$&`, `$'` and
  `` $` `` in the user's URL. The line is unchanged here.
- The imported blueprint text has defects the engines found in Flue's own content, kept because the
  spec keeps imported content's meaning (cubic's PR findings of this kind are in #37): no
  `hostVerifier` and `cd`/`export` chaining in exedev,
  the abort race in cloudflare-computer, the unbounded readiness probe in boxd, `stat` without
  `-L` in boxd, islo and modal, unchecked `mkdir -p` exit codes in daytona and exedev, the
  undefined `cloudflareSandboxFactory` in cloudflare, the vitest-evals metadata fields, the mirage
  dependency, and modal's Alpine/bash assumption.
