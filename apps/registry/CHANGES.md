# Changes from Flue

This page lists every difference between amond's `blueprints/` and Flue's `blueprints/` at commit
`deee93b`, which is mirrored in `vendor/flue/blueprints/`, other than the rename. A later sync from
Flue must keep these changes, or it silently undoes amond's fixes and edits. Compare each file
against Flue after reverting the rename, and re-apply every row below that Flue has not adopted.
The rename maps `Flue` and `flue` to `amond`, with these forms:

- `@flue/runtime` becomes `@amond-ai/agent`, and its subpaths (`/cloudflare`, `/routing`,
  `/adapter`, `/internal`) keep their names. `@flue/sdk` becomes `@amond-ai/agent-sdk`, and
  `@flue/vite` becomes `@amond-ai/agent-vite`.
- The CLI `flue` becomes `amond`, the source root `.flue/` becomes `.amond/`, and the marker
  `flue-blueprint:` becomes `amond-blueprint:`.
- `FLUE_AGENT_URL` becomes `AMOND_AGENT_URL`, and the log prefix `[flue:<provider>]` becomes
  `[amond:<provider>]`.
- In identifiers, `Flue` becomes `Amond`, for example `FlueObservation`, `createFlueClient` and
  `Flue<PascalName>Agent`.
- The article before the name follows: "a Flue project" becomes "an amond project".

One identifier is not renamed: `braintrustFlueObserver` is an export of the `braintrust`
package, so `tooling--braintrust.md` keeps it.

The finding numbers refer to the review findings fixed in issue #37. "Import (#35)" rows are
edits made when the files were imported, for packages and pages that amond does not ship. A
version 2 file also changes its frontmatter `version`, every `amond-blueprint` marker example,
and adds a `### Version 2` entry to its Upgrade Guide. Those three edits are one row per file.

