# Upstream reports and outcomes for #37

This file holds two things. The first is a set of draft issue reports for Flue (github.com/withastro/flue), one per affected blueprint file. The user files them. The second is the outcome table for issue #37, which the lead posts there. Nothing in this file has been posted anywhere.

Every line number in the reports is a line in Flue's `blueprints/` directory at the commit amond imported (`deee93b`, the copy under `vendor/flue/blueprints/`). The reports use Flue's names (`@flue/runtime`, `flue-blueprint:`, `[flue:…]`), not amond's.

## Reports for Flue

### blueprints/sandbox--exedev.md

**Title:** exe.dev blueprint: failed `cwd` runs the command anyway, and several failures are reported as success

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). Each one is in `blueprints/sandbox--exedev.md` as shipped at v2.3.0. Proposed fixes are below.

**1. A failed `cd` does not stop the command (line 695, env prefix at 689-692).**
`exec` builds `export A=…; export B=…; <cmd>` and then prepends `cd '<cwd>' && `. The `;` ends the `&&` list, so a failed `cd` skips only the first `export`. The rest runs in the wrong directory and the exit code is the command's. The same happens with only `cwd` set and a multi-statement command: `echo a; echo b` prints `b`.

Reproduction (the exact string the adapter builds, run in bash):

```bash
bash -c "cd '/no/such/dir' && export A='1'; export B='2'; echo still-ran"
# prints "still-ran", exit 0
bash -c "cd '/no/such/dir' && echo a; echo b"
# prints "b"
```

Fix: wrap the env prefix and the command in a brace group, with the braces on their own lines so a trailing `# comment` or `&` cannot swallow the closing brace.

