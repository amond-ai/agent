import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BIN = fileURLToPath(new URL('../../bin/amond.mjs', import.meta.url))

function listFiles(root: string): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath, entry.name))
}

describe('amond init', () => {
  const cases = [
    { target: 'node', deploy: false },
    { target: 'node', deploy: true },
    { target: 'cloudflare', deploy: true },
  ] as const
  let tmp: string

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amond-init-'))
  })
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it.each(cases)('scaffolds files that name amond, not Flue ($target, deploy: $deploy)', ({ target, deploy }) => {
    const dir = path.join(tmp, `${target}-${deploy}`)
    const args = [BIN, 'init', dir, '--target', target, ...(deploy ? ['--deploy'] : [])]
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 })
    expect(result.status, result.stderr).toBe(0)

    const files = listFiles(dir)
    expect(files.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(dir, 'amond.config.ts'))).toBe(true)
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), path.relative(dir, file)).not.toMatch(/flue/i)
      expect(path.relative(dir, file)).not.toMatch(/flue/i)
    }
    const pkg = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    expect(pkg).toContain('@amond-ai/agent')
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/flue/i)
  })
})
