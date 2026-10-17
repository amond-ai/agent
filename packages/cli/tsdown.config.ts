import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    // Bin entry, written to dist/amond.mjs (the build script renames to dist/amond.js).
    'amond': 'src/main.ts',
    // `amond run` execution bootstrap. NOT imported by the bin bundle: it is
    // loaded through the run command's Vite module server so its
    // `@amond-ai/agent` imports resolve inside the user project's
    // single-runtime graph (see src/lib/run-local.ts).
    'run-bootstrap': 'src/lib/run-bootstrap.ts',
  },
  format: ['esm'],
  // No public subpaths remain — the CLI ships only the `amond` binary — so
  // declaration output is unnecessary.
  dts: false,
  clean: true,
  outDir: 'dist',
  deps: {
    neverBundle: [
      'vite',
      '@amond-ai/agent',
      '@amond-ai/agent/internal',
      '@amond-ai/agent/config',
      '@amond-ai/agent/node',
      '@amond-ai/agent-vite',
      '@amond-ai/agent-vite/internal',
    ],
  },
})
