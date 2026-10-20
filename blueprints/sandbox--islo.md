---
{
  "kind": "sandbox",
  "version": 2,
  "website": "https://islo.dev"
}
---

# Add an amond Sandbox Adapter: islo

You are an AI coding agent installing the [islo](https://islo.dev) sandbox
adapter for an amond project. Follow these instructions exactly. Confirm with
the user only when something is genuinely ambiguous (e.g. an unusual project
layout).

## What this adapter does

Wraps an islo sandbox (referenced by name) into amond's `SandboxFactory`. The
user creates the sandbox once with `islo use <name>`; the adapter adapts
the named sandbox so amond agents can run shell commands and read/write files
inside it.

islo is CLI-first — there is no npm SDK. The adapter shells out to the
local `islo` binary via `node:child_process`. **This means it requires a
Node.js runtime with shell access wherever the agent runs**, including the
user's deploy target. It works on Node servers, containers, and CI runners
(GitHub Actions, GitLab CI) where the islo CLI can be installed on `PATH`.
It does **not** work in JS-only edge runtimes such as Cloudflare Workers or
Vercel Edge — there's no `child_process` and no way to install a native
binary. Tell the user this up front if their target is an edge runtime;
they'll need a different sandbox provider.

## Where to write the file

Select the first existing source directory: `<root>/.amond/`, then `<root>/src/`,
then `<root>/`. Write the adapter to `<source-dir>/sandboxes/islo.ts`.

If neither feels right (uncommon layout, multiple workspaces, etc.), ask the
user before writing.

Create any missing parent directories.

## File contents

Write this file verbatim. Do not "improve" it — it conforms to the published
`SandboxDriver` contract, and the shell quoting in particular is load-bearing.

```ts
// amond-blueprint: sandbox/islo@2
/**
 * islo adapter for amond. Adapts a named islo sandbox to amond's SandboxDriver
 * by shelling out to the islo CLI. The user owns the sandbox lifecycle.
 *
 * @example
 * ```ts
 * 'use agent';
 * import { useModel, useSandbox } from '@amond-ai/agent';
 * import { islo } from './sandboxes/islo';
 *
 * export function Assistant() {
 *   useModel('anthropic/claude-sonnet-4-6');
 *   useSandbox(islo('my-sandbox'));
 *   return 'You are a helpful assistant with a full sandbox.';
 * }
 * ```
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sandboxFromDriver } from '@amond-ai/agent';
import type { SandboxDriver, SandboxFactory, Sandbox, FileStat } from '@amond-ai/agent';

export interface IsloAdapterOptions {
	/** Default cwd inside the sandbox. Defaults to `/workspace`. */
	cwd?: string;
	/** Path to the islo binary. Defaults to `"islo"` (resolved via PATH). */
	cliPath?: string;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Base64 characters per `exec`; keeps each argv entry far below Linux's 128 KiB limit. */
const WRITE_CHUNK_CHARS = 64 * 1024;

/**
 * Implements SandboxDriver via the islo CLI. Every operation runs as
 * `islo --output json use <name> -- bash -lc <cmd>`. With `--output json`,
 * the CLI writes the remote command's stdout straight to local stdout,
 * remote stderr to local stderr, and propagates the exit code — so we
 * don't need any wrapper protocol. The CLI does append a trailing
 * `\nExit code: N\n` line to stderr on non-zero exits; we strip it.
 *
 * File ops route through `exec()`. Binary content goes via base64 inline
 * (single-quote-safe alphabet) because the CLI decodes stdout as UTF-8.
 */
class IsloSandboxDriver implements SandboxDriver {
	constructor(
		private name: string,
		private cliPath: string,
	) {}

	async exec(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeoutMs?: number;
			signal?: AbortSignal;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const cd = options?.cwd ? `cd ${q(options.cwd)} && ` : '';
		for (const k of Object.keys(options?.env ?? {})) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
				throw new Error(`[amond:islo] invalid env var name '${k}'`);
			}
		}
		const envPrefix = options?.env
			? Object.entries(options.env)
					.map(([k, v]) => `${k}=${q(v)}`)
					.join(' ') + ' '
			: '';
		// Enforce timeout via GNU coreutils `timeout(1)` inside the sandbox.
		// islo's API has a `timeout_secs` field but it's currently advisory
		// only ("Optional client-side timeout hint. Currently accepted for
		// API compatibility." — islo API docs), so we have to enforce it
		// remotely. Assumes the sandbox image ships GNU coreutils, which is
		// true for the default islo runner and almost every standard Linux
		// image. On exceedance, `timeout` exits 124, which propagates through
		// the CLI as our exit code.
		const tmo =
			typeof options?.timeoutMs === 'number' ? `timeout ${options.timeoutMs / 1000} ` : '';
		const remote = `${envPrefix}${tmo}bash -lc ${q(cd + command)}`;

		const args = ['--output', 'json', 'use', this.name, '--', 'bash', '-lc', remote];
		// The islo CLI has no cancellation primitive, so `options?.signal` is
		// deliberately not forwarded here — sandboxFromDriver (which
		// this adapter builds on) owns caller-facing abort and rejects
		// promptly on it. The spawned child becomes an orphan: it keeps
		// running to completion against the sandbox, and its result below is
		// simply never observed by the caller that already moved on.
		return new Promise((resolve, reject) => {
			const child = spawn(this.cliPath, args, {
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			child.stdout.on('data', (c) => out.push(c));
			child.stderr.on('data', (c) => err.push(c));
			child.on('error', (e) =>
				reject(
					new Error(
						`[amond:islo] failed to spawn '${this.cliPath}': ${e.message}. ` +
							`Install the islo CLI: https://docs.islo.dev/getting-started/installation`,
					),
				),
			);
			child.on('close', (code) => {
				resolve({
					stdout: Buffer.concat(out).toString('utf-8'),
					stderr: Buffer.concat(err)
						.toString('utf-8')
						.replace(/\n*Exit code: \d+\n?$/, ''),
					exitCode: code ?? 0,
				});
			});
		});
	}

	async readFile(path: string): Promise<string> {
		const r = await this.exec(`cat -- ${q(path)}`);
		if (r.exitCode !== 0) throw new Error(`[amond:islo] readFile ${path}: ${r.stderr}`);
		return r.stdout;
	}

	async readFileBuffer(path: string): Promise<Uint8Array> {
		const r = await this.exec(`base64 < ${q(path)}`);
		if (r.exitCode !== 0) throw new Error(`[amond:islo] readFile ${path}: ${r.stderr}`);
		return Uint8Array.from(Buffer.from(r.stdout.replace(/\s+/g, ''), 'base64'));
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<void> {
		const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content);
		const b64 = buf.toString('base64'); // single-quote-safe alphabet
		// A single argv entry is capped at 128 KiB on Linux, so append the payload
		// to a temporary file in chunks (one exec each), then decode it once.
		const tmp = `/tmp/amond-islo-${randomUUID()}.b64`;
		const fail = (r: { stderr: string }) =>
			new Error(`[amond:islo] writeFile ${path}: ${r.stderr}`);
		let r = { stdout: '', stderr: '', exitCode: 0 };
		try {
			r = await this.exec(`mkdir -p "$(dirname ${q(path)})" && : > ${q(tmp)}`);
			for (let i = 0; i < b64.length && r.exitCode === 0; i += WRITE_CHUNK_CHARS) {
				r = await this.exec(`printf %s '${b64.slice(i, i + WRITE_CHUNK_CHARS)}' >> ${q(tmp)}`);
			}
			if (r.exitCode === 0) r = await this.exec(`base64 -d < ${q(tmp)} > ${q(path)}`);
		} finally {
			// Remove the staging file even when an exec rejects; a failed cleanup
			// must not mask the write's own result.
			await this.exec(`rm -f ${q(tmp)}`).catch(() => {});
		}
		if (r.exitCode !== 0) throw fail(r);
	}

	async stat(path: string): Promise<FileStat> {
		const r = await this.exec(`stat -c '%F|%s|%Y' ${q(path)}`);
		if (r.exitCode !== 0) throw new Error(`[amond:islo] stat ${path}: ${r.stderr}`);
		const fields = r.stdout.trim().split('|');
		const sizeValue = Number(fields[1]);
		const mtimeValue = Number(fields[2]);
		if (
			fields.length !== 3 ||
			!/^\d+$/.test(fields[1] ?? '') ||
			!/^-?\d+$/.test(fields[2] ?? '') ||
			!Number.isFinite(sizeValue) ||
			!Number.isFinite(mtimeValue)
		) {
			throw new Error(`[amond:islo] malformed stat output for ${path}: ${r.stdout}`);
		}
		const type = fields[0]!;
		return {
			isFile: type.startsWith('regular'),
			isDirectory: type === 'directory',
			isSymbolicLink: type === 'symbolic link',
			size: sizeValue,
			mtime: new Date(mtimeValue * 1000),
		};
	}

	async readdir(path: string): Promise<string[]> {
		const r = await this.exec(`ls -A1 ${q(path)}`);
		if (r.exitCode !== 0) throw new Error(`[amond:islo] readdir ${path}: ${r.stderr}`);
		return r.stdout.split('\n').filter(Boolean);
	}

	async exists(path: string): Promise<boolean> {
		return (await this.exec(`test -e ${q(path)}`)).exitCode === 0;
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const r = await this.exec(`mkdir ${options?.recursive ? '-p ' : ''}${q(path)}`);
		if (r.exitCode !== 0) throw new Error(`[amond:islo] mkdir ${path}: ${r.stderr}`);
	}

	async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
		const flags = `${options?.recursive ? 'r' : ''}${options?.force ? 'f' : ''}`;
		const r = await this.exec(`rm ${flags ? `-${flags} ` : ''}${q(path)}`);
		if (r.exitCode !== 0) throw new Error(`[amond:islo] rm ${path}: ${r.stderr}`);
	}
}

