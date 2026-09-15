import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { build } from './build'
import { BUILD_TARGETS } from './emit'
import { cleanupTrees, COMPLETE_TREE, writeTree } from './tree-fixture'

// A build's durability is only observable when the filesystem fails, so the two failures it
// claims to survive are arranged here — a write partway through, and the swap into place.
// Hoisted so the module factory below can close over it; matched by basename, because
// `.amond` is a prefix of `.amond.tmp` and a substring test would fail every rename at once.
const fails = vi.hoisted(() => ({
  write: undefined as string | undefined,
  rename: undefined as string | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const basename = (value: unknown) => String(value).split(/[/\\]/).at(-1)
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (fails.write !== undefined && basename(args[0]) === fails.write) {
        throw new Error('no space left on device')
      }
      return actual.writeFile(...args)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fails.rename !== undefined && basename(args[0]) === fails.rename) {
        throw new Error('cross-device link not permitted')
      }
      return actual.rename(...args)
    },
  }
})

afterEach(() => void (fails.write = fails.rename = undefined))
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
      .toContain(`import tool0 from "../agent/tools/close-issue.ts"`)
    expect(await readFile(path.join(root, '.amond/cloudflare.ts'), 'utf8'))
      .toContain(`import { manifest } from './manifest.ts'`)
    expect(await readFile(path.join(root, '.amond/vercel.ts'), 'utf8'))
      .toContain('export const POST')
  })

  it('picks up a new tool with no registry to edit, which is the point of the layout', async () => {
    const root = await writeTree({ ...COMPLETE_TREE, 'agent/tools/assign.ts': 'export default {}\n' })

    await run(root)

    expect(await readFile(path.join(root, '.amond/manifest.ts'), 'utf8'))
      .toContain(`import tool0 from "../agent/tools/assign.ts"`)
  })

  it('exits 1 with the path at fault when the tree is malformed', async () => {
    const root = await writeTree({ ...COMPLETE_TREE, 'agent/tools/search-issues.ts': 'const s = {}\n' })

    const { code, stderr } = await run(root)

    expect(code).toBe(1)
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(`${path.join(root, 'agent/tools/search-issues.ts')}: no default export`),
    )
  })

  it('leaves the previous build in place when a write fails partway through', async () => {
    const root = await writeTree(COMPLETE_TREE)
    await run(root)
    const manifest = path.join(root, '.amond/manifest.ts')
    const before = await readFile(manifest, 'utf8')

    // A tool the failed build would have added, so a manifest written straight into `.amond/`
    // is distinguishable from the one the successful build left there.
    await writeFile(path.join(root, 'agent/tools/assign.ts'), 'export default {}\n')
    fails.write = `${BUILD_TARGETS[0]}.ts`
    await expect(run(root)).rejects.toThrow('no space left on device')

    expect(await readFile(manifest, 'utf8')).toBe(before)
    expect(before).not.toContain('assign.ts')
    await expect(stat(path.join(root, '.amond.tmp'))).rejects.toThrow()
  })

  it('puts the previous build back when the swap into place fails', async () => {
    const root = await writeTree(COMPLETE_TREE)
    await run(root)
    const manifest = path.join(root, '.amond/manifest.ts')
    const before = await readFile(manifest, 'utf8')

    await writeFile(path.join(root, 'agent/tools/assign.ts'), 'export default {}\n')
    fails.rename = '.amond.tmp'
    await expect(run(root)).rejects.toThrow('cross-device link')

    expect(await readFile(manifest, 'utf8')).toBe(before)
    await expect(stat(path.join(root, '.amond.old'))).rejects.toThrow()
    await expect(stat(path.join(root, '.amond.tmp'))).rejects.toThrow()
  })

  it('writes nothing at all when the tree is rejected', async () => {
    const root = await writeTree({}, ['agent'])

    const { code } = await run(root)

    expect(code).toBe(1)
    await expect(stat(path.join(root, '.amond'))).rejects.toThrow()
  })
})
