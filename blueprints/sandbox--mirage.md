---
{
  "kind": "sandbox",
  "version": 2,
  "website": "https://docs.mirage.strukto.ai",
  "aliases": ["@struktoai/mirage-node", "@struktoai/mirage-browser"]
}
---

# Add an amond Sandbox Adapter: Mirage

You are an AI coding agent installing the Mirage sandbox adapter for an
amond project. Follow these instructions exactly. Confirm with the user only
when something is genuinely ambiguous (e.g. an unusual project layout).

## What this adapter does

Wraps an already-initialized Mirage `Workspace` (created with the user's own
`@struktoai/mirage-node` or `@struktoai/mirage-browser` SDK) into amond's
`SandboxFactory` interface. The user owns the root and its mounts;
this adapter just adapts the root.

Things to know before installing:

- Mirage publishes two runtime packages with the same `Workspace` API:
  `@struktoai/mirage-node` for the Node target, and
  `@struktoai/mirage-browser` for the Cloudflare target (Cloudflare Workers
  are a browser-class runtime). The adapter itself imports types from
  `@struktoai/mirage-core` (re-exported by both) so the same file works for
  either target. The user picks the right runtime package in their agent
  code based on their build target.
- Some Mirage resources are Node-only (`SSHResource`, `PostgresResource`,
  `MongoDBResource`, `EmailResource`, FUSE). Importing them from
  `@struktoai/mirage-browser` is a build error, so using any of those
  pins the user to the Node target.
- If you see `@struktoai/mirage-agents` in Mirage's docs, **don't install
  it for amond** — it's an adapter for other agent frameworks, not for amond.

## Where to write the file

Select the first existing source directory: `<root>/.amond/`, then `<root>/src/`,
then `<root>/`. Write the adapter to `<source-dir>/sandboxes/mirage.ts`.

If neither feels right (uncommon layout, multiple workspaces, etc.), ask the
user before writing.

Create any missing parent directories.

## File contents

Write this file verbatim. Do not "improve" it — it conforms to the published
`SandboxDriver` contract.

