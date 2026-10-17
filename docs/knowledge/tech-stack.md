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
| Bundler | tsdown 0.23 | `tsdown src/index.ts --dts` emits `dist/index.mjs` and `dist/index.d.mts` |
| Type check | `tsc --noEmit` | Composite project config in the root `tsconfig.json` |
| Tests | Vitest 4.1 | Run under Bun (`bun --bun vitest run`) |
| Coverage | `@vitest/coverage-istanbul` (not wired yet) | Configured in `vitest.shared.ts`: Istanbul, not V8, because Bun's JavaScriptCore emits no V8 profile, and `lcovonly` with repo-root-relative paths for Sonar. The package is only in the root `catalog`, and no package defines `test:coverage` yet |
| Shared test config | `vitest.shared.ts` | `sharedCoverage`, and `sharedInlineDeps` (`zod`) for a Bun namespace re-export quirk |

## Code quality

| Item | Choice |
| --- | --- |
| Lint and format | ESLint 10 with `@pleaseai/eslint-config` (`type: 'app'`) |
| Shared overrides | `eslint.rules.ts` |
| Git hooks | husky, lint-staged, commitlint (`@commitlint/config-conventional`) |
| Editor | `.editorconfig` |

## Libraries

Current dependencies of the packages in `packages/`, and entries in the root `catalog` that no
package uses yet:

| Library | Purpose | Used by |
| --- | --- | --- |
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
| Vite | Flue's build, which turns each `'use agent'` module into a Durable Object class |

## Upstream code

| Path | Points at | Role |
| --- | --- | --- |
| `vendor/flue` | `withastro/flue` at `deee93b` (2.3.0) | Read-only reference. Flue's packages will be imported into `packages/` with `git subtree` and renamed ([ADR-0004](../adr/0004-ship-flue-as-amond-packages.md)), tracked in [#20](https://github.com/amond-ai/agent/issues/20) |
| `vendor/eve` | `vercel/eve` at `0857ff4` | Read-only reference |

Flue builds with pnpm, Biome, and TypeScript 7. Imported packages move onto this repository's bun,
ESLint, tsdown, Vitest, and TypeScript 5.9 toolchain before they pass `check` and `lint`. Upstream
changes are ported by hand, because after the renames an upstream commit no longer applies
directly.

## Deployment targets

| Target | Role | Status |
| --- | --- | --- |
| Cloudflare Workers, Durable Objects, and Sandbox containers | First deployment target. Each agent is a Durable Object; each harness turn runs in a Sandbox container | Planned |
| Node | Development target, kept because Flue keeps it | Planned |
| Other platforms | Out of scope until the Cloudflare path ships | Not planned |

## Packages

Packages in `packages/` today:

| Package | Depends on | Future |
| --- | --- | --- |
| `amond` (CLI, `bin: amond`) | agent-core, agent-durable | Retiring in [#18](https://github.com/amond-ai/agent/issues/18); the name passes to the CLI imported from Flue |
| `@amond-ai/agent-core` | agent-durable | Retiring in #18 |
| `@amond-ai/agent-durable` | none | Retiring in #18 |
| `@amond-ai/agent-durable-cloudflare` | agent-durable | Retiring in #18 |
| `@amond-ai/agent-harness-claude-code` | agent-core, harness-claude-code, sandbox | Reassessed once the agent-loop seam exists |
| `@amond-ai/agent-harness-codex` | agent-core | Unpublished spike; reassessed with the seam |

Packages imported from Flue in [#20](https://github.com/amond-ai/agent/issues/20):

| Flue package | Published as |
| --- | --- |
| `@flue/runtime` | `@amond-ai/agent` |
| `@flue/vite` | `@amond-ai/agent-vite` |
| `@flue/cli` | `amond` |
| `@flue/sdk` | `@amond-ai/agent-sdk` |
| `@flue/react` | `@amond-ai/agent-react` |

## CI and release

| Item | Choice |
| --- | --- |
| CI | GitHub Actions `ci.yml`: lint, build, type check, test. Actions are SHA-pinned |
| Workflow security | `zizmor.yml` |
| Dependency updates | Dependabot for GitHub Actions only. npm `catalog` versions are bumped by hand in `package.json`. `.github/dependabot.yml` records why |
| Versioning | release-please with the `node-workspace` plugin, driven by Conventional Commits |
| Publishing | npm trusted publishing with provenance |
| Local worktrees | `orca.yaml` and `.worktreeinclude` |