## `channel.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Removes "The provider does not have a named amond blueprint", because amond ships no named channel blueprints. | Import (#35) | Initial import |
| Replaces "If a maintained `@flue/<provider>` ingress package exists, use it" with "amond ships no provider-specific ingress packages". | Import (#35) | Initial import |
| Mounts the channel only through `createChannelRouter`; drops the first-party `channel.route()` router factory. | Import (#35) | Initial import |
| Drops the ingress package from the install step. | Import (#35) | Initial import |
| Says "one handler per provider protocol surface" instead of "one constructor-owned callback". | Import (#35) | Initial import |

## `database.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| States that amond ships only the in-memory default and `sqlite()`. | Import (#35) | Initial import |
| Replaces the Flue spec URL and the Postgres worked-example URL with `amond docs read reference/data-persistence-api`, `amond docs read guide/database`, and the contract suites from `@amond-ai/agent/test-utils`. There is no worked example to copy. | Import (#35) | Initial import |

## `sandbox--boxd.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Passes `timeoutMs` to the readiness probe in `waitForReady`, so a probe that never answers cannot block forever. | #17 | v2 |
| Clears `readyPromise` when the probe fails, so the next `createSandbox()` probes again. | #18 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #17, #18 | v2 |

## `sandbox--cloudflare-computer.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Kills the run and rejects with `AbortError` in `settleExec` when the signal is already aborted. | #7 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #7 | v2 |
| Rebuilds the sandbox on `SandboxDriver` and `sandboxFromDriver` instead of a hand-written `Sandbox`, because the `Sandbox` type now follows the AI SDK sandbox session. `createWorkspaceDriver` replaces `createWorkspaceSandbox`, and `normalizePath`, `abortError`, and `settleExec` are removed: the wrapper resolves paths and rejects promptly on abort, and the driver only kills the run best-effort. | AI SDK sandbox session | v3 |
| Adds a `description` to the sandbox. | AI SDK sandbox session | v3 |
| Version bump: `version`, markers, Upgrade Guide entry. | AI SDK sandbox session | v3 |

## `sandbox--cloudflare.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Pins the `Dockerfile` base image to `cloudflare/sandbox:0.11.0` and updates the replacement note to match. | #5 | v2 |
| Wires the agent from `env` in `cloudflare:workers` and `{ id }: AgentProps` with `cloudflareSandbox(getSandbox(...))`. Removes the `../cloudflare-sandbox` import and its stand-in paragraph. | #6 | v2 |
| Replaces the two Flue deploy-guide URLs with `amond docs read ecosystem/deploy/cloudflare`. | Import (#35) | Initial import |
| Version bump: `version`, Upgrade Guide entry. | #5, #6 | v2 |

## `sandbox--daytona.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Uses `client.create()` in the usage example in the file's doc comment, as the other example does. | #16 | Text only, no version change |

Finding #15 is declined: `exists()` in this file is unchanged from Flue, because the sandbox
contract says `exists` never throws.

## `sandbox--exedev.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Runs the env prefix and command in a brace group after `cd`, with the braces on their own lines. | #1 | v2 |
| Throws from the recursive `mkdir` when the command exits non-zero. | #2 | v2 |
| Types the `close` listener as `(code: number \| null \| undefined, signal?: string)`, removes `?? 0`, and rejects when there is no numeric exit status. | #3 | v2 |
| Checks `EXE_API_TOKEN` and `EXE_VM_HOST` before use in the doc comment and the three wiring snippets. | #4 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #1-#4 | v2 |

## `sandbox--islo.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Throws unless each env key matches `^[A-Za-z_][A-Za-z0-9_]*$`. | #19 | v2 |
| Writes files in base64 chunks of 64 KiB through a temporary file, decoded once, and removes the temporary file in a `finally`. Adds the `randomUUID` import and the `WRITE_CHUNK_CHARS` constant. | #20 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #19, #20 | v2 |

## `sandbox--mirage.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Installs `@struktoai/mirage-core` at `0.0.6` beside the runtime package, and adds a note that explains why. | #8 | v2 |
| Installs `@struktoai/mirage-node@^0.0.6` or `@struktoai/mirage-browser@^0.0.6` instead of `^0.0.2`. | N2 | v2 |
| Strips trailing slashes in `readdir` before taking the basename. | #9 | v2 |
| Runs `rm [-r] [-f] --` through the shell when `recursive` or `force` is set, and throws on a non-zero exit. Removes the unused `SandboxOperationUnsupportedError` import and updates the class doc comment. | #10 | v2 |
| In a plain `rm`, unlinks a symlink (detected with `readlink`; only its `EINVAL` and `ENOENT` mean "not a link", and other `readlink` errors are rethrown), and otherwise calls `stat` and then `rmdir` or `unlink` by type. | #11 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #8-#11, N2 | v2 |

## `sandbox--modal.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Replaces the comment that promised a GNU-then-BusyBox fallback with one line, and rewords the BusyBox note near the top. | #21 | v2 |
| Removes `2>/dev/null` from the `stat` command. | #22 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #21, #22 | v2 |

## `sandbox.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Says the directive prologue (the string statements before any import or other statement) must contain `'use agent';`. | #23 | Text only, no version change |
| Replaces the Flue spec URL and the Daytona example URL with `amond docs read reference/sandbox-api` and `amond add sandbox daytona --print`. | Import (#35) | Initial import |

## `tooling--braintrust.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Names `submissionId` instead of `dispatchId` as the optional correlation field, because amond has no `dispatchId`. | Import (#35) | Initial import |

## `tooling--vitest-evals.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Pins `vitest-evals@^0.13.1` and notes that 0.14 and later drop `SimpleToolCallRecord`. | N1 | v2 |
| Adds the local `ReplyUsage` and `ReplyModel` types, casts the reply metadata to them, and makes `cost` optional. | #12 | v2 |
| Changes the default `agentUrl` port from `3583` to `5173`. | #13 | v2 |
| Asserts `usage.totalTokens` only when the agent attaches usage, and rewords the preserve note and the Verify step to match. | #14 | v2 |
| Version bump: `version`, markers, Upgrade Guide entry. | #12-#14, N1 | v2 |

## `tooling.md`

| Change | Finding | Shipped in |
| --- | --- | --- |
| Removes `dispatchId` from the list of event correlation fields, because amond has no `dispatchId`. | Import (#35) | Initial import |

## Files with no change beyond the rename

`sandbox--e2b.md` and `sandbox--vercel.md` differ from Flue only by the rename.

## Flue files not imported

Flue also ships `channel--*.md` for 17 providers, `database--*.md` for 8 backends, and
`tooling--sentry.md`. amond does not import them (Import, #35), so a sync must not add them back.
amond's `blueprints/README.md` replaces Flue's `README.md`.
