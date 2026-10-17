# amond

The amond CLI: scaffold an agent, run it locally, and generate the handlers a platform deploys

Part of [amond/agent](https://github.com/amond-ai/agent). See the repository README for how
the packages fit together, and `docs/adr/` for why they are shaped this way.

## `amond build`

```bash
amond build [directory]   # defaults to the current directory
```

Walks `agent/` and writes `.amond/`:

| File | What it is |
| --- | --- |
| `.amond/manifest.ts` | The tree, resolved: a static import per tool, schedule and channel, with `instructions.md` and every `SKILL.md` inlined as string literals. |
| `.amond/cloudflare.ts` | A Worker module entry — `fetch` and `scheduled`. |
| `.amond/vercel.ts` | Route handlers — `POST` for channel events, `GET` for cron. |

Nothing in the output reads a directory, because the target has no `fs`. The filesystem is the
authoring surface and the manifest is the deployed one (ADR-0001).

The build emits **handlers**, not deployment config. `wrangler.jsonc`, `vercel.json` and cron
registration stay yours; point them at the entry point you need.

A malformed tree exits 1 naming the file at fault — `agent/tools/search.ts: no default
export` — and writes nothing, rather than leaving half a build behind.

### Wiring `.amond/` into a project

`.amond/` is generated, so it belongs in `.gitignore`. It also starts with a dot, which
TypeScript's wildcard include skips, so a project that typechecks the generated entry points
names the directory explicitly:

```jsonc
{
  "include": [".amond/**/*.ts", "agent"]
}
```