```diff
-      cmd = `cd '${shellEscape(options.cwd)}' && ${cmd}`;
+      // Group the env prefix and the command so a failed `cd` skips all of
+      // it. The braces sit on their own lines so a trailing `# comment` or
+      // `&` in the command cannot swallow the closing brace.
+      cmd = `cd '${shellEscape(options.cwd)}' && {\n${cmd}\n}`;
```

**2. Recursive `mkdir` ignores failure (line 645).**
`mkdir(path, { recursive: true })` awaits `this.exec('mkdir -p …')` and discards the result, so it resolves when the command fails. The non-recursive branch (line 650) rejects.

Reproduction: with a sandbox from `exedev(vm).createSandbox()`, run `await sandbox.mkdir('/proc/nope/x', { recursive: true })`. It resolves, although `mkdir -p /proc/nope/x` exits 1 on the VM.

Fix: throw on a non-zero exit code, as `sandbox--mirage.md` already does for `mkdir -p`.

```diff
-      await this.exec(`mkdir -p '${shellEscape(dirPath)}'`);
+      const result = await this.exec(`mkdir -p '${shellEscape(dirPath)}'`);
+      if (result.exitCode !== 0) {
+        throw new Error(
+          `[flue:exedev] mkdir -p failed for ${dirPath}: ` +
+            (result.stderr || result.stdout || `exit ${result.exitCode}`),
+        );
+      }
```

**3. A channel that closes without an exit status is reported as exit 0 (line 737, listener type at line 453).**
`finish({ …, exitCode: code ?? 0 })` turns a missing status into success. In ssh2, a command killed by a signal closes the channel as `close(null, signal)`, and a channel that closes with no status gives `close(undefined)` (ssh2 `lib/utils.js:93-102` and `lib/client.js:666-676`). The listener type `(code: number) => void` hides both. The comment at lines 499-503 says a phantom success should not happen.

Reproduction: `await sandbox.exec('kill -9 $$')` on the VM resolves with `exitCode: 0`. Expected: a rejection.

Fix: type the listener as `(code: number | null | undefined, signal?: string)`, remove `?? 0`, and reject unless `code` is a number.

```diff
-  on(event: "close", listener: (code: number) => void): unknown;
+  on(
+    event: "close",
+    listener: (code: number | null | undefined, signal?: string) => void,
+  ): unknown;
```

```diff
-        stream.on("close", (code: number) => {
-          finish({ stdout, stderr, exitCode: code ?? 0 });
+        stream.on("close", (code: number | null | undefined, signal?: string) => {
+          if (settled) return;
+          // No numeric exit status means the command was killed by a signal
+          // (code is null) or the channel closed without one (undefined).
+          // Neither is a success, so reject instead of reporting exit 0.
+          if (typeof code !== "number") {
+            settled = true;
+            if (timer) clearTimeout(timer);
+            reject(
+              new Error(
+                "[flue:exedev] command ended without an exit status" +
+                  (signal ? ` (signal ${signal})` : ""),
+              ),
+            );
+            return;
+          }
+          finish({ stdout, stderr, exitCode: code });
         });
```

**4. The wiring snippets fail `tsc --strict` (lines 858, 883, 907; also the doc comment at line 93).**
`process.env.EXE_VM_HOST` and `process.env.EXE_API_TOKEN` are `string | undefined`, but the option types want `string`. Reproduction: copy the three snippets into a project with `"strict": true` and run `npx tsc --noEmit`. It reports TS2322 three times.

Fix: read the variable first and throw when it is unset.

```diff
-			const vm = await createExeVm({ apiToken: process.env.EXE_API_TOKEN });
+			const apiToken = process.env.EXE_API_TOKEN;
+			if (!apiToken) throw new Error("EXE_API_TOKEN is required");
+			const vm = await createExeVm({ apiToken });
```

The same pattern fixes `host` (`EXE_VM_HOST`) at line 858 and the `cloneExeVm` snippet at line 907.

On our side we bumped the blueprint to `version: 2`, updated the `flue-blueprint: sandbox/exedev@…` marker, and added a `### Version 2` Upgrade Guide entry with these changes. Happy to send a PR if that helps.

### blueprints/sandbox--cloudflare.md

**Title:** Cloudflare Sandbox blueprint: Dockerfile tag disagrees with the install step, and the agent example imports a file no step creates

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). Both are in `blueprints/sandbox--cloudflare.md` as shipped at v2.3.0.

**1. The Dockerfile example pins `0.9.2` (line 119, note at line 122).**
Step 1 installs `@cloudflare/sandbox@^0.11.0` (line 80), which resolves to 0.11.0, and the image tag `cloudflare/sandbox:0.11.0` exists. The example pins `0.9.2`, which breaks the hard rule at lines 249-251 (the tag must match the installed package).

Reproduction:

```bash
grep -n '0\.9\.2\|0\.11' blueprints/sandbox--cloudflare.md
# line 80: npm install @cloudflare/sandbox@^0.11.0
# line 119: FROM docker.io/cloudflare/sandbox:0.9.2
```

Fix: use `0.11.0` in the Dockerfile and in the replacement note.

```diff
-   FROM docker.io/cloudflare/sandbox:0.9.2
+   FROM docker.io/cloudflare/sandbox:0.11.0
```

**2. The agent example imports `../cloudflare-sandbox`, which no step creates (line 137, explanation at lines 129-133 and 146-150).**
The hard rules (lines 241-243, and the sentence at line 150) say no project-owned adapter file is needed, yet the example imports `cloudflareSandboxFactory` from one. Lines 129-133 also say there is no stable API to reach platform `env` from the agent body. Your docs show one: `apps/docs/src/content/docs/ecosystem/sandboxes/cloudflare.mdx:36-52` imports `env` from `cloudflare:workers` and takes the agent id from `AgentProps`.

Reproduction:

```bash
grep -n "cloudflare-sandbox'" blueprints/sandbox--cloudflare.md   # 1 match, line 137
grep -c 'cloudflare:workers' blueprints/sandbox--cloudflare.md    # 0
```

Fix: replace the example and the stand-in paragraph with the wiring from the docs page.

```diff
 'use agent';
+import { env } from 'cloudflare:workers';
-import { useModel, useSandbox } from '@flue/runtime';
-import { cloudflareSandboxFactory } from '../cloudflare-sandbox';
+import { type AgentProps, useModel, useSandbox } from '@flue/runtime';
+import { cloudflareSandbox } from '@flue/runtime/cloudflare';
+import { getSandbox } from '@cloudflare/sandbox';
+
+interface Env {
+  Sandbox: DurableObjectNamespace;
+}
 
-export function Assistant() {
+export function Assistant({ id }: AgentProps) {
   useModel('anthropic/claude-opus-4-7');
-  useSandbox(cloudflareSandboxFactory);
+  const { Sandbox } = env as unknown as Env;
+  useSandbox(cloudflareSandbox(getSandbox(Sandbox, id)));
   return 'You are a helpful assistant with a full sandbox.';
 }
```

On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/sandbox--cloudflare-computer.md

**Title:** Cloudflare Computer blueprint: an exec aborted while it is starting is never cancelled

**Body:**

Hi, and thanks for Flue. We found this while importing your blueprints into amond (an Apache-2.0 derivative). It is in `settleExec` in `blueprints/sandbox--cloudflare-computer.md` as shipped at v2.3.0.

**An already-aborted signal never fires the abort listener (lines 238-242).**
`settleExec` registers `signal.addEventListener('abort', onAbort, { once: true })`. If the signal aborts while `exec()` is still starting the run, the event has already fired by the time the listener is added. It never runs, so the call waits for the command to finish on its own and the run is never killed. This adapter returns a `Sandbox` directly, not through `sandboxFromDriver`, so it owns the caller-facing abort.

Reproduction (the DOM `AbortSignal` semantics, runnable in Node):

```ts
const signal = AbortSignal.abort()
signal.addEventListener('abort', () => console.log('fired'), { once: true })
setTimeout(() => console.log('aborted =', signal.aborted), 10)
// prints "aborted = true" and never "fired"
```

Fix: check `signal.aborted` before adding the listener.

```diff
 					const onAbort = () => {
 						void run.kill('SIGKILL').catch(() => {});
 						reject(abortError());
 					};
+					if (signal.aborted) {
+						onAbort();
+						return;
+					}
 					signal.addEventListener('abort', onAbort, { once: true });
```

The existing `finally` still disposes the run. On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/sandbox--mirage.md

**Title:** Mirage blueprint: install pins 0.0.2 and fails type-checking, plus `readdir` and `rm` fixes

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). They are in `blueprints/sandbox--mirage.md` as shipped at v2.3.0.

