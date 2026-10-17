# Tech Stack

The languages, tools, libraries, and platforms this repository uses, and why the less obvious
choices were made. Update this file before a change that adds or replaces any of them.

## Language and runtime

| Item | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript 5.9 | `strict`, ES modules, `moduleResolution: bundler` |
| Package manager | Bun 1.4.2 | Pinned in `.mise.toml` and `packageManager` |
| Node | 24 (dev), `>=22` (published `engines`) | Pinned in `.mise.toml` |
| Tool versions | mise | `mise install` resolves the same toolchain locally and in CI |

## Monorepo

| Item | Choice | Notes |
| --- | --- | --- |
| Workspaces | bun workspaces (`packages/*`) | Shared versions through the root `catalog` and `catalogs` |
| Task runner | Turborepo 2.8 | `build` depends on `^build`. `test` depends on its own `build`. `check` depends on `^build` only |

## Build, type check, and test

| Item | Choice | Notes |
| --- | --- | --- |
| Bundler | tsdown 0.23 | Imported packages carry a `tsdown.config.ts` and emit `dist/*.mjs` and `.d.mts`, except the CLI, which emits no declarations and renames its `amond` entry to `dist/amond.js`. The others run `tsdown src/index.ts --dts` |
| Type check | `tsc --noEmit` | Composite project config in the root `tsconfig.json`. Each imported package keeps Flue's stricter compiler options |
| Agent build | `vite build` | A user's agent project builds through `amond()` from `@amond-ai/agent-vite` |
| Tests | Vitest 4.1 | Run under Bun (`bun --bun vitest run`) |
| Coverage | `@vitest/coverage-istanbul` (not wired yet) | Configured in `vitest.shared.ts`: Istanbul, not V8, because Bun's JavaScriptCore emits no V8 profile, and `lcovonly` with repo-root-relative paths for Sonar. The package is only in the root `catalog`, and no package defines `test:coverage` yet |
| Shared test config | `vitest.shared.ts` | `sharedCoverage`, and `sharedInlineDeps` (`zod`) for a Bun namespace re-export quirk |

## Code quality

| Item | Choice |
| --- | --- |
| Lint and format | ESLint 10 with `@pleaseai/eslint-config` (`type: 'app'`). The imported packages turn some rules off after one reformat commit |
| Shared overrides | `eslint.rules.ts` |
| Git hooks | husky, lint-staged, commitlint (`@commitlint/config-conventional`) |
| Editor | `.editorconfig` |

## Libraries

Main dependencies of the packages in `packages/`, and entries in the root `catalog` that no
package uses yet:

