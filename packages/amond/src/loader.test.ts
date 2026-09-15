import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentTreeError, loadAgentTree } from './loader'
import { cleanupTrees, COMPLETE_TREE, writeTree } from './tree-fixture'

afterEach(cleanupTrees)

/** Load `agent/` under a freshly written tree, for the many tests that only need that. */
async function load(files: Readonly<Record<string, string>>, dirs: readonly string[] = []) {
  const root = await writeTree(files, dirs)
  return { root, tree: await loadAgentTree(path.join(root, 'agent')) }
}

/** The error a tree is expected to be rejected with, so a passing test names the right path. */
async function rejection(files: Readonly<Record<string, string>>, dirs: readonly string[] = []) {
  const root = await writeTree(files, dirs)
  try {
    await loadAgentTree(path.join(root, 'agent'))
  }
  catch (cause) {
    return { root, error: cause as AgentTreeError }
  }
  throw new Error('expected the tree to be rejected')
}

describe('resolving an agent tree', () => {
  it('resolves every part of the layout the convention defines', async () => {
    const { root, tree } = await load(COMPLETE_TREE)
    const agent = path.join(root, 'agent')

    expect(tree.instructions).toBe('# Triage\n\nAnswer what arrives.\n')
    expect(tree.config).toBe(path.join(agent, 'agent.ts'))
    expect(tree.tools).toEqual([
      path.join(agent, 'tools/close-issue.ts'),
      path.join(agent, 'tools/search-issues.ts'),
    ])
    expect(tree.schedules).toEqual([path.join(agent, 'schedules/nightly.ts')])
    expect(tree.channels).toEqual([path.join(agent, 'channels/slack.ts')])
    expect(tree.skills).toEqual([{ name: 'triage', instructions: '# Triage skill\n' }])
  })

  it('sorts the entry points by name, so the same tree always emits the same manifest', async () => {
    const { tree } = await load({
      ...COMPLETE_TREE,
      'agent/tools/assign.ts': 'export default {}\n',
    })

    expect(tree.tools.map(file => path.basename(file)))
      .toEqual(['assign.ts', 'close-issue.ts', 'search-issues.ts'])
  })

  it('accepts a tree that only has instructions and a harness', async () => {
    const { tree } = await load({
      'agent/instructions.md': 'Answer.\n',
      'agent/agent.ts': 'export default {}\n',
    })

    expect(tree.tools).toEqual([])
    expect(tree.schedules).toEqual([])
    expect(tree.channels).toEqual([])
    expect(tree.skills).toEqual([])
  })

  it('reports agent.ts as absent rather than failing, since the layout makes it optional', async () => {
    const { tree } = await load({ 'agent/instructions.md': 'Answer.\n' })

    expect(tree.config).toBeUndefined()
  })

  it('ignores the dotfiles a filesystem leaves behind', async () => {
    const { tree } = await load({
      ...COMPLETE_TREE,
      'agent/tools/.DS_Store': 'not a tool',
      'agent/skills/.DS_Store': 'not a skill',
    })

    expect(tree.tools.map(file => path.basename(file)))
      .toEqual(['close-issue.ts', 'search-issues.ts'])
    expect(tree.skills.map(skill => skill.name)).toEqual(['triage'])
  })

  it('accepts a renamed default export, which is the same export by another spelling', async () => {
    const { tree } = await load({
      ...COMPLETE_TREE,
      'agent/tools/search-issues.ts': 'const search = {}\nexport { search as default }\n',
    })

    expect(tree.tools).toHaveLength(2)
  })
})

describe('rejecting a tree', () => {
  it('names the directory when there is no tree there at all', async () => {
    const { root, error } = await rejection({ 'README.md': 'no agent here\n' })

    expect(error).toBeInstanceOf(AgentTreeError)
    expect(error.path).toBe(path.join(root, 'agent'))
    expect(error.message).toContain('expected a directory')
  })

  it('names instructions.md when the tree is empty', async () => {
    const { root, error } = await rejection({}, ['agent'])

    expect(error.path).toBe(path.join(root, 'agent/instructions.md'))
    expect(error.message).toContain('missing')
  })

  it('rejects instructions that exist but say nothing', async () => {
    const { root, error } = await rejection({ 'agent/instructions.md': '   \n' })

    expect(error.path).toBe(path.join(root, 'agent/instructions.md'))
    expect(error.message).toContain('empty')
  })

  it('names the file at fault when a tool is not a module', async () => {
    const { root, error } = await rejection({ ...COMPLETE_TREE, 'agent/tools/notes.md': '# notes\n' })

    expect(error.path).toBe(path.join(root, 'agent/tools/notes.md'))
    expect(error.message).toContain('expected a .ts file')
  })

  it('names the directory at fault when a tool is a directory', async () => {
    const { root, error } = await rejection({
      ...COMPLETE_TREE,
      'agent/tools/search/index.ts': 'export default {}\n',
    })

    expect(error.path).toBe(path.join(root, 'agent/tools/search'))
    expect(error.message).toContain('one module per file')
  })

  it('names the tool whose default export is missing', async () => {
    const { root, error } = await rejection({
      ...COMPLETE_TREE,
      'agent/tools/search-issues.ts': 'export const search = {}\n',
    })

    expect(error.path).toBe(path.join(root, 'agent/tools/search-issues.ts'))
    expect(error.message).toContain('no default export')
  })

  it('checks schedules and channels for the same default export', async () => {
    const { root, error } = await rejection({
      ...COMPLETE_TREE,
      'agent/channels/slack.ts': 'export function accept() {}\n',
    })

    expect(error.path).toBe(path.join(root, 'agent/channels/slack.ts'))
    expect(error.message).toContain('no default export')
  })

  it('names the SKILL.md a skill directory is missing', async () => {
    const { root, error } = await rejection({
      ...COMPLETE_TREE,
      'agent/skills/triage/notes.md': '# notes\n',
      'agent/skills/escalate/notes.md': '# notes\n',
    })

    expect(error.path).toBe(path.join(root, 'agent/skills/escalate/SKILL.md'))
    expect(error.message).toContain('missing')
  })

  it('rejects a skill written as a loose file rather than a directory', async () => {
    const { root, error } = await rejection({ ...COMPLETE_TREE, 'agent/skills/triage.md': '# triage\n' })

    expect(error.path).toBe(path.join(root, 'agent/skills/triage.md'))
    expect(error.message).toContain('expected a directory')
  })
})
