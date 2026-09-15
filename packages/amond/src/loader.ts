/**
 * The filesystem loader: `agent/` in, a resolved tree out.
 *
 * It runs here, in the CLI, because this is the machine that has `fs`. A Worker does not, so
 * nothing downstream of this file may read a directory — the tree is resolved once, at build
 * time, and what deploys is a manifest whose imports are static (ADR-0001).
 *
 * The loader resolves paths and reads Markdown. It never imports a tool, a schedule or a
 * channel: importing runs whatever that module does at the top level, and a build should not
 * need the user's environment to tell them a file is in the wrong place.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/** A skill directory, resolved: the directory's name and the text of its `SKILL.md`. */
export interface LoadedSkill {
  readonly name: string
  readonly instructions: string
}

/**
 * The `agent/` tree, resolved. Entry points are absolute paths rather than imported values,
 * because the manifest imports them statically and the loader never evaluates user code.
 */
export interface AgentTree {
  /** Absolute path of the tree's root. */
  readonly root: string
  /** The text of `instructions.md`. */
  readonly instructions: string
  /** Absolute path of `agent.ts`, absent when the tree does not have one. */
  readonly config?: string
  readonly tools: readonly string[]
  readonly schedules: readonly string[]
  readonly channels: readonly string[]
  readonly skills: readonly LoadedSkill[]
}

/**
 * A layout the loader refuses, carrying the file or directory at fault.
 *
 * The path is the point: "no default export" is only actionable with the file it is about, and
 * a build that fails with a parse error from a bundler three steps later is not.
 */
export class AgentTreeError extends Error {
  /** Absolute path of the file or directory the complaint is about. */
  readonly path: string

  constructor(at: string, message: string) {
    super(`${at}: ${message}`)
    this.name = 'AgentTreeError'
    this.path = at
  }
}

/**
 * Matches a module's default export, line-anchored because `export` is only legal at the top
 * level of a module — where formatters leave it at column zero.
 *
 * A deliberately shallow check: it is a guard that names the file at fault before a bundler
 * says something less useful, not a parser. A `export default` inside a block comment reads as
 * present here; the bundler catches that case, with the same file named.
 */
const DEFAULT_EXPORT = /^export\s+default\b|^export\s*\{[^}]*\bas\s+default\b/m

/**
 * Resolve an `agent/` tree, or throw an {@link AgentTreeError} naming what is wrong and where.
 *
 * `tools/`, `schedules/`, `channels/` and `skills/` are each optional — an agent that only
 * answers events has no schedules — but a directory that exists has to hold what its name
 * says it holds.
 */
export async function loadAgentTree(root: string): Promise<AgentTree> {
  const at = path.resolve(root)

  if (!await isDirectory(at)) {
    throw new AgentTreeError(at, 'no agent tree here — expected a directory')
  }

  const config = path.join(at, 'agent.ts')

  // Resolved in layout order rather than concurrently: a tree with two faults should always
  // report the same one first, and the walk is a handful of stats either way.
  return {
    root: at,
    instructions: await readRequiredText(path.join(at, 'instructions.md')),
    config: await isFile(config) ? config : undefined,
    tools: await loadEntryModules(path.join(at, 'tools')),
    schedules: await loadEntryModules(path.join(at, 'schedules')),
    channels: await loadEntryModules(path.join(at, 'channels')),
    skills: await loadSkills(path.join(at, 'skills')),
  }
}

/**
 * Resolve one entry-point directory to the files it holds, sorted by name so two builds of the
 * same tree emit byte-identical manifests — `readdir` promises no order.
 */
async function loadEntryModules(dir: string): Promise<string[]> {
  const names = await listDirectory(dir)
  const files: string[] = []

  for (const name of names) {
    const at = path.join(dir, name)

    if (await isDirectory(at)) {
      throw new AgentTreeError(at, 'expected a file — this directory holds one module per file')
    }
    if (!name.endsWith('.ts')) {
      throw new AgentTreeError(at, 'expected a .ts file')
    }
    if (!DEFAULT_EXPORT.test(await readFile(at, 'utf8'))) {
      throw new AgentTreeError(at, 'no default export — the module is what the manifest imports')
    }

    files.push(at)
  }

  return files
}

/** Resolve `skills/`, where a skill is a directory and its `SKILL.md` is the skill. */
async function loadSkills(dir: string): Promise<LoadedSkill[]> {
  const names = await listDirectory(dir)
  const skills: LoadedSkill[] = []

  for (const name of names) {
    const at = path.join(dir, name)

    if (!await isDirectory(at)) {
      throw new AgentTreeError(at, 'expected a directory — a skill is `<name>/SKILL.md`')
    }

    skills.push({ name, instructions: await readRequiredText(path.join(at, 'SKILL.md')) })
  }

  return skills
}

/**
 * The names in a directory, sorted, with dotfiles dropped and a missing directory read as
 * empty. `.DS_Store` is not a tool, and every one of these directories is optional.
 */
async function listDirectory(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir)
    return names.filter(name => !name.startsWith('.')).sort()
  }
  catch (cause) {
    if (isMissing(cause)) {
      return []
    }
    throw cause
  }
}

/**
 * Read a Markdown file the tree cannot do without, rejecting an empty one: a file that exists
 * but says nothing is the harder failure to diagnose later, when the agent runs with no
 * instructions and behaves as though it were never given any.
 */
async function readRequiredText(at: string): Promise<string> {
  let text: string
  try {
    text = await readFile(at, 'utf8')
  }
  catch (cause) {
    if (isMissing(cause)) {
      throw new AgentTreeError(at, 'missing — the tree needs this file')
    }
    throw cause
  }

  if (text.trim() === '') {
    throw new AgentTreeError(at, 'empty — the tree needs this file to say something')
  }
  return text
}

async function isDirectory(at: string): Promise<boolean> {
  return (await statOrUndefined(at))?.isDirectory() ?? false
}

async function isFile(at: string): Promise<boolean> {
  return (await statOrUndefined(at))?.isFile() ?? false
}

async function statOrUndefined(at: string) {
  try {
    return await stat(at)
  }
  catch (cause) {
    if (isMissing(cause)) {
      return undefined
    }
    throw cause
  }
}

/** True for the "it is not there" errnos, so a real fs failure still surfaces as itself. */
function isMissing(cause: unknown): boolean {
  const code = (cause as { code?: string } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