/**
 * Create an amond sandbox factory from an islo sandbox name. The user owns
 * the sandbox lifecycle (`islo use <name>` to create, `islo rm <name>` to
 * delete); this factory just adapts it.
 */
export function islo(name: string, options?: IsloAdapterOptions): SandboxFactory {
	const cliPath = options?.cliPath ?? 'islo';
	return {
		async createSandbox(): Promise<Sandbox> {
			const sandboxCwd = options?.cwd ?? '/workspace';
			const driver = new IsloSandboxDriver(name, cliPath);
			return sandboxFromDriver(driver, sandboxCwd);
		},
	};
}
```

## Required dependencies

None. The adapter only uses `@amond-ai/agent` (already in the project) and
Node's built-in `child_process`.

## Required runtime: the islo CLI

The host must have the islo CLI on `PATH` — both on the user's machine for
local development and on whatever target they deploy to (a Node server,
container, or CI runner). The CLI is a native binary distributed for macOS
and Linux on `x86_64` and `aarch64`.

Direct the user to the official install instructions at
[docs.islo.dev/getting-started/installation](https://docs.islo.dev/getting-started/installation).
**Don't pipe the install script yourself** — the user should review and run
it. After install, they can verify with `islo --version`.

For container or CI deployments, the user will need to add the install step
to their image build or CI workflow.

## Authentication

The adapter inherits whatever authentication the islo CLI already has.
Two options for the user:

- **Interactive login** (dev): `islo login` — opens a browser, caches a
  token in the OS keychain. The adapter uses it via the CLI.
- **API key** (CI/server): `islo api-key create my-amond-key --show` and
  set `ISLO_API_KEY` in the environment. The CLI exchanges it for a
  short-lived session token on first call.

**Never invent a key value** — it must come from the user. For local
one-shot runs, `amond run` loads the project's `.env` (or one alternate
file via `--env <file>`) — put `ISLO_API_KEY` there. `vite dev` and the
built server read the shell environment (`process.env`).

## Provisioning the sandbox

The adapter adapts an existing sandbox. Tell the user to create one:

```bash
islo use my-sandbox -- true                                 # provision and exit
islo use my-sandbox --image docker.io/library/python:latest -- true
```

Pause idle sandboxes with `islo pause <name>` to save credit; the next
`exec()` resumes automatically.

## Wiring it into an agent

Here's what using this adapter looks like inside an amond agent. If the
user is already working on an agent that this adapter is meant to plug
into, you can finish that work by wiring the adapter into it. Otherwise,
share this snippet so they can wire it up themselves.

```ts
'use agent';
import { useModel, useSandbox } from '@amond-ai/agent';
import { islo } from '../sandboxes/islo'; // adjust path to match the user's layout