**1. The install pins `@struktoai/mirage-*` to exactly 0.0.2, and the adapter fails type-checking against it (lines 312 and 318).**
On a `0.0.x` version a caret range is an exact pin, so `^0.0.2` installs 0.0.2. Against 0.0.2's types, the `s.type === 'file'` comparison in `stat` (lines 149-150) fails with TS2367, under every package manager.

Reproduction:

```bash
npm view '@struktoai/mirage-node@^0.0.2' version   # prints only 0.0.2
```

Then extract the adapter, install `@struktoai/mirage-node@0.0.2`, and run `npx tsc --noEmit --strict`. It reports TS2367 at the `stat` comparison. With 0.0.6 it exits 0.

Fix: install 0.0.6, the version we checked the adapter against, with core pinned to the same version (see 2).

```diff
-npm install @struktoai/mirage-node@^0.0.2
+npm install @struktoai/mirage-node@^0.0.6 @struktoai/mirage-core@0.0.6
```

```diff
-npm install @struktoai/mirage-browser@^0.0.2
+npm install @struktoai/mirage-browser@^0.0.6 @struktoai/mirage-core@0.0.6
```

**2. `@struktoai/mirage-core` is imported but never installed directly (line 81).**
`import type { Workspace as MirageWorkspace } from '@struktoai/mirage-core'` resolves only through the runtime package's dependency. Under pnpm (strict) or Yarn PnP, the blueprint's own `tsc` verify step fails with TS2307. npm and bun hoist it, so they pass.

