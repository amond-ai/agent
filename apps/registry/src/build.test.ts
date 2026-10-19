import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRegistry } from './build.ts'

const blueprintsDir = fileURLToPath(new URL('../../../blueprints', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const DEV_START_TIMEOUT_MS = 30_000

/** `<kind>--<name>.md` is served as `<name>.md`; `<kind>.md` as `<kind>.md`. */
function expectedSlugs(sourceFiles: string[]): string[] {
  return sourceFiles
    .filter(file => file !== 'README.md')
    .map((file) => {
      const stem = file.slice(0, -'.md'.length)
      const dash = stem.indexOf('--')
      return `${dash >= 0 ? stem.slice(dash + 2) : stem}.md`
    })
    .sort()
}

function sourceFor(fixtureRoot: string, file: string): Promise<string> {
  return readFile(join(fixtureRoot, file), 'utf-8')
}

let work: string

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'amond-registry-'))
})

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('buildRegistry over the repository blueprints', () => {
  let outDir: string
  let sourceFiles: string[]

  beforeAll(async () => {
    outDir = join(work, 'dist')
    sourceFiles = (await readdir(blueprintsDir)).filter(file => file.endsWith('.md'))
    await buildRegistry(blueprintsDir, outDir)
  })

  it('writes exactly one file per blueprint and kind root', async () => {
    const written = (await readdir(outDir)).sort()
    expect(written).toEqual(expectedSlugs(sourceFiles))
    expect(written).toHaveLength(16)
    expect(written).toContain('daytona.md')
    expect(written).toContain('sandbox.md')
  })

  it('writes no file for an alias or for the README', async () => {
    const written = await readdir(outDir)
    // sandbox--daytona.md declares the alias "@daytona/sdk".
    const daytona = await sourceFor(blueprintsDir, 'sandbox--daytona.md')
    expect(daytona).toContain('"@daytona/sdk"')
    expect(written).not.toContain('@daytona/sdk.md')
    expect(written).not.toContain('README.md')
  })

  it('serves the body without frontmatter, byte-identical to the source body', async () => {
    for (const file of sourceFiles.filter(name => name !== 'README.md')) {
      const source = await sourceFor(blueprintsDir, file)
      const end = source.indexOf('\n---\n', 4)
      const body = source.slice(end + '\n---\n'.length).replace(/^\n+/, '')
      const stem = file.slice(0, -'.md'.length)
      const dash = stem.indexOf('--')
      const output = await readFile(join(outDir, `${dash >= 0 ? stem.slice(dash + 2) : stem}.md`), 'utf-8')
      expect(output, file).toBe(body)
      expect(output.startsWith('# '), file).toBe(true)
      expect(output, file).not.toContain(source.slice(0, end + '\n---\n'.length))
      expect(output, file).not.toMatch(/^\s*"kind":/m)
    }
  })

  it('removes a file left from an earlier build', async () => {
    await writeFile(join(outDir, 'stale.md'), 'old', 'utf-8')
    await buildRegistry(blueprintsDir, outDir)
    expect(await readdir(outDir)).not.toContain('stale.md')
  })
})

