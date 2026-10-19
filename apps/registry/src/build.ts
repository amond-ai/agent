import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildBlueprintIndex,
  stripBlueprintFrontmatter,
} from '../../../packages/cli/src/lib/blueprint-index.ts'

export interface BuildResult {
  /** The files written to `outDir`, sorted. */
  files: string[]
}

/** Served at the site root, so the footer of every blueprint can point to them. */
export const LICENSE_FILE = 'LICENSE.txt'
export const NOTICE_FILE = 'NOTICE.txt'

const licenseSource = fileURLToPath(new URL('../../../LICENSE', import.meta.url))
const noticeSource = fileURLToPath(new URL('../NOTICE', import.meta.url))

/**
 * Apache-2.0 §4(a) and §4(b): each served copy of a derived blueprint names its license and says
 * it was modified. As an HTML comment it doesn't render in Markdown; `amond add` passes it to a
 * coding agent as raw text, after the steps. It names the license and notice by file name, not
 * URL, so it holds for any registry, not only the default.
 */
export function attributionFooter(file: string): string {
  return [
    '<!--',
    `Derived from Flue's blueprint \`${file}\` (https://github.com/withastro/flue, commit deee93b),`,
    'licensed under the Apache License, Version 2.0, and modified by amond: renamed to amond and',
    'edited to remove references to packages amond does not ship.',
    `The license and notice are ${LICENSE_FILE} and ${NOTICE_FILE} at the root of the registry`,
    'this file was fetched from.',
    '-->',
    '',
  ].join('\n')
}

/**
 * Writes `<slug>.md` into `outDir` for every blueprint and kind root found in `blueprintsDir`,
 * with the JSON frontmatter removed and an attribution footer appended, plus the license and
 * notice that footer points to. The slugs come from the same function that builds the CLI's
 * bundled index, so a name the CLI lists is a file the site serves. An alias gets no file: the
 * CLI resolves it to the slug before it fetches. `outDir` is emptied first, so a removed
 * blueprint disappears from the site.
 */
export async function buildRegistry(blueprintsDir: string, outDir: string): Promise<BuildResult> {
  const names = (await readdir(blueprintsDir))
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .sort()
  const sources = await Promise.all(
    names.map(async file => ({ file, source: await readFile(join(blueprintsDir, file), 'utf-8') })),
  )
  // Validates every file and rejects name collisions before anything is written.
  const { blueprints, kindRoots } = buildBlueprintIndex(sources)
  const slugByFile = new Map<string, string>([
    ...blueprints.map(blueprint => [blueprint.file, blueprint.slug] as const),
    ...kindRoots.map(root => [root.file, root.kind] as const),
  ])

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const files: string[] = []
  for (const { file, source } of sources) {
    const slug = slugByFile.get(file)
    if (!slug) {
      throw new Error(`[registry] ${file}: no slug was derived.`)
    }
    const target = `${slug}.md`
    const body = stripBlueprintFrontmatter(source, file).trimEnd()
    await writeFile(join(outDir, target), `${body}\n\n${attributionFooter(file)}`, 'utf-8')
    files.push(target)
  }
  await copyFile(licenseSource, join(outDir, LICENSE_FILE))
  await copyFile(noticeSource, join(outDir, NOTICE_FILE))
  files.push(LICENSE_FILE, NOTICE_FILE)
  return { files: files.sort() }
}