| Library | Purpose | Used by |
| --- | --- | --- |
| Hono, `@hono/node-server` | HTTP routing and the Node server | `agent`, `agent-vite` |
| valibot, `@valibot/to-json-schema` | Schema validation and JSON Schema output | `agent` |
| `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` | Pi agent loop and model client. Removed in [#16](https://github.com/amond-ai/agent/issues/16)–[#18](https://github.com/amond-ai/agent/issues/18) | `agent` |
| `@modelcontextprotocol/client` | MCP tools | `agent` |
| Cloudflare `agents` SDK | Durable Object agent base on Cloudflare | `agent-vite` |
| Vite 8, `@cloudflare/vite-plugin` | The build that turns `'use agent'` modules into a Node server or Worker | `agent-vite` (`vite` peer), `cli` |
| `@durable-streams/client` | Streams conversation state to clients | `agent-sdk` |
| React 18 or later | Hooks runtime | `agent-react` (peer) |
| `@amond-ai/harness-claude-code` 0.1.0 | Claude Code turn execution | `agent-harness-claude-code` |
| `@amond-ai/sandbox` 0.1.0 | Sandbox contract (e2b, Cloudflare, local) | `agent-harness-claude-code` |
| `@cloudflare/workers-types` v5 | Workers type definitions | `agent-durable-cloudflare` (peer) |
| `zod` 4.5 | Schema validation | Root catalog only |
| `@amond-ai/harness-transport` 0.1.0 | Not yet determined | Root catalog only |
| `@amond-ai/redact` 0.1.0 | Not yet determined | Root catalog only |

Planned by [ADR-0003](../adr/0003-build-on-flue-with-ai-sdk-harness.md), not yet dependencies:

| Library | Purpose |
| --- | --- |
| `@ai-sdk/harness` | `HarnessV1`, `HarnessAgent`, and `HarnessV1SandboxProvider`. Experimental; `@amond-ai/harness` pins 1.0.87 |
| `@amond-ai/harness-sandbox` | Adapts a sandbox provider to `HarnessV1SandboxProvider` |
| `@amond-ai/harness-transport-cloudflare` | Reaches harness turns running in Cloudflare Sandbox containers |
| `@amond-ai/sandbox-cloudflare` | Cloudflare sandbox provider, to be added to `amond-ai/harness` |
| Cloudflare Sandbox SDK (`@cloudflare/sandbox`) | The container each harness turn runs in |

## Upstream code

| Path | Points at | Role |
| --- | --- | --- |
| `vendor/flue` | `withastro/flue` at `deee93b` (2.3.0) | Read-only reference, and the source of the five imported packages |
| `vendor/eve` | `vercel/eve` at `0857ff4` | Read-only reference |

Flue's packages entered `packages/` from v2.3.0 with their history ([ADR-0004](../adr/0004-ship-flue-as-amond-packages.md),
[#20](https://github.com/amond-ai/agent/issues/20)) and were renamed in source. Flue builds with
pnpm, Biome, and TypeScript 7. The imported code moved onto this repository's bun, ESLint, tsdown,
Vitest, and TypeScript 5.9 toolchain. Upstream changes are ported by hand, because after the
renames an upstream commit no longer applies directly.

## Deployment targets

| Target | Role | Status |
| --- | --- | --- |
| Cloudflare Workers, Durable Objects, and Sandbox containers | First deployment target. Each agent is a Durable Object; each harness turn runs in a Sandbox container | Planned |
| Node | Development target, kept because Flue keeps it | Planned |
| Other platforms | Out of scope until the Cloudflare path ships | Not planned |

## Packages

Packages in `packages/`, all at version 0.1.0 and versioned by release-please. None is published
yet.

Imported from Flue v2.3.0 in [#20](https://github.com/amond-ai/agent/issues/20):

| Flue package | Package | Depends on |
| --- | --- | --- |
| `@flue/runtime` | `@amond-ai/agent` | none in the workspace |
| `@flue/vite` | `@amond-ai/agent-vite` | agent |
| `@flue/cli` | `amond` (CLI, `bin: amond`) | agent, agent-vite |
| `@flue/sdk` | `@amond-ai/agent-sdk` | none in the workspace |
| `@flue/react` | `@amond-ai/agent-react` | agent-sdk (peer) |

Built to ADR-0001 and ADR-0002. The old ADR-0001 CLI at `amond` is retired and its name belongs to
the imported CLI:

| Package | Depends on | Future |
| --- | --- | --- |
| `@amond-ai/agent-core` | agent-durable | Retiring in [#18](https://github.com/amond-ai/agent/issues/18) |
| `@amond-ai/agent-durable` | none | Retiring in #18 |
| `@amond-ai/agent-durable-cloudflare` | agent-durable | Retiring in #18 |
| `@amond-ai/agent-harness-claude-code` | agent-core, harness-claude-code, sandbox | Reassessed once the agent-loop seam exists |
| `@amond-ai/agent-harness-codex` | agent-core | Unpublished spike; reassessed with the seam |

## CI and release

| Item | Choice |
| --- | --- |
| CI | GitHub Actions `ci.yml`: lint, build, type check, test. Actions are SHA-pinned |
| Workflow security | `zizmor.yml` |
| Dependency updates | Dependabot for GitHub Actions only. npm `catalog` versions are bumped by hand in `package.json`. `.github/dependabot.yml` records why |
| Versioning | release-please with the `node-workspace` plugin, driven by Conventional Commits |
| Publishing | npm trusted publishing with provenance |
| Local worktrees | `orca.yaml` and `.worktreeinclude` |
