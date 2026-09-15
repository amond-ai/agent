#!/usr/bin/env node
/**
 * The amond CLI.
 *
 * Three commands, matching the scope the first release committed to:
 *
 * - `init`   scaffold an `agent/` tree
 * - `dev`    run the agent locally on the in-memory durable runtime
 * - `build`  walk the tree and emit a manifest plus a per-target entry point
 *
 * `build` is where the filesystem convention becomes deployable code. It runs here, on a
 * machine that has `fs`, because a Worker does not — see the note in `@amond-ai/agent-core`.
 * What it emits is handlers; the wiring around them (`wrangler.jsonc`, `vercel.json`, cron
 * registration) stays the user's.
 */
import path from 'node:path'
import process from 'node:process'
import { build } from './build'

const COMMANDS = ['init', 'dev', 'build'] as const
type Command = typeof COMMANDS[number]

function isCommand(value: string | undefined): value is Command {
  return COMMANDS.includes(value as Command)
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, directory] = argv

  if (!isCommand(command)) {
    process.stderr.write(`usage: amond <${COMMANDS.join('|')}> [directory]\n`)
    return command === undefined ? 1 : 2
  }

  if (command === 'build') {
    return build(path.resolve(directory ?? process.cwd()))
  }

  // _TODO: `init` and `dev`, once the scaffold and the local server exist._
  process.stderr.write(`amond ${command}: not implemented\n`)
  return 1
}

if (import.meta.main) {
  // Not a top-level `await`: an unexpected failure should reach the terminal as a rejection
  // with its stack, not as an exit code that says nothing about what broke.
  void main().then(code => process.exit(code))
}
