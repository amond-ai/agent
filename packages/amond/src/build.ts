/**
 * `amond build`: resolve the tree, emit the manifest and the entry points, write them out.
 *
 * This is the seam ADR-0001 describes — the filesystem is the authoring surface, and what this
 * writes is the deployed one. It is also the only place in the CLI that writes to disk.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { BUILD_TARGETS, emitEntryPoint, emitManifestModule, MANIFEST_MODULE } from './emit'
import { AgentTreeError, loadAgentTree } from './loader'

/** The tree a build reads, relative to the directory the build runs in. */
export const AGENT_DIRECTORY = 'agent'

/** Where a build writes. Generated, so it belongs in `.gitignore` rather than in review. */
export const OUTPUT_DIRECTORY = '.amond'

/**
 * Run a build against `cwd`, returning the process exit code.
 *
 * A rejected tree exits 1 with the path at fault on stderr; anything else — a permission
 * error, a full disk — propagates, because the CLI has nothing useful to add to it.
 */
export async function build(cwd: string): Promise<number> {
  const outDir = path.join(cwd, OUTPUT_DIRECTORY)

  try {
    const tree = await loadAgentTree(path.join(cwd, AGENT_DIRECTORY))
    // Emitted before anything is written, so a tree the emitter rejects leaves no half-built
    // output behind for the next command to pick up.
    const manifest = emitManifestModule(tree, outDir)

    await mkdir(outDir, { recursive: true })
    await writeFile(path.join(outDir, MANIFEST_MODULE), manifest)
    await Promise.all(BUILD_TARGETS.map(async target =>
      writeFile(path.join(outDir, `${target}.ts`), emitEntryPoint(target)),
    ))

    process.stdout.write(
      `amond build: wrote ${OUTPUT_DIRECTORY}/ — ${tree.tools.length} tools, `
      + `${tree.skills.length} skills, ${tree.schedules.length} schedules, `
      + `${tree.channels.length} channels\n`,
    )
    return 0
  }
  catch (cause) {
    if (cause instanceof AgentTreeError) {
      process.stderr.write(`amond build: ${cause.message}\n`)
      return 1
    }
    throw cause
  }
}
