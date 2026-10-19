# Known Issues

> Track: cli-docs-blueprints-20261018
> Recorded: 2026-10-19, after the `/please:review` loop on PR #35 (phase 2) at 6b9ca0d4: 3
> iterations to `max_iterations`, then a re-run of 2 iterations to exit `needs_human_read`.

The review loop left these findings open. Each was validated as realistic but unproven, so none
was fixed automatically. None blocks this track.

- `packages/cli/src/lib/blueprint-index.ts:222`: `buildBlueprintIndex` accepts an empty slug from
  a file named `<kind>--.md`. The CLI index generator would list it and fetch `<registry>/.md`;
  the registry build fails on it with the unhelpful "no slug was derived".
- `.github/workflows/deploy-registry.yml`: the deploy job has no `timeout-minutes`, so a stalled
  deploy holds the non-cancelling concurrency group for GitHub's 6-hour default.
- `.github/workflows/deploy-registry.yml`: `workflow_dispatch` deploys whatever branch it is run
  on. Restrict the `registry` environment's deployment branches to `main`.
- `apps/registry/src/build.ts`: the served blueprints carry no attribution. The credit to Flue is
  in `blueprints/README.md` and `packages/cli/NOTICE`, and neither is deployed to
  `blueprints.amond.ai`. Whether that meets Apache-2.0 §4(a) and §4(b) for the served copies is
  open; upstream has no NOTICE, so §4(d) does not apply.
- `packages/cli/src/commands/blueprints.test.ts`: the piping-instructions test clears every agent
  env var `@vercel/detect-agent` reads, but the library also detects Devin by `/opt/.devin`, so
  the test fails on a machine that has that file.
- `packages/cli/src/commands/blueprints.ts:142`: a whitespace-only `AMOND_REGISTRY_URL` is used as
  the registry instead of falling back to the default. The error names the URL.

Coverage: the `greptile` review engine is enabled but its CLI is not installed, so it did not run.
PR #33 (phase 1, the docs pages) has not been through the review loop.

Outside this diff, for follow-up issues:

- `packages/cli/src/commands/blueprints.ts`: `replaceAll('{{URL}}', url)` expands `$&`, `$'` and
  `` $` `` in the user's URL. The line is unchanged here.
- `apps/registry/turbo.json` lists no `check` inputs for the CLI file the registry imports. It has
  no effect while each package's `"check": "bun check"` recurses to `E2BIG` (since #31); add the
  input when that is fixed.
- The imported blueprint text has defects the engines found in Flue's own content, kept because the
  spec keeps imported content's meaning: no `hostVerifier` and `cd`/`export` chaining in exedev,
  the abort race in cloudflare-computer, the unbounded readiness probe in boxd, `stat` without
  `-L` in boxd, islo and modal, unchecked `mkdir -p` exit codes in daytona and exedev, the
  undefined `cloudflareSandboxFactory` in cloudflare, the vitest-evals metadata fields, the mirage
  dependency, and modal's Alpine/bash assumption.
