import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emitEntryPoint, emitManifestModule } from './emit'
import { AgentTreeError, loadAgentTree } from './loader'
import { cleanupTrees, COMPLETE_TREE, writeTree } from './tree-fixture'

afterEach(cleanupTrees)

/** Load a tree and emit its manifest the way `build` does, into `<root>/.amond`. */
async function emit(files: Readonly<Record<string, string>> = COMPLETE_TREE) {
  const root = await writeTree(files)
  const tree = await loadAgentTree(path.join(root, 'agent'))
  return { root, tree, module: emitManifestModule(tree, path.join(root, '.amond')) }
}

describe('emitting the manifest module', () => {
  it('imports every resolved file statically, relative to where the module is written', async () => {
    const { module: emitted } = await emit()

    expect(emitted).toContain(`import config from "../agent/agent.ts"`)
    expect(emitted).toContain(`import tool0 from "../agent/tools/close-issue.ts"`)
    expect(emitted).toContain(`import tool1 from "../agent/tools/search-issues.ts"`)
    expect(emitted).toContain(`import schedule0 from "../agent/schedules/nightly.ts"`)
    expect(emitted).toContain(`import channel0 from "../agent/channels/slack.ts"`)
    expect(emitted).toContain('tools: [tool0, tool1],')
    expect(emitted).toContain('schedules: [schedule0],')
    expect(emitted).toContain('channels: [channel0],')
    expect(emitted).toContain('harness: agentConfig.harness,')
  })

  it('inlines Markdown instead of reading it, because the target has no filesystem', async () => {
    const { module: emitted } = await emit()

    expect(emitted).toContain(`instructions: "# Triage\\n\\nAnswer what arrives.\\n"`)
    expect(emitted).toContain(`{ name: "triage", instructions: "# Triage skill\\n" }`)
    expect(emitted).not.toMatch(/readFile|import\(|process\.cwd/)
  })

  it('escapes instructions that would otherwise end the literal early', async () => {
    const instructions = 'Say "hello" — then `stop`,\nand \\ escape.\n'
    const { module: emitted } = await emit({ ...COMPLETE_TREE, 'agent/instructions.md': instructions })

    expect(emitted).toContain(`instructions: ${JSON.stringify(instructions)},`)
  })

  it('quotes a specifier as a literal, so an apostrophe in a filename stays inside the string', async () => {
    const { module: emitted } = await emit({
      ...COMPLETE_TREE,
      'agent/tools/it\'s.ts': 'export default {}\n',
    })

    expect(emitted).toContain(`import tool1 from ${JSON.stringify('../agent/tools/it\'s.ts')}`)
  })

  it('emits empty collections rather than omitting them, so the manifest stays a manifest', async () => {
    const { module: emitted } = await emit({
      'agent/instructions.md': 'Answer.\n',
      'agent/agent.ts': 'export default {}\n',
    })

    expect(emitted).toContain('tools: [],')
    expect(emitted).toContain('skills: [],')
    expect(emitted).toContain('schedules: [],')
    expect(emitted).toContain('channels: [],')
  })

  it('refuses a tree with no agent.ts, naming the file the harness would have come from', async () => {
    const root = await writeTree({ 'agent/instructions.md': 'Answer.\n' })
    const tree = await loadAgentTree(path.join(root, 'agent'))

    const emit = () => emitManifestModule(tree, path.join(root, '.amond'))

    expect(emit).toThrow(AgentTreeError)
    expect(emit).toThrow(path.join(root, 'agent/agent.ts'))
  })
})

describe('emitting an entry point', () => {
  it('gives Cloudflare the module entry a Worker is invoked through', () => {
    const emitted = emitEntryPoint('cloudflare')

    expect(emitted).toContain(`import { manifest } from './manifest.ts'`)
    expect(emitted).toContain('const handlers = createHandlers(manifest)')
    expect(emitted).toContain('fetch: (request: Request) => handlers.fetch(request),')
    expect(emitted).toContain('handlers.scheduled(new Date(controller.scheduledTime))')
  })

  it('gives Vercel route handlers, where a schedule arrives as a request', () => {
    const emitted = emitEntryPoint('vercel')

    expect(emitted).toContain(`import { manifest } from './manifest.ts'`)
    expect(emitted).toContain('export const POST = (request: Request) => handlers.fetch(request)')
    expect(emitted).toContain('await handlers.scheduled(new Date())')
  })

  it('generates no deployment config, which stays the user\'s', () => {
    for (const emitted of [emitEntryPoint('cloudflare'), emitEntryPoint('vercel')]) {
      expect(emitted).not.toMatch(/"compatibility_date"|"crons":/)
    }
  })
})