describe('buildRegistry rejects invalid input', () => {
  async function fixture(name: string, mutate: (dir: string) => Promise<void>): Promise<string> {
    const dir = join(work, name)
    await cp(blueprintsDir, dir, { recursive: true })
    await mutate(dir)
    return dir
  }

  it('fails on a slug collision between two kinds', async () => {
    const dir = await fixture('collision', async (d) => {
      const source = await sourceFor(d, 'sandbox--daytona.md')
      await writeFile(
        join(d, 'tooling--daytona.md'),
        source.replace('"kind": "sandbox"', '"kind": "tooling"'),
        'utf-8',
      )
    })
    await expect(buildRegistry(dir, join(work, 'out-collision'))).rejects.toThrow(/name collision/)
  })

  it('fails on an alias that is already a slug', async () => {
    const dir = await fixture('alias-collision', async (d) => {
      const file = join(d, 'sandbox--daytona.md')
      await writeFile(file, (await readFile(file, 'utf-8')).replace('"@daytona/sdk"', '"e2b"'), 'utf-8')
    })
    await expect(buildRegistry(dir, join(work, 'out-alias'))).rejects.toThrow(/name collision/)
  })

  it('fails on invalid frontmatter and writes nothing', async () => {
    const dir = await fixture('bad-frontmatter', async (d) => {
      const file = join(d, 'sandbox--daytona.md')
      await writeFile(file, (await readFile(file, 'utf-8')).replace('"kind": "sandbox",', ''), 'utf-8')
    })
    const out = join(work, 'out-bad')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'keep.md'), 'x', 'utf-8')
    await expect(buildRegistry(dir, out)).rejects.toThrow(/daytona\.md.*kind/)
    expect(await readdir(out)).toEqual(['keep.md'])
  })
})

/** A port the OS reports free, for the dev server to bind. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  await new Promise(resolve => probe.close(resolve))
  if (!address || typeof address === 'string') {
    throw new Error('The OS did not report a free port.')
  }
  return address.port
}

/**
 * The first `node` on PATH that is Node itself. `bun --bun` puts a `node` shim that runs Bun in
 * front of PATH, and wrangler's dev server starts under Bun but never answers a request.
 */
function realNode(): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, 'node')
    if (existsSync(candidate) && !basename(realpathSync(candidate)).startsWith('bun')) {
      return candidate
    }
  }
  throw new Error('No Node.js binary on PATH: wrangler dev needs Node, not Bun.')
}

/**
 * Runs the real `wrangler dev` against this package's `wrangler.jsonc`, with `--assets` pointing
 * at a fresh build, so the 200 and 404 answers come from Workers static-asset handling itself.
 * Wrangler runs under Node, see `realNode`.
 */
describe('serving the build with wrangler dev', () => {
  let dev: ChildProcess | undefined
  let base: string
  const outDir = join(tmpdir(), `amond-registry-served-${process.pid}`)

  beforeAll(async () => {
    await buildRegistry(blueprintsDir, outDir)
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    // `bin/` is not in wrangler's `exports`, so locate it from the manifest, which is.
    const wrangler = join(dirname(fileURLToPath(import.meta.resolve('wrangler/package.json'))), 'bin/wrangler.js')
    const child = spawn(
      realNode(),
      [wrangler, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--assets', outDir],
      { cwd: packageDir, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    dev = child
    // Wait for wrangler's own "Ready on" line rather than polling the port: a request sent while
    // the dev proxy is still starting can be held open indefinitely.
    let output = ''
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`wrangler dev did not start within ${DEV_START_TIMEOUT_MS}ms:\n${output}`)),
        DEV_START_TIMEOUT_MS,
      )
      const onData = (chunk: Uint8Array): void => {
        output += new TextDecoder().decode(chunk)
        if (output.includes('Ready on')) {
          clearTimeout(timer)
          resolve()
        }
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`wrangler dev exited with code ${code}:\n${output}`))
      })
    })
  }, DEV_START_TIMEOUT_MS + 5_000)

  afterAll(async () => {
    if (dev && dev.exitCode === null) {
      const child = dev
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGTERM')
      await exited
    }
    await rm(outDir, { recursive: true, force: true })
  })

  it('returns Markdown for a slug', async () => {
    const res = await fetch(`${base}/daytona.md`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/markdown/)
    expect(await res.text()).toBe(await readFile(join(outDir, 'daytona.md'), 'utf-8'))
  })

  it('returns a plain 404 for an unknown name, an alias, or the bare root', async () => {
    for (const path of ['/slack.md', `/${encodeURIComponent('@daytona/sdk')}.md`, '/daytona', '/']) {
      const res = await fetch(`${base}${path}`)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('')
    }
  })
})
