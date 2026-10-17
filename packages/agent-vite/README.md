# @amond-ai/agent-vite

The Vite plugin that makes a Vite project an amond app. It scans for `'use agent'` modules and
powers `vite dev` and `vite build` for Node and Cloudflare targets.

```sh
npm install @amond-ai/agent @amond-ai/agent-vite vite
```

Requires Vite 8.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { amond } from '@amond-ai/agent-vite'

export default defineConfig({ plugins: [amond()] })
```

## Cloudflare

Add `amond()` before the sibling `cloudflare()` plugin from `@cloudflare/vite-plugin`, and pass
`amondWorkerConfig()` as its config. The Cloudflare plugin and `wrangler` are separate installs:

```sh
npm install -D @cloudflare/vite-plugin wrangler
```

```ts
// vite.config.ts
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import { amond, amondWorkerConfig } from '@amond-ai/agent-vite'

export default defineConfig({
  plugins: [amond(), cloudflare({ config: amondWorkerConfig() })],
})
```

## Exports

- `amond` — the plugin.
- `amondWorkerConfig` — builds the Cloudflare Worker config.
- Types for the plugin API, the resolved project info, and the Node server helpers.

Run `amond init --deploy` to scaffold a project with this setup already in place.

## Attribution

Derived from [Flue](https://github.com/withastro/flue), licensed under Apache-2.0.
See `NOTICE`.
