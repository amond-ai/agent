import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../../cli/src/lib/build.ts';
import type { BuildPlugin } from '../../cli/src/lib/types.ts';

const parserOnlyPlugin: BuildPlugin = {
	name: 'parser-only',
	bundle: 'none',
	entryFilename: 'server.mjs',
	generateEntryPoint() {
		return 'export default {};\n';
	},
};

describe('build manifest', () => {
	it('writes attached channel metadata for agents and workflows', async () => {
		const root = createFixtureRoot('flue-manifest-builtins-');
		fs.mkdirSync(path.join(root, 'agents'));
		fs.mkdirSync(path.join(root, 'workflows'));
		fs.writeFileSync(
			path.join(root, 'agents', 'assistant.ts'),
			`import { createAgent, websocket } from '@flue/runtime';\n` +
				`export const channels = [websocket()];\n` +
				`export default createAgent(() => ({ model: false }));\n`,
		);
		fs.writeFileSync(
			path.join(root, 'workflows', 'job.ts'),
			`import { http, websocket } from '@flue/runtime';\n` +
				`export const channels = [http(), websocket()];\n` +
				`export async function run() { return { ok: true }; }\n`,
		);

		await build({ root, plugin: parserOnlyPlugin });
		const manifest = readManifest(root);
		expect(manifest).toEqual({
			agents: [{ name: 'assistant', channels: { websocket: true }, receive: false, created: true }],
			workflows: [{ name: 'job', channels: { http: true, websocket: true } }],
		});
	});

	it('records changes to statically declared attached transports', async () => {
		const root = createFixtureRoot('flue-manifest-change-');
		fs.mkdirSync(path.join(root, 'workflows'));
		const workflowPath = path.join(root, 'workflows', 'job.ts');
		fs.writeFileSync(
			workflowPath,
			`import { http } from '@flue/runtime';\nexport const channels = [http()];\nexport async function run() {}\n`,
		);

		await build({ root, plugin: parserOnlyPlugin });
		expect(readManifest(root).workflows[0]?.channels).toEqual({ http: true });
		await expect(build({ root, plugin: parserOnlyPlugin })).resolves.toEqual({ changed: false });

		fs.writeFileSync(
			workflowPath,
			`import { websocket } from '@flue/runtime';\nexport const channels = [websocket()];\nexport async function run() {}\n`,
		);
		await expect(build({ root, plugin: parserOnlyPlugin })).resolves.toEqual({ changed: true });
		expect(readManifest(root).workflows[0]?.channels).toEqual({ websocket: true });
	});

	it('does not execute channel-bearing modules while writing metadata', async () => {
		const root = createFixtureRoot('flue-manifest-static-');
		fs.mkdirSync(path.join(root, 'agents'));
		const markerPath = path.join(root, 'executed.txt');
		fs.writeFileSync(
			path.join(root, 'agents', 'assistant.ts'),
			`import { createAgent, websocket } from '@flue/runtime';\n` +
				`import 'cloudflare:workers';\n` +
				`import { writeFileSync } from 'node:fs';\n` +
				`writeFileSync(${JSON.stringify(markerPath)}, 'ran');\n` +
				`export const channels = [websocket()];\n` +
				`export default createAgent(() => ({ model: false }));\n`,
		);

		await expect(build({ root, plugin: parserOnlyPlugin })).resolves.toEqual({ changed: true });
		expect(readManifest(root).agents[0]?.channels).toEqual({ websocket: true });
		expect(fs.existsSync(markerPath)).toBe(false);
	});
});

function createFixtureRoot(prefix: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	fs.mkdirSync(path.join(root, 'node_modules', '@flue'), { recursive: true });
	fs.symlinkSync(process.cwd(), path.join(root, 'node_modules', '@flue', 'runtime'), 'dir');
	return root;
}

function readManifest(root: string): { agents: Array<{ channels: Record<string, true> }>; workflows: Array<{ channels: Record<string, true> }> } {
	return JSON.parse(fs.readFileSync(path.join(root, 'dist', 'manifest.json'), 'utf-8'));
}
