import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadDocsPages, normalizeDocsPath } from './docs-pages.ts'

/**
 * Content guards for the markdown trees the CLI bundles. Each check takes a
 * directory so the blueprints tree can reuse them.
 */

const DOCS_ROOT = fileURLToPath(new URL('../../docs', import.meta.url))

const BRAND_PATTERNS = [/@flue\//i, /\bflue\b/i, /flue\.config/i, /FLUE_/i, /flueframework/i]

// The only lines allowed to name the upstream project: one that credits Flue
// and links its repository. Keep this narrow so the brand check still bites.
const ATTRIBUTION_LINE = /Flue.*https:\/\/github\.com\/withastro\/flue(?![\w-])/

interface SourceLine {
  file: string
  number: number
  text: string
  inFence: boolean
}

function listFiles(root: string): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath, entry.name))
    .sort()
}

function readLines(root: string): SourceLine[] {
  const lines: SourceLine[] = []
  for (const filePath of listFiles(root)) {
    const file = path.relative(root, filePath).split(path.sep).join('/')
    let fence: string | undefined
    fs.readFileSync(filePath, 'utf8').split('\n').forEach((text, index) => {
      const marker = text.match(/^\s*(`{3,}|~{3,})/)?.[1]
      const startsOrEndsFence = marker !== undefined && (fence === undefined || (marker.startsWith(fence[0]!) && marker.length >= fence.length))
      if (startsOrEndsFence) { fence = fence === undefined ? marker : undefined }
      lines.push({ file, number: index + 1, text, inFence: fence !== undefined || startsOrEndsFence })
    })
  }
  return lines
}

function describeLine(line: SourceLine, detail: string): string {
  return `${line.file}:${line.number} ${detail}`
}

export function findBrandViolations(root: string): string[] {
  return readLines(root)
    .filter(line => !ATTRIBUTION_LINE.test(line.text))
    .filter(line => BRAND_PATTERNS.some(pattern => pattern.test(line.text)))
    .map(line => describeLine(line, line.text.trim()))
}

export function findMdxViolations(root: string): string[] {
  const violations = listFiles(root)
    .filter(filePath => filePath.endsWith('.mdx'))
    .map(filePath => `${path.relative(root, filePath)} is an .mdx file`)
  for (const line of readLines(root)) {
    if (line.inFence) { continue }
    if (/^(?:import|export)\s.+\sfrom\s+['"]/.test(line.text) || /^import\s+['"]/.test(line.text)) {
      violations.push(describeLine(line, `MDX import: ${line.text.trim()}`))
    }
    if (/<[A-Z][A-Za-z0-9]*[\s/>]/.test(line.text.replace(/`[^`]*`/g, ''))) {
      violations.push(describeLine(line, `JSX component tag: ${line.text.trim()}`))
    }
  }
  return violations
}

/**
 * Resolve internal page links the way `amond docs read` does: absolute
 * `/docs/<path>/` links go through `normalizeDocsPath`; relative links are
 * resolved against the linking page first, with or without an extension.
 */
export function findBrokenLinks(root: string): string[] {
  const pagePaths = new Set(loadDocsPages(root).map(page => page.path))
  const broken: string[] = []
  for (const line of readLines(root)) {
    if (line.inFence) { continue }
    // Inline code such as `handlers[0](ctx)` looks like a link but is not one.
    for (const match of line.text.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]!.split('#')[0]!
      if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) { continue }
      let resolved: string | undefined
      if (target.startsWith('/docs')) {
        resolved = normalizeDocsPath(target)
      }
      else if (target.startsWith('.')) {
        resolved = normalizeDocsPath(path.posix.join(path.posix.dirname(line.file), target))
      }
      else if (target.startsWith('/')) {
        broken.push(describeLine(line, `absolute link outside /docs/: ${target}`))
        continue
      }
      else {
        resolved = normalizeDocsPath(path.posix.join(path.posix.dirname(line.file), target))
      }
      if (resolved !== undefined && !pagePaths.has(resolved)) {
        broken.push(describeLine(line, `link does not resolve: ${target}`))
      }
    }
  }
  return broken
}

describe('bundled documentation pages', () => {
  it('ships the expected set of pages', () => {
    const pages = loadDocsPages(DOCS_ROOT)
    expect(pages).toHaveLength(67)
    expect(pages.map(page => page.path)).toContain('guide/tools')
    for (const page of pages) {
      expect(page.title, `${page.path} title`).not.toBe('')
      expect(page.description, `${page.path} description`).not.toBe('')
    }
  })

  it('lists only markdown page files', () => {
    expect(listFiles(DOCS_ROOT).filter(file => !file.endsWith('.md'))).toEqual([])
  })

  it('carries no upstream brand outside attribution lines', () => {
    expect(findBrandViolations(DOCS_ROOT)).toEqual([])
  })

  it('is plain Markdown with no MDX syntax', () => {
    expect(findMdxViolations(DOCS_ROOT)).toEqual([])
  })

  it('links only to pages that exist', () => {
    expect(findBrokenLinks(DOCS_ROOT)).toEqual([])
  })
})

describe('content guards', () => {
  function withTree(files: Record<string, string>, run: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'docs-content-'))
    try {
      for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
        fs.writeFileSync(path.join(root, name), content)
      }
      run(root)
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }

  const page = (body: string) => `---\ntitle: T\ndescription: D\n---\n\n${body}\n`

  it('flags a reintroduced upstream package name but allows an attribution line', () => {
    withTree({
      'a.md': page('Install `@flue/runtime`.'),
      'b.md': page('Derived from Flue (https://github.com/withastro/flue).'),
      'c.md': page('Visit https://flueframework.com for Flue.'),
    }, (root) => {
      expect(findBrandViolations(root).map(v => v.split(' ')[0])).toEqual(['a.md:6', 'c.md:6'])
    })
  })

  it('flags MDX imports and components outside code fences only', () => {
    withTree({
      'a.mdx': page('text'),
      'b.md': page('import Foo from \'./foo\'\n\n<CopyPrompt text="x" />'),
      'c.md': page('```ts\nimport { a } from \'b\'\n```\n\n`<Tag />` inline'),
    }, (root) => {
      const violations = findMdxViolations(root)
      expect(violations).toHaveLength(3)
      expect(violations.some(v => v.startsWith('a.mdx'))).toBe(true)
      expect(violations.some(v => v.startsWith('c.md'))).toBe(false)
    })
  })

  it('flags links that do not resolve to a page', () => {
    withTree({
      'guide/a.md': page('[ok](/docs/guide/b/#x) [bad](/docs/guide/missing/) [rel](./b.md) [bare](b) [bare-bad](missing) [ext](https://example.com) `handlers[0](ctx)`'),
      'guide/b.md': page('body'),
    }, (root) => {
      expect(findBrokenLinks(root)).toEqual([
        'guide/a.md:6 link does not resolve: /docs/guide/missing/',
        'guide/a.md:6 link does not resolve: missing',
      ])
    })
  })
})
