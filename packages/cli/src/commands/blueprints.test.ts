import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_REGISTRY_URL, registryUrlFor } from './blueprints.ts'

const BIN = fileURLToPath(new URL('../../bin/amond.mjs', import.meta.url))
const BLUEPRINTS_DIR = fileURLToPath(new URL('../../../../blueprints', import.meta.url))
const UNREACHABLE_REGISTRY = 'http://127.0.0.1:9'

// Serve the real blueprints the way the registry site does: `<slug>.md` with the JSON
// frontmatter stripped, where `<kind>--<name>.md` is `<name>` and `<kind>.md` is `<kind>`.
function loadRegistryBodies(): Map<string, string> {
  const bodies = new Map<string, string>()
  for (const file of fs.readdirSync(BLUEPRINTS_DIR)) {
    if (file === 'README.md' || !file.endsWith('.md')) { continue }
    const slug = path.basename(file, '.md').split('--').pop()!
    const source = fs.readFileSync(path.join(BLUEPRINTS_DIR, file), 'utf8')
    bodies.set(slug, source.replace(/^---\n[\s\S]*?\n---\n/, ''))
  }
  return bodies
}

// Every env var @vercel/detect-agent reads to detect a calling agent; keep in sync with
// node_modules/@vercel/detect-agent/dist/index.js.
const AGENT_ENV_VARS = [
  'AI_AGENT',
  'CURSOR_TRACE_ID',
  'CURSOR_AGENT',
  'CURSOR_EXTENSION_HOST_ROLE',
  'GEMINI_CLI',
  'CODEX_SANDBOX',
  'CODEX_CI',
  'CODEX_THREAD_ID',
  'ANTIGRAVITY_AGENT',
  'AUGMENT_AGENT',
  'OPENCODE',
  'OPENCODE_CLIENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CLAUDE_CODE_IS_COWORK',
  'REPL_ID',
  'COPILOT_MODEL',
  'COPILOT_ALLOW_ALL',
  'COPILOT_GITHUB_TOKEN',
]

