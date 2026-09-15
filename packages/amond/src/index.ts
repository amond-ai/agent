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
import process from 'node:process'

const COMMANDS = ['init', 'dev', 'build'] as const
type Command = typeof COMMANDS[number]

function isCommand(value: string | undefined): value is Command {
  return COMMANDS.includes(value as Command)
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const [command] = argv

  if (!isCommand(command)) {
    process.stderr.write(`usage: amond <${COMMANDS.join('|')}>\n`)
    return command === undefined ? 1 : 2
  }

  // _TODO: dispatch once the loader and the emitters exist._
  process.stderr.write(`amond ${command}: not implemented\n`)
  return 1
}

if (import.meta.main) {
  process.exit(main())
}
