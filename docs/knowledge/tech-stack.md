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
| Coverage | `@vitest/coverage-istanbul` | Istanbul, not V8, because Bun's JavaScriptCore emits no V8 profile. `lcovonly` with repo-root-relative paths for Sonar |
| Shared test config | `vitest.shared.ts` | `sharedCoverage`, and `sharedInlineDeps` (`zod`) for a Bun namespace re-export quirk |

## Code quality

| Item | Choice |
| --- | --- |
| Lint and format | ESLint 10 with `@pleaseai/eslint-config` (`type: 'app'`) |
| Shared overrides | `eslint.rules.ts` |
| Git hooks | husky, lint-staged, commitlint (`@commitlint/config-conventional`) |
| Editor | `.editorconfig` |

## Libraries

| Library | Purpose | Used by |
| --- | --- | --- |
| `@amond-ai/harness-claude-code` 0.1.0 | Claude Code turn execution | `agent-harness-claude-code` |
| `@amond-ai/sandbox` 0.1.0 | Sandbox contract (e2b, Cloudflare, local) | `agent-harness-claude-code` |
| `@cloudflare/workers-types` v5 | Workers type definitions | `agent-durable-cloudflare` (peer) |
| `zod` 4.5 | Tool input schemas. `agent-core` keeps the schema type opaque so it does not pin the caller's zod version | Root catalog only |
| `@amond-ai/harness-transport` 0.1.0 | Not yet determined | Root catalog only |
| `@amond-ai/redact` 0.1.0 | Not yet determined | Root catalog only |

## Deployment targets

| Target | Role | Status |
| --- | --- | --- |
| Cloudflare Workers and Workflows | First production durable adapter | Scaffolding |
| Vercel Workflow | Later adapter, written against the public SDK API, no directive transform | Planned |
| In-memory runtime | Reference implementation, test double, and `amond dev` backend | Implemented |

## Packages

| Package | Depends on | Published |
| --- | --- | --- |
| `amond` (CLI, `bin: amond`) | agent-core, agent-durable | Yes |
| `@amond-ai/agent-core` | agent-durable | Yes |
| `@amond-ai/agent-durable` | none | Yes |
| `@amond-ai/agent-durable-cloudflare` | agent-durable | Yes |
| `@amond-ai/agent-harness-claude-code` | agent-core, harness-claude-code, sandbox | Yes |
| `@amond-ai/agent-harness-codex` | agent-core | No, spike |

## CI and release

| Item | Choice |
| --- | --- |
| CI | GitHub Actions `ci.yml`: lint, build, type check, test. Actions are SHA-pinned |
| Workflow security | `zizmor.yml` |
| Dependency updates | Dependabot |
| Versioning | release-please with the `node-workspace` plugin, driven by Conventional Commits |
| Publishing | npm trusted publishing with provenance |
| Local worktrees | `orca.yaml` and `.worktreeinclude` |