function runAmond(args: string[], env: Record<string, string> = {}) {
  // Drop any inherited override so each case controls the registry itself.
  const { AMOND_REGISTRY_URL: _inherited, ...baseEnv } = process.env
  // Async spawn: the fixture registry runs in this process, so a sync spawn would deadlock it.
  return new Promise<{ status: number | null, stdout: string, stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...baseEnv, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
    const timer = setTimeout(() => child.kill(), 20_000)
    child.on('error', reject)
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}

describe('amond add / update against a registry', () => {
  const bodies = loadRegistryBodies()
  const requested: string[] = []
  let server: http.Server
  let registry: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requested.push(req.url ?? '')
      const slug = /^\/([^/]+)\.md$/.exec(req.url ?? '')?.[1]
      const body = slug === undefined ? undefined : bodies.get(slug)
      if (body === undefined) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, { 'content-type': 'text/markdown' }).end(body)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  it('lists the bundled blueprints and kinds without fetching', async () => {
    requested.length = 0
    const result = await runAmond(['add'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).toBe(0)
    for (const command of ['amond add sandbox daytona', 'amond add sandbox e2b', 'amond add tooling braintrust', 'amond add tooling vitest-evals']) {
      expect(result.stderr).toContain(command)
    }
    for (const kind of ['sandbox', 'tooling', 'channel', 'database']) {
      expect(result.stderr).toContain(`amond add ${kind} <url>`)
    }
    expect(requested).toEqual([])
  })

  it('prints a named blueprint to stdout', async () => {
    const result = await runAmond(['add', 'sandbox', 'daytona', '--print'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(bodies.get('daytona')!.endsWith('\n') ? bodies.get('daytona') : `${bodies.get('daytona')}\n`)
    expect(result.stdout).not.toMatch(/^---\n/)
  })

  it('resolves a blueprint by alias', async () => {
    requested.length = 0
    const result = await runAmond(['add', 'sandbox', '@daytona/sdk', '--print'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).toBe(0)
    expect(requested).toEqual(['/daytona.md'])
  })

  it('fills the URL into a kind-root blueprint', async () => {
    const url = 'https://example.com/api'
    const result = await runAmond(['add', 'channel', url, '--print'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).toBe(0)
    expect(bodies.get('channel')).toContain('{{URL}}')
    expect(result.stdout).toContain(`\`${url}\``)
    expect(result.stdout).not.toContain('{{URL}}')
  })

  it.each([
    ['a trailing slash', (url: string) => `${url}/`],
    ['several trailing slashes', (url: string) => `${url}///`],
    ['a plain http URL', (url: string) => url],
  ])('honors AMOND_REGISTRY_URL with %s', async (_label, build) => {
    requested.length = 0
    const result = await runAmond(['add', 'sandbox', 'e2b', '--print'], { AMOND_REGISTRY_URL: build(registry) })
    expect(result.status).toBe(0)
    expect(requested).toEqual(['/e2b.md'])
    expect(result.stdout).toContain(bodies.get('e2b')!.slice(0, 40))
  })

  it('reports an unknown blueprint and lists the available ones of that kind', async () => {
    requested.length = 0
    const result = await runAmond(['add', 'sandbox', 'nonesuch'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Blueprint "nonesuch" not found for kind "sandbox"')
    expect(result.stderr).toContain('amond add sandbox daytona')
    expect(result.stderr).not.toContain('amond add tooling braintrust')
    expect(requested).toEqual([])
  })

  it('reports a left-out channel blueprint as unknown', async () => {
    const result = await runAmond(['add', 'channel', 'slack'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Blueprint "slack" not found for kind "channel"')
    expect(result.stderr).toContain('Available channel blueprints:')
    expect(result.stderr).toContain('amond add channel <url>')
  })

  it('rejects an unknown kind', async () => {
    const result = await runAmond(['add', 'widget', 'x'], { AMOND_REGISTRY_URL: registry })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unknown blueprint kind "widget"')
  })

  it('names the registry when it has no Markdown for a slug', async () => {
    const empty = http.createServer((_req, res) => res.writeHead(404).end())
    await new Promise<void>(resolve => empty.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(empty.address() as AddressInfo).port}`
      const result = await runAmond(['add', 'sandbox', 'daytona', '--print'], { AMOND_REGISTRY_URL: url })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('did not have Markdown for "daytona"')
      expect(result.stdout).toBe('')
    }
    finally {
      await new Promise(resolve => empty.close(resolve))
    }
  })

  it('prints piping instructions instead of the guide without --print', async () => {
    // Agent markers in the environment would switch to stdout mode.
    const result = await runAmond(['add', 'sandbox', 'daytona'], {
      AMOND_REGISTRY_URL: registry,
      ...Object.fromEntries(AGENT_ENV_VARS.map(name => [name, ''])),
    })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain(bodies.get('daytona')!.slice(0, 40))
    expect(result.stderr).toContain('amond add sandbox \'daytona\' --print | claude')
    expect(result.stderr).toContain('Run "amond add sandbox \'daytona\' --print" and follow the instructions.')
  })

  describe('update', () => {
    it('prints a named blueprint to stdout', async () => {
      const result = await runAmond(['update', 'sandbox', 'daytona', '--print'], { AMOND_REGISTRY_URL: registry })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(bodies.get('daytona')!.slice(0, 40))
    })

    it('fills the URL into a kind-root blueprint', async () => {
      const url = 'https://example.com/api'
      const result = await runAmond(['update', 'channel', url, '--print'], { AMOND_REGISTRY_URL: registry })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`\`${url}\``)
    })

    it('reports a left-out channel blueprint as unknown', async () => {
      const result = await runAmond(['update', 'channel', 'slack', '--print'], { AMOND_REGISTRY_URL: registry })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Blueprint "slack" not found for kind "channel"')
    })

    it('requires a kind and a name', async () => {
      const result = await runAmond(['update'], { AMOND_REGISTRY_URL: registry })
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
    })
  })
})

describe('an unreachable registry', () => {
  it.each([
    ['add', ['add', 'sandbox', 'daytona', '--print']],
    ['update', ['update', 'sandbox', 'daytona', '--print']],
  ])('amond %s fails and names the registry URL', async (_label, args) => {
    const result = await runAmond(args, { AMOND_REGISTRY_URL: UNREACHABLE_REGISTRY })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`Failed to reach the blueprint registry at ${UNREACHABLE_REGISTRY}/daytona.md`)
    expect(result.stdout).toBe('')
  })

  it('gives up on a registry that never answers within AMOND_REGISTRY_TIMEOUT_MS', async () => {
    const sockets = new Set<import('node:net').Socket>()
    const blackhole = http.createServer(() => {})
    blackhole.on('connection', socket => sockets.add(socket))
    await new Promise<void>(resolve => blackhole.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(blackhole.address() as AddressInfo).port}`
      const result = await runAmond(['add', 'sandbox', 'daytona', '--print'], {
        AMOND_REGISTRY_URL: url,
        AMOND_REGISTRY_TIMEOUT_MS: '300',
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`Timed out after 300ms waiting for the blueprint registry at ${url}/daytona.md`)
    }
    finally {
      sockets.forEach(socket => socket.destroy())
      await new Promise(resolve => blackhole.close(resolve))
    }
  })
})

describe('the default registry', () => {
  it('is the blueprints site, over HTTPS', () => {
    expect(DEFAULT_REGISTRY_URL).toBe('https://blueprints.amond.ai')
  })

  it('is used when AMOND_REGISTRY_URL is unset, empty or blank', () => {
    const saved = process.env.AMOND_REGISTRY_URL
    try {
      delete process.env.AMOND_REGISTRY_URL
      expect(registryUrlFor('daytona')).toBe('https://blueprints.amond.ai/daytona.md')
      process.env.AMOND_REGISTRY_URL = ''
      expect(registryUrlFor('channel')).toBe('https://blueprints.amond.ai/channel.md')
      process.env.AMOND_REGISTRY_URL = '  '
      expect(registryUrlFor('channel')).toBe('https://blueprints.amond.ai/channel.md')
    }
    finally {
      if (saved === undefined) { delete process.env.AMOND_REGISTRY_URL }
      else { process.env.AMOND_REGISTRY_URL = saved }
    }
  })

  it('yields to an AMOND_REGISTRY_URL override with its trailing slashes stripped', () => {
    const saved = process.env.AMOND_REGISTRY_URL
    try {
      process.env.AMOND_REGISTRY_URL = 'http://127.0.0.1:8787//'
      expect(registryUrlFor('daytona')).toBe('http://127.0.0.1:8787/daytona.md')
    }
    finally {
      if (saved === undefined) { delete process.env.AMOND_REGISTRY_URL }
      else { process.env.AMOND_REGISTRY_URL = saved }
    }
  })
})
