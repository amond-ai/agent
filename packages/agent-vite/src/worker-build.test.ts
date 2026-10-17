import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { createBuilder } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { amond, amondWorkerConfig } from './index.ts'

const FIXTURE_ROOT = fileURLToPath(new URL('../test-fixtures/worker', import.meta.url))

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}

describe('vite build of a one-agent Cloudflare Worker', () => {
  let outDir: string
  let emitted: Map<string, string>

  beforeAll(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amond-worker-build-'))
    // The plugin pair a user's vite.config.ts lists, inlined so the build runs the sources
    // under test instead of a built dist.
    // `vite build` goes through the builder so every environment (the Worker) is built.
    const builder = await createBuilder({
      root: FIXTURE_ROOT,
      configFile: false,
      logLevel: 'silent',
      plugins: [amond(), cloudflare({ config: amondWorkerConfig() })],
      build: { outDir, emptyOutDir: true },
    })
    await builder.buildApp()
    emitted = new Map(
      listFiles(outDir).map(file => [path.relative(outDir, file), fs.readFileSync(file, 'utf8')]),
    )
  }, 120_000)

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  it('exports the generated Durable Object class from the Worker entry', () => {
    const scripts = [...emitted].filter(([name]) => name.endsWith('.js') || name.endsWith('.mjs'))
    expect(scripts.length).toBeGreaterThan(0)
    const exportsClass = scripts.some(([, code]) =>
      /export\s*\{[^}]*\bAmondIssueTriageAgent\b[^}]*\}/.test(code)
      || /export\s+class\s+AmondIssueTriageAgent\b/.test(code),
    )
    expect(exportsClass).toBe(true)
  })

  it('binds the class as AMOND_ISSUE_TRIAGE_AGENT in the emitted wrangler config', () => {
    const configs = [...emitted].filter(([name]) => path.basename(name) === 'wrangler.json')
    expect(configs).toHaveLength(1)
    const config = JSON.parse(configs[0]![1]) as {
      durable_objects?: { bindings?: Array<{ name: string, class_name: string }> }
    }
    expect(config.durable_objects?.bindings).toContainEqual({
      name: 'AMOND_ISSUE_TRIAGE_AGENT',
      class_name: 'AmondIssueTriageAgent',
    })
  })

  it('leaves no Flue package or virtual module name in any emitted file', () => {
    expect(emitted.size).toBeGreaterThan(0)
    for (const [name, content] of emitted) {
      expect(content, name).not.toContain('@flue/')
      expect(content, name).not.toContain('virtual:flue/')
    }
  })
})
