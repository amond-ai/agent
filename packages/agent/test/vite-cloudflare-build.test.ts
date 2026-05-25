import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { build, cloudflareViteConfigPath, cloudflareViteInputDir, createCloudflareViteConfig } from '../../cli/src/lib/build.ts';

describe('Cloudflare Vite production Worker', () => {
	it('builds deployable official-plugin output from the production Cloudflare target', async () => {
		const { root, output } = await createGeneratedFixture('build');
		const inputConfig = JSON.parse(fs.readFileSync(cloudflareViteConfigPath(root), 'utf8')) as { main?: string; durable_objects?: { bindings?: Array<{ class_name: string }> } };
		expect(inputConfig.main).toBe('.flue-vite/_entry.ts');
		expect(inputConfig.durable_objects?.bindings?.map((binding) => binding.class_name)).toEqual(expect.arrayContaining(['Assistant', 'SmokeWorkflow', 'FlueRegistry']));
		const outputConfigs = fs.readdirSync(output, { recursive: true }).filter((entry) => String(entry).endsWith('wrangler.json'));
		expect(outputConfigs).not.toHaveLength(0);
		const deployRedirect = JSON.parse(fs.readFileSync(path.join(root, '.wrangler', 'deploy', 'config.json'), 'utf8')) as { configPath?: string };
		expect(deployRedirect.configPath).toContain('wrangler.json');
		expect(deployRedirect.configPath).not.toContain('wrangler.jsonc');
	}, 90000);

	it('serves a deterministic generated workflow through workerd in Vite development', async () => {
		const { root } = await createGeneratedFixture('development');
		const entryPath = path.join(cloudflareViteInputDir(root), '_entry.ts');
		const viteConfig = createCloudflareViteConfig(root, cloudflareViteConfigPath(root), [entryPath], { persistState: false });
		const server = await createServer({
			...viteConfig,
			logLevel: 'silent',
			server: { host: '127.0.0.1', port: 0 },
		});
		try {
			await server.listen();
			const localUrl = server.resolvedUrls?.local[0];
			if (!localUrl) throw new Error('Vite server URL unavailable');
			const response = await fetch(new URL('/workflows/smoke?wait=result', localUrl), { method: 'POST' });
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				result: {
					ok: true,
					reference: { __flueSkillReference: true, name: 'review', description: 'Reviews requested work.' },
					hasBody: false,
					hasFiles: false,
				},
			});
		} finally {
			await server.close();
		}
	}, 90000);
});

async function createGeneratedFixture(mode: 'build' | 'development'): Promise<{ root: string; output: string }> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flue-vite-cloudflare-'));
	const output = path.join(root, 'generated');
	fs.mkdirSync(path.join(root, 'node_modules', '@flue'), { recursive: true });
	fs.symlinkSync(process.cwd(), path.join(root, 'node_modules', '@flue', 'runtime'), 'dir');
	fs.symlinkSync(
		path.resolve(process.cwd(), '../../examples/cloudflare-websocket/node_modules/agents'),
		path.join(root, 'node_modules', 'agents'),
		'dir',
	);
	fs.symlinkSync(path.resolve(process.cwd(), 'node_modules/just-bash'), path.join(root, 'node_modules', 'just-bash'), 'dir');
	fs.mkdirSync(path.join(root, 'agents'));
	fs.mkdirSync(path.join(root, 'workflows'));
	fs.mkdirSync(path.join(root, 'skills', 'review'), { recursive: true });
	fs.writeFileSync(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'vite-cloudflare-spike', compatibility_date: '2026-04-01', compatibility_flags: ['nodejs_compat'] }));
	fs.writeFileSync(path.join(root, 'skills', 'review', 'SKILL.md'), `---\nname: review\ndescription: Reviews requested work.\n---\nReview it.\n`);
	fs.writeFileSync(path.join(root, 'skills', 'review', 'LICENSE.txt'), 'License terms.\n');
	fs.writeFileSync(path.join(root, 'agents', 'assistant.ts'), `import { createAgent } from '@flue/runtime';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport default createAgent(() => ({ model: false, skills: [review] }));\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'smoke.ts'), `import { http } from '@flue/runtime';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport const channels = [http()];\nexport async function run() { return { ok: true, reference: review, hasBody: 'body' in review, hasFiles: 'files' in review }; }\n`);
	await build({ root, output, target: 'cloudflare', mode });
	return { root, output };
}