Reproduction: in a pnpm project, install only `@struktoai/mirage-node`, put the import in `a.ts`, and run `npx tsc --noEmit a.ts`.

Fix: add `@struktoai/mirage-core` at the runtime package's exact version to both install commands (see the diff in 1).

**3. `readdir` drops directory entries that end in `/` (lines 158-161).**
The comment says trailing slashes are stripped. The code takes the text after the last `/`, which is the empty string for `/data/sub/`, and the filter then removes the entry. Mirage 0.0.6's `RAMResource` returns no trailing slashes, so only other resources hit this.

Reproduction:

```bash
node -e "console.log(['/data/a.txt','/data/sub/'].map(p=>p.slice(p.lastIndexOf('/')+1)).filter(n=>n.length>0))"
# prints [ 'a.txt' ]; 'sub' is lost
```

Fix: strip trailing slashes before taking the basename.

```diff
-		return entries.map((p) => p.slice(p.lastIndexOf('/') + 1)).filter((n) => n.length > 0);
+		return entries
+			.map((p) => {
+				const trimmed = p.replace(/\/+$/, '');
+				return trimmed.slice(trimmed.lastIndexOf('/') + 1);
+			})
+			.filter((n) => n.length > 0);
```

**4. `rm` ignores the sandbox contract for an adapter that already shells out (lines 184-201).**
`apps/docs/src/content/docs/reference/sandbox-api.md:219` says an adapter that already runs other verbs through the shell implements `recursive` and `force` with `rm` there. This adapter shells out for `mkdir -p` (line 172) but throws `SandboxOperationUnsupportedError` for both flags.

**5. `rm` reports the wrong error for a failed file removal (lines 196-200).**
`unlink` is tried first and any failure falls through to `rmdir`, so an `unlink` EACCES surfaces as the `rmdir` ENOTDIR.

Reproduction for 5: stub `workspace.fs.unlink` to reject with `EACCES` and `workspace.fs.rmdir` to reject with `ENOTDIR`. `rm('/f')` rejects with `ENOTDIR`.

Fix for 4 and 5 together (both rewrite `rm`): shell out when a flag is set and throw on a non-zero exit. Otherwise call `stat` and dispatch to `rmdir` or `unlink` by type. Remove the unused `SandboxOperationUnsupportedError` import (line 79) and update the class doc comment.

```diff
-import { sandboxFromDriver, SandboxOperationUnsupportedError } from '@flue/runtime';
+import { sandboxFromDriver } from '@flue/runtime';
```