```ts
// amond-blueprint: sandbox/mirage@2
/**
 * Mirage adapter for amond.
 *
 * Wraps an already-initialized Mirage `Workspace` (from
 * `@struktoai/mirage-node` or `@struktoai/mirage-browser`) into amond's
 * SandboxFactory interface. The user constructs the Workspace and mounts
 * resources directly using the Mirage SDK — amond just adapts it.
 *
 * @example
 * ```typescript
 * 'use agent';
 * import { Workspace, RAMResource, MountMode } from '@struktoai/mirage-node';
 * import { useModel, useSandbox } from '@amond-ai/agent';
 * import { mirage } from '../sandboxes/mirage';
 *
 * export function Assistant() {
 *   useModel('anthropic/claude-sonnet-4-6');
 *   const ws = new Workspace({ '/data': new RAMResource() }, { mode: MountMode.WRITE });
 *   useSandbox(mirage(ws));
 *   return 'You are a helpful assistant with a full sandbox.';
 * }
 * ```
 */
import { sandboxFromDriver } from '@amond-ai/agent';
import type { SandboxDriver, SandboxFactory, Sandbox, FileStat } from '@amond-ai/agent';
import type { Workspace as MirageWorkspace } from '@struktoai/mirage-core';

export interface MirageAdapterOptions {
	/**
	 * Default working directory for `exec()` calls when the caller doesn't
	 * pass one. Mirage workspaces are rooted at `/` (mounts hang off this
	 * root), so `/` is the safe default. Pin to a specific writable mount
	 * (e.g. `/data`) if you want the agent to default to working there.
	 */
	cwd?: string;
}

/**
 * Quote a string for safe inclusion in a `bash`-style command line.
 * Mirage's shell executor parses POSIX-ish syntax, so the same single-quote
 * escape used for real bash works here.
 */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Implements SandboxDriver by wrapping a Mirage Workspace.
 *
 * Each amond context maps onto a Mirage session (created lazily by id) so
 * that cwd, env, history, and lastExitCode stay isolated across agent
 * instances and conversations. Harnesses initialized within the same
 * context intentionally reuse that Mirage session.
 *
 * Filesystem operations route through `workspace.fs.*` (Mirage's direct
 * VFS API) for read/write/readdir/stat/exists/single-level mkdir.
 * Recursive `mkdir -p` shells out via `workspace.execute()` because
 * `WorkspaceFS` exposes only single-level `mkdir`. Removal with `recursive`
 * or `force` shells out the same way (`rm [-r] [-f] --`); plain removal
 * stays on the filesystem API.
 *
 * `cwd`, `env`, and `signal` (including `AbortSignal.timeout(...)`) all
 * pass directly through to `ExecuteOptions` — Mirage runs each call in an
 * isolated session for `cwd`/`env`, and observes the signal cooperatively
 * at LIST/PIPELINE/loop boundaries. No shell-prefix workarounds.
 */
class MirageSandboxDriver implements SandboxDriver {
	constructor(
		private workspace: MirageWorkspace,
		private amondContextId: string,
	) {}

	async readFile(path: string): Promise<string> {
		const bytes = await this.workspace.fs.readFile(path);
		return new TextDecoder('utf-8').decode(bytes);
	}

	async readFileBuffer(path: string): Promise<Uint8Array> {
		// Defensive copy: Mirage may hand back a view onto an internal buffer.
		const bytes = await this.workspace.fs.readFile(path);
		return new Uint8Array(bytes);
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<void> {
		const bytes =
			typeof content === 'string' ? new TextEncoder().encode(content) : content;
		await this.workspace.fs.writeFile(path, bytes);
	}

	async stat(path: string): Promise<FileStat> {
		const s = await this.workspace.fs.stat(path);
		// Mirage's FileStat: { name, size: number|null, modified: string|null,
		// type: FileType|null }.
		return {
			isFile: s.type === 'file',
			isDirectory: s.type === 'directory',
			...(s.size === null ? {} : { size: s.size }),
			...(s.modified === null ? {} : { mtime: new Date(s.modified) }),
		};
	}

	async readdir(path: string): Promise<string[]> {
		// Mirage returns absolute paths; some implementations include a
		// trailing `/` for directories, which `lastIndexOf('/') + 1` would
		// turn into an empty string — strip those before taking the basename.
		const entries = await this.workspace.fs.readdir(path);
		return entries
			.map((p) => {
				const trimmed = p.replace(/\/+$/, '');
				return trimmed.slice(trimmed.lastIndexOf('/') + 1);
			})
			.filter((n) => n.length > 0);
	}

	async exists(path: string): Promise<boolean> {
		return this.workspace.fs.exists(path);
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		if (options?.recursive) {
			// `WorkspaceFS.mkdir` is single-level. Mirage's executor implements
			// `mkdir -p` natively, so shell out for the recursive case.
			const result = await this.runShell(`mkdir -p ${shellQuote(path)}`);
			if (result.exitCode !== 0) {
				throw new Error(
					`[amond:mirage] mkdir -p failed for ${path}: ` +
						(result.stderr || result.stdout || `exit ${result.exitCode}`),
				);
			}
			return;
		}
		await this.workspace.fs.mkdir(path);
	}

	async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
		if (options?.recursive || options?.force) {
			// `WorkspaceFS` has no recursive or forced removal. Mirage's executor
			// implements `rm -r` and `rm -f`, so shell out, as `mkdir -p` does.
			const flags = [options.recursive ? '-r' : '', options.force ? '-f' : ''].filter(Boolean);
			const result = await this.runShell(['rm', ...flags, '--', shellQuote(path)].join(' '));
			if (result.exitCode !== 0) {
				throw new Error(
					`[amond:mirage] rm failed for ${path}: ` +
						(result.stderr || result.stdout || `exit ${result.exitCode}`),
				);
			}
			return;
		}
		// `stat` follows symlinks, so check for a link first: removing a link
		// to a directory unlinks the link and leaves its target alone.
		// Only EINVAL (not a link) and ENOENT (missing; `stat` reports it) mean
		// "not a link"; any other `readlink` failure is rethrown.
		const isLink = await this.workspace.fs.readlink(path).then(
			() => true,
			(err: { code?: string }) => {
				if (err?.code === 'EINVAL' || err?.code === 'ENOENT') return false;
				throw err;
			},
		);
		if (isLink) {
			await this.workspace.fs.unlink(path);
			return;
		}
		// Dispatch by type so a failed file removal reports its own reason
		// instead of the `rmdir` error. A missing path surfaces the stat error.
		const s = await this.workspace.fs.stat(path);
		if (s.type === 'directory') {
			await this.workspace.fs.rmdir(path);
		} else {
			await this.workspace.fs.unlink(path);
		}
	}

	async exec(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeoutMs?: number;
			signal?: AbortSignal;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return this.runShell(command, options);
	}

	private async runShell(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeoutMs?: number;
			signal?: AbortSignal;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		// Build the AbortSignal: prefer the caller's signal, fall back to a
		// timeout-derived one, or compose both if both are set.
		const timeoutSignal =
			typeof options?.timeoutMs === 'number'
				? AbortSignal.timeout(options.timeoutMs)
				: undefined;
		const callerSignal = options?.signal;
		const signal =
			callerSignal && timeoutSignal
				? AbortSignal.any([callerSignal, timeoutSignal])
				: (callerSignal ?? timeoutSignal);

		try {
			const result = await this.workspace.execute(command, {
				sessionId: this.amondContextId,
				cwd: options?.cwd,
				env: options?.env,
				signal,
			});
			return {
				stdout: result.stdoutText,
				stderr: result.stderrText,
				exitCode: result.exitCode,
			};
		} catch (err) {
			// If the caller's signal fired, rethrow so the host abort wins.
			if (callerSignal?.aborted) throw err;
			const isTimeout =
				timeoutSignal?.aborted &&
				(err === timeoutSignal.reason ||
					(err instanceof Error &&
						(err.name === 'AbortError' || err.name === 'TimeoutError')));
			if (isTimeout) {
				return {
					stdout: '',
					stderr: `[amond:mirage] Command timed out after ${options?.timeoutMs} milliseconds.`,
					exitCode: 124,
				};
			}
			throw err;
		}
	}
}

/**
 * Create an amond sandbox factory from an initialized Mirage Workspace.
 * The user owns the root lifecycle; amond wraps it into a Sandbox
 * for agent use.
 */
export function mirage(
	workspace: MirageWorkspace,
	options?: MirageAdapterOptions,
): SandboxFactory {
	return {
		async createSandbox({ id }: { id: string }): Promise<Sandbox> {
			// Map this amond context to a Mirage session so cwd, env, history,
			// and lastExitCode stay isolated across contexts sharing the same
			// Workspace. createSession throws on duplicate ids, so fall back to
			// getSession if the id is already registered (e.g. another harness
			// in this context or a context resumed after a reload).
			try {
				workspace.createSession(id);
			} catch {
				workspace.getSession(id);
			}

			// Mirage workspaces are mount-rooted at `/`. `/` is a safe no-op
			// default; pin via `options.cwd` to default to a specific writable
			// mount (e.g. `/data`).
			const sandboxCwd = options?.cwd ?? '/';
			const driver = new MirageSandboxDriver(workspace, id);
			return sandboxFromDriver(driver, sandboxCwd);
		},
	};
}
```

