#!/usr/bin/env bun
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildRegistry } from '../src/build.ts'

const blueprintsDir = fileURLToPath(new URL('../../../blueprints', import.meta.url))
const outDir = fileURLToPath(new URL('../dist', import.meta.url))

try {
  const { files } = await buildRegistry(blueprintsDir, outDir)
  console.error(`[registry] wrote ${files.length} files to ${outDir}`)
}
catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