export function Assistant() {
	useModel('anthropic/claude-sonnet-4-6');
	useSandbox(islo('my-sandbox'));
	return 'You are a helpful assistant with a full sandbox.';
}
```

The `'use agent'` directive at the top is what registers the module with
the application. Mount `createAgentRouter(...)` (from `@amond-ai/agent/routing`) in
`app.ts` only if the agent needs
an HTTP endpoint — `amond run` and `dispatch()` work without a mount.

## Verify

1. Run the user's typechecker (`npx tsc --noEmit` is a safe default) and
   confirm the new file has no errors.
2. Confirm the import path you used for the adapter matches where you
   actually wrote the file.
3. Tell the user the next steps: install the islo CLI (if you didn't),
   run `islo login` (or make `ISLO_API_KEY` available at runtime per the
   Authentication section above), pre-provision a sandbox with
   `islo use <name>`, then run
   `amond run <path-to-the-agent-module> --message "..."` (or `vite dev`
   for the full application) to try it.

When updating an existing integration, inspect and compare it against this complete current blueprint, apply every relevant change while preserving customizations, and then add or update the marker in the primary marked file. This comparison is required when the marker is missing.

## Upgrade Guide

### Version 1 — 2026-06-14

Initial version.

### Version 2 — 2026-10-20

Reject env var names that are not valid shell identifiers, because `exec()` interpolated them raw into the remote command. Write files in chunks of about 64 KB through a temporary file, removed even when a step fails, because a single argument above 128 KiB made `writeFile()` fail with `spawn E2BIG` for payloads over about 98 KB.

```diff
--- a/src/sandboxes/islo.ts
+++ b/src/sandboxes/islo.ts
-// amond-blueprint: sandbox/islo@1
+// amond-blueprint: sandbox/islo@2
 import { spawn } from 'node:child_process';