## Required dependencies

Pick the runtime package that matches the user's amond build target. If
you can't tell which target they're on, check `vite.config.ts` for the
`cloudflare()` plugin alongside `amond()`, check `amond.config.ts` for
`target: 'cloudflare'`, and look for a `wrangler.jsonc` (or `.toml` /
`.json`) at the project root. If still unclear, ask.

For the Node target:

```bash
npm install @struktoai/mirage-node@^0.0.6 @struktoai/mirage-core@0.0.6
```

For the Cloudflare target:

```bash
npm install @struktoai/mirage-browser@^0.0.6 @struktoai/mirage-core@0.0.6
```

The adapter imports types from `@struktoai/mirage-core`, so install it as a
direct dependency. Both runtime packages pin it to their own exact version
(`^0.0.6` resolves to `0.0.6`, which pins core `0.0.6`); keep the two versions
identical. Without a direct dependency, pnpm's strict layout and Yarn PnP fail
the typecheck with TS2307.

(Use the user's package manager — `pnpm add`, `yarn add`, etc. if their
lockfile indicates a different one.)

## Authentication

**Mirage itself has no API key.** It runs in-process — there's no remote
service to authenticate against.

Authentication is per-mounted-resource. Each backend the user mounts
(`S3Resource`, `SlackResource`, `GitHubResource`, `PostgresResource`, …)
has its own credentials, configured when the user constructs the resource
in their own agent code. The adapter never touches them.

