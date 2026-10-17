import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    // `@amond-ai/agent-vite/internal` — plumbing shared with `amond` (amond run).
    'internal': 'src/internal.ts',
    'bootstrap/node-server': 'src/bootstrap/node-server.ts',
    'bootstrap/node-entry': 'src/bootstrap/node-entry.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  deps: {
    // The virtual:amond/* specifiers only resolve inside a Vite build/dev
    // graph that runs the amond() plugin, so they must survive the package
    // build verbatim.
    neverBundle: [
      /^virtual:amond\//,
      'vite',
      'tinyglobby',
      'magic-string',
      '@amond-ai/agent',
      '@hono/node-server',
    ],
  },
})
