import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadDocsPages } from '../lib/docs-pages.ts'

const BIN = fileURLToPath(new URL('../../bin/amond.mjs', import.meta.url))
const DOCS_ROOT = fileURLToPath(new URL('../../docs', import.meta.url))
const INIT_SOURCE = fileURLToPath(new URL('../lib/init.ts', import.meta.url))

// Docs are read from the installed package: nothing here may reach the network.
function runAmond(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AMOND_REGISTRY_URL: 'http://127.0.0.1:9' },
    timeout: 20_000,
  })
}

// Every `amond docs read <path>` pointer the scaffolds write, taken from the source so a new
// pointer is covered without editing this test.
function scaffoldPointers(): string[] {
  const source = fs.readFileSync(INIT_SOURCE, 'utf8')
  const paths = [...source.matchAll(/amond docs read ([a-z][\w/-]*)/g)].map(match => match[1]!)
  return [...new Set(paths)]
}

describe('amond docs', () => {
  const pages = loadDocsPages(DOCS_ROOT)

  it('lists every bundled page', () => {
    const result = runAmond(['docs'])
    expect(result.status).toBe(0)
    const listed = result.stdout.split('\n').filter(line => / -- /.test(line)).map(line => line.split(' -- ')[0])
    expect(listed).toEqual(pages.map(page => page.path))
  })

  it('reads a page and exits 0', () => {
    const result = runAmond(['docs', 'read', 'guide/tools'])
    expect(result.status).toBe(0)
    const page = pages.find(candidate => candidate.path === 'guide/tools')!
    expect(result.stdout.startsWith(`# ${page.title}\n`)).toBe(true)
    expect(result.stdout).toContain(page.body.trim())
  })

  it('searches the pages', () => {
    const result = runAmond(['docs', 'search', 'sandbox'])
    expect(result.status).toBe(0)
    const { results } = JSON.parse(result.stdout) as { results: { path: string }[] }
    expect(results.length).toBeGreaterThan(0)
    expect(results.map(entry => entry.path)).toContain('guide/sandboxes')
  })

  it('finds at least one scaffold pointer', () => {
    expect(scaffoldPointers().length).toBeGreaterThan(0)
  })

  it.each(scaffoldPointers())('resolves the scaffold pointer %s', (pointer) => {
    const result = runAmond(['docs', 'read', pointer])
    expect(result.status).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it.each([
    '/docs/guide/tools/',
    'docs/guide/tools',
    'guide/tools/',
    'guide/tools.md',
    '/docs/guide/tools/#protect-access',
    'https://example.com/docs/guide/tools/',
  ])('resolves the link-style path %s', (input) => {
    const result = runAmond(['docs', 'read', input])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('# Tools')
  })

  it('reads a page whose own path contains docs', () => {
    const result = runAmond(['docs', 'read', 'https://example.com/docs/cli/docs/'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('amond docs')
  })

  it('fails on an unknown page with a hint', () => {
    const result = runAmond(['docs', 'read', 'guide/nope'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unknown docs page: guide/nope')
    expect(result.stderr).toContain('amond docs')
  })
})