**Never invent values for any of these credentials** — they must come from
the user. Mirage's docs have a per-resource setup guide for every
supported backend at
`https://docs.mirage.strukto.ai/typescript/setup/<resource>` (e.g.
`…/setup/s3`, `…/setup/slack`).

Use the project's existing conventions (`AGENTS.md`, `.env`, `.dev.vars`,
a secret manager, CI vars) for storing whatever credentials the mounted
resources need. If nothing in the project gives you a clear signal, ask
the user.

For reference: `amond run` loads the project's `.env` by default, and
`--env <file>` selects one alternate `.env`-format file. `vite dev` and the
built server read the shell environment (`process.env`).

## Wiring it into an agent

Here's what using this adapter looks like inside an amond agent. If the
user is already working on an agent that this adapter is meant to plug
into, you can finish that work by wiring the adapter into it. Otherwise,
share this snippet so they can wire it up themselves.

```ts
'use agent';
import { Workspace, RAMResource, MountMode } from '@struktoai/mirage-node';
import { useModel, useSandbox } from '@amond-ai/agent';
import { mirage } from '../sandboxes/mirage'; // adjust path to match the user's layout

export function Assistant() {
	useModel('anthropic/claude-sonnet-4-6');
	const ws = new Workspace({ '/data': new RAMResource() }, { mode: MountMode.WRITE });
	useSandbox(mirage(ws, { cwd: '/data' }));
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
3. Tell the user the next steps: install `@struktoai/mirage-node` or
   `@struktoai/mirage-browser` (whichever matches their target), make sure
   any credentials for resources they mount are available at runtime (per
   the Authentication section above), and run
   `amond run <path-to-the-agent-module> --message "..."` (or `vite dev`
   for the full application) to try it.

When updating an existing integration, inspect and compare it against this complete current blueprint, apply every relevant change while preserving customizations, and then add or update the marker in the primary marked file. This comparison is required when the marker is missing.

## Upgrade Guide

### Version 1 — 2026-06-14

Initial version.

### Version 2 — 2026-10-20

Fix the install steps, `readdir` and `rm`. The adapter imports types from `@struktoai/mirage-core`, which arrived only transitively, so a strict layout (pnpm, Yarn PnP) failed the typecheck. `readdir` dropped entries that end in `/`. `rm` ignored the sandbox contract for an adapter that already shells out, and its `unlink`-then-`rmdir` fallback hid the file's own failure.

In the generated file, `readdir` strips trailing slashes before taking the basename. `rm` with `recursive` or `force` now runs `rm [-r] [-f] --` through the shell and throws on a non-zero exit. A plain `rm` unlinks a symlink (`readlink` succeeds; `readlink` errors other than `EINVAL` and `ENOENT` are rethrown), and otherwise calls `stat` and dispatches to `rmdir` or `unlink` by type. The `SandboxOperationUnsupportedError` import is gone.

Install `@struktoai/mirage-core` as a direct dependency, at the runtime package's exact version. Move the install to 0.0.6, the version the adapter type-checks against (`^0.0.2` resolved to exactly 0.0.2, whose types fail the `stat` comparison), and add core at the same exact version: change the install command to `npm install @struktoai/mirage-node@^0.0.6 @struktoai/mirage-core@0.0.6`, or `npm install @struktoai/mirage-browser@^0.0.6 @struktoai/mirage-core@0.0.6` for the Cloudflare target. With another package manager, add the same two packages.

```diff
--- a/src/sandboxes/mirage.ts
+++ b/src/sandboxes/mirage.ts
@@ -1,4 +1,4 @@
-// amond-blueprint: sandbox/mirage@1
+// amond-blueprint: sandbox/mirage@2
 /**
  * Mirage adapter for amond.
  *
@@ -22,7 +22,7 @@
  * }
  * ```
  */
