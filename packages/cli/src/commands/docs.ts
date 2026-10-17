import type { CAC } from 'cac'
import MiniSearch from 'minisearch'
import { UsageError } from '../errors.ts'
import { rejectDoubleDashArgs } from '../flags.ts'
import type { CliOptions } from '../flags.ts'
import {
  buildDocsExcerpt,
  docsMarkdownToPlainText,
  extractDocsHeadings,
  loadDocsPages,
  normalizeDocsPath,
  resolveDocsRoot,
  truncateDocsDescription,
} from '../lib/docs-pages.ts'

/**
 * `amond docs` — browse the bundled documentation. cac has no nested
 * subcommands, so `read`/`search` are dispatched from the action.
 */

export function registerDocsCommand(cli: CAC): void {
  cli
    .command(
      'docs [read|search] [...args]',
      'Browse the amond docs: list pages, read one, or search',
    )
    .usage('docs [read <path> | search <query>]')
    .example('  $ amond docs')
    .example('  $ amond docs read guide/sandboxes')
    .example('  $ amond docs search "durable execution"')
    .action(docsAction)
}

function docsAction(action: string | undefined, rest: string[], options: CliOptions): void {
  rejectDoubleDashArgs(options, 'docs')
  const pages = loadPagesOrThrow()

  if (action === undefined) {
    process.stderr.write(
      'amond documentation\n\n' +
      '  amond docs read <path>      Print a documentation page as markdown\n' +
      '  amond docs search <query>   Search the documentation (JSON results)\n\n' +
      `Pages (${pages.length}):\n\n`,
    )
    for (const page of pages) {
      process.stdout.write(`${page.path} -- ${page.title}\n`)
      if (page.description && !page.path.startsWith('ecosystem/')) {
        process.stdout.write(`  ${truncateDocsDescription(page.description)}\n`)
      }
    }
    return
  }

  if (action === 'read') {
    const [value, ...extra] = rest
    if (!value) {
      throw new UsageError('Missing docs page path for `amond docs read <path>`.')
    }
    if (extra.length > 0) {
      throw new UsageError(`Unexpected extra arguments for \`amond docs read\`: ${extra.join(' ')}`)
    }
    readPage(pages, value)
    return
  }

  if (action === 'search') {
    const query = rest.join(' ').trim()
    if (!query) {
      throw new UsageError('Missing search query for `amond docs search <query>`.')
    }
    searchPages(pages, query)
    return
  }

  throw new UsageError(`Unknown \`amond docs\` action: ${action}`, {
    hint: action.includes('/')
      ? `Did you mean \`amond docs read ${action}\`?`
      : 'Run `amond docs --help` for usage.',
  })
}

function loadPagesOrThrow(): ReturnType<typeof loadDocsPages> {
  const root = resolveDocsRoot()
  if (!root) {
    throw new Error(
      'Could not locate the bundled documentation. Your amond installation may be incomplete — try reinstalling it.',
    )
  }
  return loadDocsPages(root)
}

function readPage(pages: ReturnType<typeof loadDocsPages>, value: string): void {
  const target = normalizeDocsPath(value)
  const page = pages.find(candidate => candidate.path === target)
  if (!page) {
    throw new UsageError(`Unknown docs page: ${value}`, {
      hint: 'Run `amond docs` to list available pages, or `amond docs search <query>` to find one.',
    })
  }
  let output = `# ${page.title}\n`
  if (page.description) { output += `\n> ${page.description}\n` }
  output += `\n${page.body.trim()}\n`
  process.stdout.write(output)
}

function searchPages(pages: ReturnType<typeof loadDocsPages>, query: string): void {
  const index = new MiniSearch({
    idField: 'path',
    fields: ['title', 'headings', 'description', 'content'],
    storeFields: ['title', 'description', 'content'],
    searchOptions: {
      boost: { title: 4, headings: 3, description: 2 },
      prefix: true,
      fuzzy: 0.2,
    },
  })
  index.addAll(
    pages.map(page => ({
      path: page.path,
      title: page.title,
      description: page.description,
      headings: extractDocsHeadings(page.body),
      content: docsMarkdownToPlainText(page.body),
    })),
  )

  const results = index
    .search(query)
    .slice(0, 8)
    .map(result => ({
      path: result.id as string,
      title: result.title as string,
      description: (result.description as string) || undefined,
      excerpt: buildDocsExcerpt((result.content as string) ?? '', result.terms),
      score: Math.round(result.score * 100) / 100,
    }))

  process.stdout.write(`${JSON.stringify({ query, results }, null, 2)}\n`)
  process.stderr.write('\nRead a page with: amond docs read <path>\n')
}
