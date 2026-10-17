import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BIN = fileURLToPath(new URL('../../bin/amond.mjs', import.meta.url))
const UNREACHABLE_REGISTRY = 'http://127.0.0.1:9'

// Drop any inherited override so the "no registry override" case really has none.
const { AMOND_REGISTRY_URL: _inherited, ...baseEnv } = process.env

function runAmond(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
    timeout: 20_000,
  })
}

describe('commands that need bundled content', () => {
  const docsCases = [
    ['docs'],
    ['docs', 'read', 'guide/tools'],
    ['docs', 'search', 'tools'],
  ]
  const blueprintCases = [
    ['add'],
    ['add', 'channel', 'slack'],
    ['add', 'channel', 'https://example.com/docs'],
    ['update'],
    ['update', 'channel', 'slack'],
    ['update', 'channel', 'slack', '--print'],
  ]

  it.each(docsCases)('amond %s... reports that no docs are bundled', (...args) => {
    const result = runAmond(args)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('No documentation is bundled with this version of amond.')
  })

  describe.each([
    ['no registry override', {}],
    ['an unreachable AMOND_REGISTRY_URL', { AMOND_REGISTRY_URL: UNREACHABLE_REGISTRY }],
  ])('with %s', (_label, env) => {
    it.each(blueprintCases)('amond %s... reports that no blueprints are bundled', (...args) => {
      const result = runAmond(args, env)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('No blueprints are bundled with this version of amond.')
      // A fetch attempt would surface as a registry error instead.
      expect(result.stderr).not.toMatch(/registry|ECONNREFUSED|Failed to reach/i)
      expect(result.stdout).toBe('')
    })
  })
})
