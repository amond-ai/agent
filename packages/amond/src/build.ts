/**
 * `amond build`: resolve the tree, emit the manifest and the entry points, write them out.
 *
 * This is the seam ADR-0001 describes — the filesystem is the authoring surface, and what this
 * writes is the deployed one. It is also the only place in the CLI that writes to disk.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { BUILD_TARGETS, emitEntryPoint, emitManifestModule, MANIFEST_MODULE } from './emit'
import { AgentTreeError, loadAgentTree } from './loader'

/** The tree a build reads, relative to the directory the build runs in. */
export const AGENT_DIRECTORY = 'agent'

/** Where a build writes. Generated, so it belongs in `.gitignore` rather than in review. */
export const OUTPUT_DIRECTORY = '.amond'

/**
 * Where a build assembles its output before it replaces {@link OUTPUT_DIRECTORY}.
 *
 * A sibling of the real output directory on purpose: it is on the same filesystem, so the move
 * into place is a rename, and it sits at the same depth, so the relative specifiers the manifest
 * carries are the ones it will need once it lands.
 */
const STAGING_DIRECTORY = '.amond.tmp'

/**
 * Where a build parks the output it is replacing, until the new one is in place.
 *
 * Renaming the old build aside rather than removing it is what keeps the swap recoverable: the
 * only moment {@link OUTPUT_DIRECTORY} does not exist is between two renames, and a second one
 * that fails is undone. Removing it first would trade a half-written build for no build at all.
 */
const PREVIOUS_DIRECTORY = '.amond.old'

/**
 * Run a build against `cwd`, returning the process exit code.
 *
 * A rejected tree exits 1 with the path at fault on stderr; anything else — a permission
 * error, a full disk — propagates, because the CLI has nothing useful to add to it.
 */
export async function build(cwd: string): Promise<number> {
  const outDir = path.join(cwd, OUTPUT_DIRECTORY)
  const staging = path.join(cwd, STAGING_DIRECTORY)
  const previous = path.join(cwd, PREVIOUS_DIRECTORY)

  try {
    const tree = await loadAgentTree(path.join(cwd, AGENT_DIRECTORY))
    // Emitted before anything is written, so a tree the emitter rejects leaves no half-built
    // output behind for the next command to pick up.
    const manifest = emitManifestModule(tree, outDir)

    // Written to the side and moved in one step, so a write that fails partway — a full disk,
    // a permission error on the second target — leaves the previous build intact instead of an
    // output directory holding a manifest and no entry points.
    try {
      await writeStaged(staging, manifest)
      await swapIntoPlace(staging, outDir, previous)
    }
    finally {
      // On the way out either way: the staging directory is gone once the swap moved it, and
      // the previous build has served its purpose once the new one is in place.
      await rm(staging, { recursive: true, force: true })
      await rm(previous, { recursive: true, force: true })
    }

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

/**
 * Move the staged build into place, keeping the one it replaces until the move has succeeded.
 *
 * See {@link PREVIOUS_DIRECTORY} for why the old build is renamed aside rather than removed.
 */
async function swapIntoPlace(staging: string, outDir: string, previous: string): Promise<void> {
  await rm(previous, { recursive: true, force: true })
  const replaced = await renameIfPresent(outDir, previous)

  try {
    await rename(staging, outDir)
  }
  catch (cause) {
    if (replaced) {
      await rename(previous, outDir)
    }
    throw cause
  }
}

/** Rename `from` to `to`, reporting whether there was anything there to rename. */
async function renameIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to)
    return true
  }
  catch (cause) {
    if ((cause as { code?: string } | null)?.code === 'ENOENT') {
      return false
    }
    throw cause
  }
}

/** Populate a fresh staging directory, replacing whatever a previous failed build left there. */
async function writeStaged(staging: string, manifest: string): Promise<void> {
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  await writeFile(path.join(staging, MANIFEST_MODULE), manifest)
  // One at a time rather than concurrently: `Promise.all` rejects on the first failure while the
  // others are still in flight, and the cleanup that follows would then race a write it did not
  // wait for. There are two entry points, both a few lines long.
  for (const target of BUILD_TARGETS) {
    await writeFile(path.join(staging, `${target}.ts`), emitEntryPoint(target))
  }
}
