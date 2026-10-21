import { describe, expect, it } from 'vitest'
import { resolveSandbox } from './client.ts'

describe('resolveSandbox', () => {
  it('rejects a legacy sandbox object with an actionable migration error', async () => {
    const legacy = {
      createSandbox: async () => ({
        exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        readFile: async () => '',
        writeFile: async () => {},
        readFileBuffer: async () => new Uint8Array(),
      }),
    }

    await expect(resolveSandbox('s', legacy as never)).rejects.toThrow(/run\(\), spawn\(\), readTextFile\(\), writeTextFile\(\).*sandboxFromDriver/)
  })
})