```diff
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
+					`[flue:mirage] rm failed for ${path}: ` +
+						(result.stderr || result.stdout || `exit ${result.exitCode}`),
+				);
+			}
+			return;
 		}
-		try {
-			await this.workspace.fs.unlink(path);
-		} catch {
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

We ran Mirage 0.0.6's shell `rm` with `-r`, `-f` and `--` against a real `Workspace`. It follows coreutils exit codes: `-f` on a missing path resolves, `-r` alone on a missing path rejects, and `-f` on a directory without `-r` still errors. On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/tooling--vitest-evals.md

**Title:** vitest-evals blueprint: install is unpinned (0.14+ breaks it), and the harness fails `strict`, uses the wrong port, and asserts on usage the runtime never sets

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). They are in `blueprints/tooling--vitest-evals.md` as shipped at v2.3.0.

**1. The install step does not pin `vitest-evals` (line 19).**
The blueprint was written when 0.13.1 was current. In 0.14.0 and later (latest is 0.17.0) the `SimpleToolCallRecord` export that line 59 imports is gone (TS2305), and run results require `messages`. A fresh install today gets the latest.

Reproduction:

```bash
npm install vitest-evals@0.17.0
# harness.ts: import { createHarness, type SimpleToolCallRecord } from 'vitest-evals';
npx tsc --noEmit    # TS2305: no exported member 'SimpleToolCallRecord'
```

Fix: pin `vitest-evals@^0.13.1` in the install step. We did not port the harness to 0.17. That is a separate change.

**2. The harness does not type-check under `strict` (lines 129-130, 141-146).**
`FlueConversationMessage.metadata` is `Record<string, unknown>`, so `reply?.metadata?.usage` and `.model` are `unknown`. Property access on them gives six TS2339 errors. Reproduction: install `@flue/sdk` and `vitest-evals@0.13.1`, copy the harness, and run `npx tsc --noEmit --strict`.

Fix: declare local `ReplyUsage` and `ReplyModel` types, cast at lines 129-130, and make `cost` optional.

```diff
+interface ReplyUsage {
+  input: number;
+  output: number;
+  totalTokens: number;
+  cost?: { total: number };
+}
+
+interface ReplyModel {
+  provider: string;
+  id: string;
+}
+
 export interface FlueAgentHarnessOptions {
```

```diff
-      const usage = reply?.metadata?.usage;
-      const model = reply?.metadata?.model;
+      const usage = reply?.metadata?.usage as ReplyUsage | undefined;
+      const model = reply?.metadata?.model as ReplyModel | undefined;
```

```diff
-                      metadata: { cost: usage.cost.total },
+                      ...(usage.cost ? { metadata: { cost: usage.cost.total } } : {}),
```

**3. The default agent URL uses port 3583 (line 174).**
Nothing listens on 3583 now. `vite dev` serves on 5173, as `apps/docs/src/content/docs/guide/migration.md:42` says and as the blueprint's own note after the example says. Reproduction: `grep -n 3583 blueprints/tooling--vitest-evals.md`, then run the starter eval against `vite dev`. The connection is refused.

Fix:

```diff
-  agentUrl: process.env.FLUE_AGENT_URL ?? 'http://127.0.0.1:3583/agents/service-status',
+  agentUrl: process.env.FLUE_AGENT_URL ?? 'http://127.0.0.1:5173/agents/service-status',
```

**4. The starter eval asserts on usage the runtime does not set (line 183).**
Per `packages/sdk/src/public/conversation.ts:146-153`, the runtime stamps nothing into message metadata, so `usage` is present only when the agent attaches it. Against an agent that does not, `expect(result.usage.totalTokens).toBeGreaterThan(0)` fails with "actual value must be number or bigint". It is an assertion failure, not a crash. Reproduction: run the starter eval against an agent with no `useResponseFinish` usage metadata.

Fix: assert only when usage is present, and adjust the wording at line 160 and in the Verify step.

```diff
-    expect(result.usage.totalTokens).toBeGreaterThan(0);
+    if (result.usage.totalTokens !== undefined) {
+      expect(result.usage.totalTokens).toBeGreaterThan(0);
+    }
```

On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/sandbox--boxd.md

**Title:** boxd blueprint: the readiness probe has no timeout, and a failed probe is cached forever

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). Both are in `blueprints/sandbox--boxd.md` as shipped at v2.3.0.

**1. A probe that never answers blocks `createSandbox()` forever (line 126).**
`waitForReady` loops `while (Date.now() < deadline)`, but each iteration awaits `box.exec(['true'])` with no timeout. boxd's `exec` arms a timer only when `timeoutMs` is set (`@boxd-sh/sdk` `box.js:176-186`), and your own comment at lines 102-109 says the SDK sets no request deadline. A hung probe therefore never reaches the deadline check.

Reproduction: pass `waitForReady` a `box` whose `exec` returns a promise that never settles, with `readyTimeoutMs: 100`. `createSandbox()` stays pending past 100 ms and never rejects.

Fix: bound each probe by the time left.

```diff
-			const probe = await box.exec(['true']);
+			const probe = await box.exec(['true'], {
+				timeoutMs: Math.max(1, deadline - Date.now()),
+			});
```

**2. A rejected readiness promise is cached (lines 411-412).**
`readyPromise ??= waitForReady(…)` keeps a rejected promise, so after one failed check every later `createSandbox()` rejects with the old error without probing again.

Reproduction: make the first probe fail until the timeout, then make `box.exec` succeed and call `createSandbox()` again. It still rejects, and no new probe is sent.

Fix: clear `readyPromise` on rejection and rethrow.

```diff
 			readyPromise ??= waitForReady(box, options?.readyTimeoutMs ?? 30_000);
-			await readyPromise;
+			try {
+				await readyPromise;
+			} catch (err) {
+				// Do not cache a failed probe: the next call probes again.
+				readyPromise = undefined;
+				throw err;
+			}
```

On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/sandbox--islo.md

**Title:** islo blueprint: env var names are interpolated unchecked, and `writeFile` fails with `spawn E2BIG` above about 98 KB

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). Both are in `blueprints/sandbox--islo.md` as shipped at v2.3.0.

**1. Env var names are interpolated into the remote command raw (lines 107-110).**
`${k}=${q(v)}` quotes the value but not the key. This is hardening only, because the keys come from the developer's own code.

Reproduction (the string `exec` builds for the key `X=1; echo hi; Y`):

```bash
bash -c "X=1; echo hi; Y='v' true"
# prints "hi": the key's text ran as a command
```

Fix: throw unless the key is a valid shell identifier. That also rejects an empty key.

```diff
 		const cd = options?.cwd ? `cd ${q(options.cwd)} && ` : '';
+		for (const k of Object.keys(options?.env ?? {})) {
+			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
+				throw new Error(`[flue:islo] invalid env var name '${k}'`);
+			}
+		}
```

**2. Large `writeFile` payloads fail with `spawn E2BIG` (line 176).**
The whole base64 payload goes into one argument. Linux caps a single argument at 128 KiB, so the largest write that can spawn is 98,196 bytes. Above that, `spawn` throws a bare synchronous `E2BIG` inside the Promise executor (line 132), not a "failed to spawn" error.

Reproduction:

```bash
node -e "console.log(require('child_process').spawnSync('/bin/true', ['x'.repeat(140000)]).error?.code)"
# prints E2BIG
```

Fix: write the payload in base64 chunks of about 64 KB, appended to a temporary file in the sandbox's `/tmp`, then decode it once. Each `exec` then stays under the limit, and a failed write leaves no stray file next to the target. We rejected stdin piping because we could not verify that the islo CLI forwards stdin.

```diff
 import { spawn } from 'node:child_process';
