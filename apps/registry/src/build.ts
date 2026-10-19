import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildBlueprintIndex,
  stripBlueprintFrontmatter,
} from '../../../packages/cli/src/lib/blueprint-index.ts'

export interface BuildResult {
  /** The files written to `outDir`, sorted. */
  files: string[]
}

/**
 * Writes `<slug>.md` into `outDir` for every blueprint and kind root found in `blueprintsDir`,
 * with the JSON frontmatter removed. The slugs come from the same function that builds the CLI's
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
    await writeFile(join(outDir, target), stripBlueprintFrontmatter(source, file), 'utf-8')
    files.push(target)
  }
  return { files: files.sort() }
}