-import { sandboxFromDriver, SandboxOperationUnsupportedError } from '@amond-ai/agent';
+import { sandboxFromDriver } from '@amond-ai/agent';
 import type { SandboxDriver, SandboxFactory, Sandbox, FileStat } from '@amond-ai/agent';
 import type { Workspace as MirageWorkspace } from '@struktoai/mirage-core';
 
@@ -56,8 +56,9 @@
  * Filesystem operations route through `workspace.fs.*` (Mirage's direct
  * VFS API) for read/write/readdir/stat/exists/single-level mkdir.
  * Recursive `mkdir -p` shells out via `workspace.execute()` because
- * `WorkspaceFS` exposes only single-level `mkdir`. Removal stays on the
- * filesystem API and rejects unsupported recursive/force options.
+ * `WorkspaceFS` exposes only single-level `mkdir`. Removal with `recursive`
+ * or `force` shells out the same way (`rm [-r] [-f] --`); plain removal
+ * stays on the filesystem API.
  *
  * `cwd`, `env`, and `signal` (including `AbortSignal.timeout(...)`) all
  * pass directly through to `ExecuteOptions` — Mirage runs each call in an
@@ -102,9 +103,14 @@
 	async readdir(path: string): Promise<string[]> {
 		// Mirage returns absolute paths; some implementations include a
 		// trailing `/` for directories, which `lastIndexOf('/') + 1` would
-		// turn into an empty string — strip those.
+		// turn into an empty string — strip those before taking the basename.
 		const entries = await this.workspace.fs.readdir(path);
-		return entries.map((p) => p.slice(p.lastIndexOf('/') + 1)).filter((n) => n.length > 0);
+		return entries
+			.map((p) => {
+				const trimmed = p.replace(/\/+$/, '');
+				return trimmed.slice(trimmed.lastIndexOf('/') + 1);
+			})
+			.filter((n) => n.length > 0);
 	}
 
 	async exists(path: string): Promise<boolean> {
@@ -128,21 +134,26 @@
 	}
 
 	async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
-		const unsupported = [
-			options?.recursive ? 'recursive' : undefined,
-			options?.force ? 'force' : undefined,
-		].filter((option): option is string => option !== undefined);
-		if (unsupported.length > 0) {
-			throw new SandboxOperationUnsupportedError({
-				operation: 'rm',
-				provider: 'Mirage',
-				options: unsupported,
-			});
+		if (options?.recursive || options?.force) {
+			// `WorkspaceFS` has no recursive or forced removal. Mirage's executor
+			// implements `rm -r` and `rm -f`, so shell out, as `mkdir -p` does.
+			const flags = [options.recursive ? '-r' : '', options.force ? '-f' : ''].filter(Boolean);
+			const result = await this.runShell(['rm', ...flags, '--', shellQuote(path)].join(' '));
+			if (result.exitCode !== 0) {
+				throw new Error(
+					`[amond:mirage] rm failed for ${path}: ` +
+						(result.stderr || result.stdout || `exit ${result.exitCode}`),
+				);
+			}
+			return;
 		}
-		try {
-			await this.workspace.fs.unlink(path);
-		} catch {
+		// `stat` follows symlinks, so check for a link first: removing a link
+		// to a directory unlinks the link and leaves its target alone.
+		// Only EINVAL (not a link) and ENOENT (missing; `stat` reports it) mean
+		// "not a link"; any other `readlink` failure is rethrown.
+		const isLink = await this.workspace.fs.readlink(path).then(
+			() => true,
+			(err: { code?: string }) => {
+				if (err?.code === 'EINVAL' || err?.code === 'ENOENT') return false;
+				throw err;
+			},
+		);
+		if (isLink) {
+			await this.workspace.fs.unlink(path);
+			return;
+		}
+		// Dispatch by type so a failed file removal reports its own reason
+		// instead of the `rmdir` error. A missing path surfaces the stat error.
+		const s = await this.workspace.fs.stat(path);
+		if (s.type === 'directory') {
 			await this.workspace.fs.rmdir(path);
+		} else {
+			await this.workspace.fs.unlink(path);
 		}
 	}
 
```