+import { randomUUID } from 'node:crypto';
```

```diff
 const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
+
+/** Base64 characters per `exec`; keeps each argv entry far below Linux's 128 KiB limit. */
+const WRITE_CHUNK_CHARS = 64 * 1024;
```

```diff
-		const r = await this.exec(
-			`mkdir -p "$(dirname ${q(path)})" && printf %s '${b64}' | base64 -d > ${q(path)}`,
-		);
-		if (r.exitCode !== 0) throw new Error(`[flue:islo] writeFile ${path}: ${r.stderr}`);
+		// A single argv entry is capped at 128 KiB on Linux, so append the payload
+		// to a temporary file in chunks (one exec each), then decode it once.
+		const tmp = `/tmp/flue-islo-${randomUUID()}.b64`;
+		const fail = (r: { stderr: string }) =>
+			new Error(`[flue:islo] writeFile ${path}: ${r.stderr}`);
+		let r = await this.exec(`mkdir -p "$(dirname ${q(path)})" && : > ${q(tmp)}`);
+		if (r.exitCode !== 0) throw fail(r);
+		for (let i = 0; i < b64.length && r.exitCode === 0; i += WRITE_CHUNK_CHARS) {
+			r = await this.exec(`printf %s '${b64.slice(i, i + WRITE_CHUNK_CHARS)}' >> ${q(tmp)}`);
+		}
+		if (r.exitCode === 0) r = await this.exec(`base64 -d < ${q(tmp)} > ${q(path)}`);
+		await this.exec(`rm -f ${q(tmp)}`);
+		if (r.exitCode !== 0) throw fail(r);
```

With a local stand-in for the islo CLI, a 200 KB write decoded byte-identical over 8 `exec` calls, and the largest argument was 65,633 bytes. The fix assumes a writable `/tmp` in the sandbox. On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/sandbox--modal.md

**Title:** Modal blueprint: `stat` hides its own error, and a comment promises a BusyBox fallback the code does not have

**Body:**

Hi, and thanks for Flue. We found these while importing your blueprints into amond (an Apache-2.0 derivative). Both are in `blueprints/sandbox--modal.md` as shipped at v2.3.0.

**1. `2>/dev/null` reduces every `stat` failure to `exit 1` (line 244).**
The command ends in `2>/dev/null`, so the error branch at lines 246-251 can only report `exit 1`, never the message from `stat`.

Reproduction:

```bash
stat -c '%F|%s|%Y' /nonexistent 2>/dev/null; echo "exit=$?"   # exit=1, no message
stat -c '%F|%s|%Y' /nonexistent; echo "exit=$?"               # stat: cannot statx '/nonexistent': No such file or directory
```

Fix: remove the redirect.

```diff
 		const result = await this.runShell(
 			'stat',
-			`stat -c '%F|%s|%Y' ${shellQuote(path)} 2>/dev/null`,
+			`stat -c '%F|%s|%Y' ${shellQuote(path)}`,
 		);
