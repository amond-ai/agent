import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTrees, writeTree } from './tree-fixture'

afterEach(cleanupTrees)

describe('the tree fixture', () => {
  it('refuses a path that climbs out of the tree, which cleanup would never remove', async () => {
    await expect(writeTree({ '../escaped.ts': 'export default {}\n' }))
      .rejects
      .toThrow('stay under the tree root')
  })

  it('refuses an absolute path, which resolves away from the root entirely', async () => {
    await expect(writeTree({}, ['/tmp/amond-escaped']))
      .rejects
      .toThrow('stay under the tree root')
  })
})
