/**
 * Test-only helpers for building an `agent/` tree on disk.
 *
 * The loader's whole job is reading a real directory, so the tests give it one rather than a
 * mocked `fs`: a mock would agree with whatever the loader assumed about `readdir` and prove
 * none of it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const created: string[] = []

/**
 * Write a tree into a fresh temp directory and return its root.
 *
 * `files` is keyed by path relative to that root; `dirs` are directories to create empty,
 * which no file map can express.
 */
export async function writeTree(
  files: Readonly<Record<string, string>>,
  dirs: readonly string[] = [],
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amond-tree-'))
  created.push(root)

  for (const dir of dirs) {
    await mkdir(within(root, dir), { recursive: true })
  }
  for (const [relative, contents] of Object.entries(files)) {
    const at = within(root, relative)
    await mkdir(path.dirname(at), { recursive: true })
    await writeFile(at, contents)
  }

  return root
}

/**
 * Resolve a fixture path against the tree's root, refusing one that does not stay inside it.
 *
 * `cleanupTrees` removes the roots this module made and nothing else, so a fixture written
 * through `..` — or an absolute path, which resolves away from `root` entirely — would outlive
 * the suite and leave whatever it overwrote behind. A test that asks for that has a typo.
 */
function within(root: string, relative: string): string {
  const at = path.resolve(root, relative)
  if (at !== root && !at.startsWith(root + path.sep)) {
    throw new Error(`${relative}: a fixture path has to stay under the tree root`)
  }
  return at
}

/** Remove every tree written so far. Test files register this as their `afterEach`. */
export async function cleanupTrees(): Promise<void> {
  await Promise.all(created.splice(0).map(async root => rm(root, { recursive: true, force: true })))
}

/** The layout ADR-0001 describes, with one file per concern. */
export const COMPLETE_TREE: Readonly<Record<string, string>> = {
  'agent/instructions.md': '# Triage\n\nAnswer what arrives.\n',
  'agent/agent.ts': 'export default { harness: { id: \'test\', runTurn: async () => ({ kind: \'failed\', error: \'x\' }) } }\n',
  'agent/tools/search-issues.ts': 'export default { name: \'search-issues\' }\n',
  'agent/tools/close-issue.ts': 'export default { name: \'close-issue\' }\n',
  'agent/skills/triage/SKILL.md': '# Triage skill\n',
  'agent/schedules/nightly.ts': 'export default { name: \'nightly\', cron: \'0 3 * * *\' }\n',
  'agent/channels/slack.ts': 'export default { name: \'slack\' }\n',
}