```

**2. The `stat` comment promises a fallback the code does not implement (lines 237-241, and the note at line 34).**
The comment says the adapter tries GNU `stat` and then falls back to BusyBox. The code makes one `stat -c` call. We could not check here that BusyBox accepts that exact format, because no BusyBox binary was available to us.

Reproduction: `grep -c "Fall back" blueprints/sandbox--modal.md` prints 1, and `stat` is called once.

Fix: replace the comment with one line that describes the single call, and reword line 34 to match. The comment cites the documented format only; we did not run it on BusyBox.

```diff
-		// Try GNU stat first (works on Debian/Ubuntu/python:3.13-slim).
-		// Fall back to BusyBox stat (Alpine). The format string differs:
-		//   GNU:     %F gives "regular file" / "directory" / "symbolic link"
-		//   BusyBox: %F gives the same words but is positional only with `-c`.
-		// Both implementations accept `stat -c '%F|%s|%Y' <path>`.
+		// One `stat -c '%F|%s|%Y'` call. GNU coreutils and BusyBox both document `-c` with these directives.
```

On our side we bumped the blueprint to `version: 2` and added a `### Version 2` Upgrade Guide entry.

### blueprints/sandbox--daytona.md

**Title:** Daytona blueprint: the two `create` examples disagree

**Body:**

Hi, and thanks for Flue. We found this while importing your blueprints into amond (an Apache-2.0 derivative). It is in `blueprints/sandbox--daytona.md` as shipped at v2.3.0.

**The doc-comment example passes an image, the wiring example does not (line 61 and line 347).**
Line 61 calls `client.create({ image: 'ubuntu:latest' })`. Line 347 calls `client.create()`. The difference matters: `create()` uses the default snapshot, while `{ image: 'ubuntu:latest' }` builds an image on first use (`@daytonaio/sdk` `Daytona.js:255-300`).

Reproduction:

```bash
grep -n 'client.create' blueprints/sandbox--daytona.md
# 61:  const sandbox = await client.create({ image: 'ubuntu:latest' });
# 347: const sandbox = await client.create();
```

Fix: use `client.create()` at line 61.

```diff
- *       const sandbox = await client.create({ image: 'ubuntu:latest' });
+ *       const sandbox = await client.create();
```

The change is in a doc comment and does not change the generated behavior, so we did not bump the version.

### blueprints/sandbox.md

**Title:** Sandbox blueprint: the `'use agent'` wording is stricter than the scanner

**Body:**

Hi, and thanks for Flue. We found this while importing your blueprints into amond (an Apache-2.0 derivative). It is in `blueprints/sandbox.md` as shipped at v2.3.0.