+import { randomUUID } from 'node:crypto';
 import { sandboxFromDriver } from '@amond-ai/agent';
@@
 const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
+
+/** Base64 characters per `exec`; keeps each argv entry far below Linux's 128 KiB limit. */
+const WRITE_CHUNK_CHARS = 64 * 1024;
@@
 		const cd = options?.cwd ? `cd ${q(options.cwd)} && ` : '';
+		for (const k of Object.keys(options?.env ?? {})) {
+			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
+				throw new Error(`[amond:islo] invalid env var name '${k}'`);
+			}
+		}
 		const envPrefix = options?.env
@@
 		const b64 = buf.toString('base64'); // single-quote-safe alphabet
-		const r = await this.exec(
-			`mkdir -p "$(dirname ${q(path)})" && printf %s '${b64}' | base64 -d > ${q(path)}`,
-		);
-		if (r.exitCode !== 0) throw new Error(`[amond:islo] writeFile ${path}: ${r.stderr}`);
+		// A single argv entry is capped at 128 KiB on Linux, so append the payload
+		// to a temporary file in chunks (one exec each), then decode it once.
+		const tmp = `/tmp/amond-islo-${randomUUID()}.b64`;
+		const fail = (r: { stderr: string }) =>
+			new Error(`[amond:islo] writeFile ${path}: ${r.stderr}`);
+		let r = { stdout: '', stderr: '', exitCode: 0 };
+		try {
+			r = await this.exec(`mkdir -p "$(dirname ${q(path)})" && : > ${q(tmp)}`);
+			for (let i = 0; i < b64.length && r.exitCode === 0; i += WRITE_CHUNK_CHARS) {
+				r = await this.exec(`printf %s '${b64.slice(i, i + WRITE_CHUNK_CHARS)}' >> ${q(tmp)}`);
+			}
+			if (r.exitCode === 0) r = await this.exec(`base64 -d < ${q(tmp)} > ${q(path)}`);
+		} finally {
+			// Remove the staging file even when an exec rejects; a failed cleanup
+			// must not mask the write's own result.
+			await this.exec(`rm -f ${q(tmp)}`).catch(() => {});
+		}
+		if (r.exitCode !== 0) throw fail(r);
```
