import { Bash } from 'just-bash'
import { describe, expect, it } from 'vitest'
import { discoverSessionContext } from './context.ts'
import { bash } from './sandbox.ts'

describe('discoverSessionContext', () => {
  it('reads AGENTS.md and workspace SKILL.md files through readTextFile', async () => {
    const sandbox = await bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'context' })
    await sandbox.writeTextFile({ path: 'AGENTS.md', content: '  Be terse.\n' })
    await sandbox.writeTextFile({
      path: '.agents/skills/greet/SKILL.md',
      content: '---\nname: greet\ndescription: Say hello.\n---\n\nSay hello.\n',
    })

    const context = await discoverSessionContext(sandbox)

    expect(Object.keys(context.skills)).toEqual(['greet'])
    const prompt = context.recompose()
    expect(prompt).toContain('Be terse.')
    expect(prompt).toContain('- **greet** — Say hello.')
  })
})