**The text says the directive must be the first statement (lines 86-87).**
It reads "export the capitalized agent function from a module whose first statement is the `'use agent';` directive". The scanner is looser. `findAgentDirectiveStatement` (`packages/vite/src/agent-scan.ts:362-371`) accepts `'use agent'` anywhere in the directive prologue, which ends at the first non-directive statement. A file with another directive before it is valid.

Reproduction:

```ts
'use strict'
'use agent'
import { useModel } from '@flue/runtime'
// accepted by findAgentDirectiveStatement: the prologue is the two directives
```

Fix: describe the directive prologue instead of "first statement".

```diff
-  export the capitalized agent function from a module whose first statement
-  is the `'use agent';` directive.
+  export the capitalized agent function from a module whose directive
+  prologue (everything before the first import or other statement) contains
+  the `'use agent';` directive.
```

This is wording only, so we did not bump the version.

## Outcomes for #37

| Finding | Location | Outcome | Where / Reason |
| --- | --- | --- | --- |
| #1 | `sandbox--exedev.md:695` | Fixed | `sandbox--exedev.md`, v2 |
| #2 | `sandbox--exedev.md:645` | Fixed | `sandbox--exedev.md`, v2 |
| #3 | `sandbox--exedev.md:737` | Fixed | `sandbox--exedev.md`, v2 |
| #4 | `sandbox--exedev.md:858`, also `:883`, `:907` and doc comment `:93` | Fixed | `sandbox--exedev.md`, v2 |
| #5 | `sandbox--cloudflare.md:119` | Fixed | `sandbox--cloudflare.md`, v2 |
| #6 | `sandbox--cloudflare.md:137` | Fixed | `sandbox--cloudflare.md`, v2 |
| #7 | `sandbox--cloudflare-computer.md:238` | Fixed | `sandbox--cloudflare-computer.md`, v2 |
| #8 | `sandbox--mirage.md:81` | Fixed | `sandbox--mirage.md`, v2 |
| #9 | `sandbox--mirage.md:161` | Fixed | `sandbox--mirage.md`, v2 |
| #10 | `sandbox--mirage.md:184-195` | Fixed | `sandbox--mirage.md`, v2 |
| #11 | `sandbox--mirage.md:196-200` | Fixed | `sandbox--mirage.md`, v2 |
| N2 | `sandbox--mirage.md:312,318` (upstream numbering) | Fixed | `sandbox--mirage.md`, v2 |
| #12 | `tooling--vitest-evals.md:140` | Fixed | `tooling--vitest-evals.md`, v2 |
| #13 | `tooling--vitest-evals.md:174` | Fixed | `tooling--vitest-evals.md`, v2 |
| #14 | `tooling--vitest-evals.md:183` | Fixed | `tooling--vitest-evals.md`, v2 |
| N1 | `tooling--vitest-evals.md:19` | Fixed | `tooling--vitest-evals.md`, v2 |
| #15 | `sandbox--daytona.md:226` | Declined | The contract says `exists` must never throw (`packages/cli/docs/reference/sandbox-api.md:116,219`), so rethrowing a 401, a 500 or a connection error would break it. Rethrowing `SandboxDiedError` already follows the separate liveness rule. |
| #16 | `sandbox--daytona.md:61` vs `:347` | Fixed | `sandbox--daytona.md`, text only |
| #17 | `sandbox--boxd.md:126` | Fixed | `sandbox--boxd.md`, v2 |
| #18 | `sandbox--boxd.md:411` | Fixed | `sandbox--boxd.md`, v2 |
| #19 | `sandbox--islo.md:109` | Fixed | `sandbox--islo.md`, v2 |
| #20 | `sandbox--islo.md:176` | Fixed | `sandbox--islo.md`, v2 |
| #21 | `sandbox--modal.md:237-241`, also `:34` | Fixed | `sandbox--modal.md`, v2 (rides #22) |
| #22 | `sandbox--modal.md:244` | Fixed | `sandbox--modal.md`, v2 |
| #23 | `sandbox.md:86-87` | Fixed | `sandbox.md`, text only |

The change record is `apps/registry/CHANGES.md`.
