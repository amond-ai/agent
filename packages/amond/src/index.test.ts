import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from './index'
import { cleanupTrees, COMPLETE_TREE, writeTree } from './tree-fixture'

afterEach(cleanupTrees)

describe('the amond CLI entry point', () => {
  it('exits 1 and prints usage when no command is given', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await expect(main([])).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('usage: amond'))

    stderr.mockRestore()
  })

  it('exits 2 on an unknown command, distinguishing it from no command at all', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await expect(main(['deploy'])).resolves.toBe(2)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('usage: amond'))

    stderr.mockRestore()
  })

  it('names the command it cannot run yet, rather than reporting a usage error', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await expect(main(['dev'])).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('amond dev: not implemented'))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('usage:'))

    stderr.mockRestore()
  })

  it('builds the tree in the directory it is given', async () => {
    const root = await writeTree(COMPLETE_TREE)
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(main(['build', root])).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining(`wrote ${path.basename('.amond')}/`))

    stdout.mockRestore()
  })
})
