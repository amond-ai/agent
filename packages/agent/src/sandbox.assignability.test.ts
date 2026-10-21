/**
 * AC-001: every `Sandbox` is an AI SDK `Experimental_SandboxSession` with no
 * adapter or cast. The assignments below are checked by `bun check`; the
 * runtime assertions confirm each value really is a session.
 */

import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils'
import { Bash } from 'just-bash'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { CloudflareSandboxStub } from './cloudflare/cf-sandbox.ts'
import { cloudflareSandbox } from './cloudflare/cf-sandbox.ts'
import { createLocalSandbox } from './node/local-env.ts'
import { local } from './node/local.ts'
import type { SandboxDriver } from './sandbox.ts'
import { bash, createCwdSandbox, sandboxFromDriver } from './sandbox.ts'
import type { Sandbox } from './types.ts'

const SESSION_MEMBERS = [
  'description',
  'readFile',
  'readBinaryFile',
  'readTextFile',
  'writeFile',
  'writeBinaryFile',
  'writeTextFile',
  'spawn',
  'run',
] as const

function unusedDriver(): SandboxDriver {
  const unused = (): never => { throw new Error('not called') }
  return {
    readFile: unused,
    readFileBuffer: unused,
    writeFile: unused,
    stat: unused,
    readdir: unused,
    exists: unused,
    mkdir: unused,
    rm: unused,
    exec: unused,
  }
}

function unusedStub(): CloudflareSandboxStub {
  const unused = (): never => { throw new Error('not called') }
  return {
    exec: unused,
    readFile: unused,
    writeFile: unused,
    exists: unused,
    mkdir: unused,
    deleteFile: unused,
    getState: unused,
  }
}

function expectSession(session: Experimental_SandboxSession): void {
  for (const member of SESSION_MEMBERS) {
    expect(session[member], member).toBeDefined()
  }
  expect(typeof session.description).toBe('string')
}

describe('Sandbox is an Experimental_SandboxSession (AC-001)', () => {
  it('holds for the Sandbox type itself', () => {
    expectTypeOf<Sandbox>().toExtend<Experimental_SandboxSession>()
  })

  it('holds for sandboxFromDriver', () => {
    const session: Experimental_SandboxSession = sandboxFromDriver(unusedDriver(), '/work')
    expectTypeOf(sandboxFromDriver).returns.toExtend<Experimental_SandboxSession>()
    expectSession(session)
  })

  it('holds for local()', async () => {
    const direct: Experimental_SandboxSession = createLocalSandbox({ cwd: '/' })
    const viaFactory: Experimental_SandboxSession = await local({ cwd: '/' }).createSandbox({ id: 'a' })
    expectTypeOf(createLocalSandbox).returns.toExtend<Experimental_SandboxSession>()
    expectSession(direct)
    expectSession(viaFactory)
  })

  it('holds for bash()', async () => {
    const session: Experimental_SandboxSession = await bash(() => new Bash({ cwd: '/work' })).createSandbox({ id: 'a' })
    expectSession(session)
  })

  it('holds for cloudflareSandbox', async () => {
    const session: Experimental_SandboxSession = await cloudflareSandbox(unusedStub()).createSandbox({ id: 'a' })
    expectSession(session)
  })

  it('holds for createCwdSandbox', () => {
    const session: Experimental_SandboxSession = createCwdSandbox(sandboxFromDriver(unusedDriver(), '/work'), '/work/sub')
    expectTypeOf(createCwdSandbox).returns.toExtend<Experimental_SandboxSession>()
    expectSession(session)
  })
})
