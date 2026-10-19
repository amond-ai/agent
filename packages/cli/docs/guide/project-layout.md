---
title: Project Layout
description: Understand the source files and generated output in an amond project.
lastReviewedAt: 2026-07-21
---

amond has few required conventions for file and folder layout. The examples below show the recommended structure for single- and multi-agent projects.

## Example agent codebase

```yaml
my-project/
├─ src/                  # Source directory
│  ├─ app.ts             # Server and router entrypoint (required)
│  ├─ db.ts              # Database configuration (optional)
│  ├─ cloudflare.ts      # Cloudflare-specific entrypoint (optional)
│  ├─ agent.ts
│  ├─ skills/...
│  ├─ tools/...
│  ├─ subagents/...
│  └─ channels/...
├─ package.json          # npm project configuration
├─ vite.config.ts        # Vite configuration (optional)
└─ amond.config.ts        # amond project configuration (optional)
```

## Example multi-agent codebase

```yaml
my-project/
├─ src/                  # Source directory
│  ├─ app.ts             # Server and router entrypoint (required)
│  ├─ db.ts              # Database configuration (optional)
│  ├─ cloudflare.ts      # Cloudflare-specific entrypoint (optional)
│  └─ agents/
│     ├─ support-agent/
│     │  ├─ skills/...
│     │  ├─ tools/...
│     │  ├─ subagents/...
│     │  ├─ channels/...
│     │  └─ agent.ts
│     ├─ triage-agent/
│     └─ shared/
├─ package.json          # npm project configuration
├─ vite.config.ts        # Vite configuration (optional)
└─ amond.config.ts        # amond project configuration (optional)
```

## Top-level files

| Path                                                                                    | Purpose                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`amond.config.ts`](/docs/reference/configuration/)                                      | amond project configuration. Optional.                  |
| [`vite.config.ts`](/docs/guide/deploy/)                                                 | Vite build & dev server configuration. Optional.       |
| [`src/app.ts`](/docs/guide/routing/)                                                    | Application route map and server entrypoint. Required. |
| [`src/db.ts`](/docs/guide/database/)                                                    | Database configuration. Optional.                      |
| [`src/cloudflare.ts`](/docs/guide/cloudflare-target/#extending-cloudflarets-entrypoint) | Cloudflare entrypoint configuration. Optional.         |

## Source directory

`src/` is the canonical source directory for new amond projects. When integrating amond into another application or maintaining an existing layout, authored modules may instead live in `.amond/` or at the project root. amond selects one source directory in this order:

1. `.amond/` — A self-contained amond source area inside a larger application.
2. `src/` **(Recommended)** — The recommended layout for new projects.
3. The project root — A compact layout for small dedicated projects.

The first matching directory wins. amond does not merge layouts: when `.amond/` exists, `app.ts`, `db.ts`, `cloudflare.ts`, and the `'use agent'` scan are resolved from it, not from `src/` or the project root. Authored modules may still import ordinary supporting code from elsewhere in the project.

Entry module paths (`app.ts`, `db.ts`, `cloudflare.ts`) can be configured explicitly in your `amond.config.ts` file. See [Configuration](/docs/reference/configuration/) for more details.

## Generated output

`dist/` is the default build output directory when you run `vite build`. You can customize this in your `vite.config.ts` file.
