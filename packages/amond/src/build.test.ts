import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { build } from './build'
import { cleanupTrees, COMPLETE_TREE, writeTree } from './tree-fixture'

afterEach(cleanupTrees)
// Restored here rather than inside the helper below: `mockRestore` clears the recorded calls,
// so a spy restored before the assertion reads as never called.
afterEach(() => void vi.restoreAllMocks())

/** Run a build with both streams captured, so a passing test does not print over the reporter. */
async function run(cwd: string) {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  return { code: await build(cwd), stdout, stderr }
}

describe('amond build', () => {
  it('writes the manifest and an entry point per target', async () => {
    const root = await writeTree(COMPLETE_TREE)

    const { code } = await run(root)

    expect(code).toBe(0)
    expect(await readFile(path.join(root, '.amond/manifest.ts'), 'utf8'))
      .toContain(`import tool0 from '../agent/tools/close-issue.ts'`)
    expect(await readFile(path.join(root, '.amond/cloudflare.ts'), 'utf8'))
      .toContain(`import { manifest } from './manifest.ts'`)
    expect(await readFile(path.join(root, '.amond/vercel.ts'), 'utf8'))
      .toContain('export const POST')
  })

  it('picks up a new tool with no registry to edit, which is the point of the layout', async () => {
    const root = await writeTree({ ...COMPLETE_TREE, 'agent/tools/assign.ts': 'export default {}\n' })

    await run(root)

    expect(await readFile(path.join(root, '.amond/manifest.ts'), 'utf8'))
      .toContain(`import tool0 from '../agent/tools/assign.ts'`)
  })

  it('exits 1 with the path at fault when the tree is malformed', async () => {
    const root = await writeTree({ ...COMPLETE_TREE, 'agent/tools/search-issues.ts': 'const s = {}\n' })

    const { code, stderr } = await run(root)

    expect(code).toBe(1)
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(`${path.join(root, 'agent/tools/search-issues.ts')}: no default export`),
    )
  })

  it('writes nothing at all when the tree is rejected', async () => {
    const root = await writeTree({}, ['agent'])

    const { code } = await run(root)

    expect(code).toBe(1)
    await expect(stat(path.join(root, '.amond'))).rejects.toThrow()
  })
})
