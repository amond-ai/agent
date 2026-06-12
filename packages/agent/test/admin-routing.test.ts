import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryRunStore } from '../src/node/run-store.ts';
import { admin } from '../src/runtime/admin-app.ts';
import { configureFlueRuntime, resetFlueRuntimeForTests } from '../src/runtime/flue-app.ts';

afterEach(() => {
	resetFlueRuntimeForTests();
});

describe('admin()', () => {
	it('describes only read-only deployment inspection routes when the mounted admin app serves openapi.json', async () => {
		configureFlueRuntime({
			target: 'node',
			runtimeVersion: '9.9.9',
			manifest: { agents: [] },
		});
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(new Request('http://localhost/inspection/openapi.json'));

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			info: { title: string; version: string };
			paths: Record<string, Record<string, unknown>>;
		};
		expect(body.info).toMatchObject({ title: 'Flue Admin API', version: '9.9.9' });
		expect(Object.keys(body.paths)).toHaveLength(3);
		expect(body.paths).toMatchObject({
			'/agents': { get: expect.any(Object) },
			'/runs': { get: expect.any(Object) },
			'/runs/{runId}': { get: expect.any(Object) },
		});
		expect(Object.keys(body.paths['/agents'] ?? {})).toEqual(['get']);
		expect(Object.keys(body.paths['/runs'] ?? {})).toEqual(['get']);
		expect(Object.keys(body.paths['/runs/{runId}'] ?? {})).toEqual(['get']);
		expect(body.paths['/agents']).toMatchObject({
			get: {
				responses: {
					200: {
						description: 'Unpaginated list of built agents.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['items'],
									properties: { items: { type: 'array' } },
								},
							},
						},
					},
				},
			},
		});
		expect(body.paths['/agents']).not.toHaveProperty('get.parameters');
		expect(body.paths['/agents']).not.toHaveProperty(
			'get.responses.200.content.application/json.schema.properties.nextCursor',
		);
		expect(body.paths['/runs']).toMatchObject({
			get: {
				responses: {
					200: {
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['items'],
									properties: { items: { type: 'array' } },
								},
							},
						},
					},
				},
			},
		});
		expect(body.paths['/runs/{runId}']).toMatchObject({
			get: {
				responses: {
					200: {
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['runId', 'workflowName', 'status', 'startedAt'],
								},
							},
						},
					},
				},
			},
		});
	});

	it('lists built agents when the mounted admin app receives an agents request', async () => {
		configureFlueRuntime({
			target: 'node',
			manifest: {
				agents: [
				{ name: 'support', transports: { http: true }, created: true },
					{ name: 'offline', transports: {}, created: false },
				],
			},
		});
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(new Request('http://localhost/inspection/agents'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			items: [
				{ name: 'support', transports: { http: true }, created: true },
				{ name: 'offline', transports: {}, created: false },
			],
		});
	});

	it('lists workflow run pointers when the mounted admin app receives a runs request', async () => {
		const runStore = new InMemoryRunStore();
		await runStore.createRun({
			runId: 'run_01DAILYREPORT',
			workflowName: 'daily-report',
			startedAt: '2026-06-01T10:00:00.000Z',
			payload: { report: 'weekly' },
		});
		await runStore.endRun({
			runId: 'run_01DAILYREPORT',
			endedAt: '2026-06-01T10:05:00.000Z',
			durationMs: 300_000,
			isError: false,
			result: { delivered: true },
		});
		configureFlueRuntime({ target: 'node', manifest: { agents: [] }, runStore });
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(new Request('http://localhost/inspection/runs'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			items: [
				{
					runId: 'run_01DAILYREPORT',
					workflowName: 'daily-report',
					status: 'completed',
					startedAt: '2026-06-01T10:00:00.000Z',
					endedAt: '2026-06-01T10:05:00.000Z',
					durationMs: 300_000,
					isError: false,
				},
			],
		});
	});

	it('forwards cursor limit status and workflow filters when the mounted admin app lists runs', async () => {
		const runStore = new InMemoryRunStore();
		const listRuns = vi.spyOn(runStore, 'listRuns');
		configureFlueRuntime({ target: 'node', manifest: { agents: [] }, runStore });
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(
			new Request(
				'http://localhost/inspection/runs?cursor=next%20page%2F%3F&limit=25&status=errored&workflowName=daily%20report%2Fsummary',
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ items: [] });
		expect(listRuns).toHaveBeenCalledOnce();
		expect(listRuns).toHaveBeenCalledWith({
			cursor: 'next page/?',
			limit: 25,
			status: 'errored',
			workflowName: 'daily report/summary',
		});
	});

	it('resolves a workflow run record when the mounted admin app receives a run detail request', async () => {
		const runStore = new InMemoryRunStore();
		await runStore.createRun({
			runId: 'run_01DAILYREPORT',
			workflowName: 'daily-report',
			startedAt: '2026-06-01T10:00:00.000Z',
			payload: { report: 'weekly' },
		});
		await runStore.endRun({
			runId: 'run_01DAILYREPORT',
			endedAt: '2026-06-01T10:05:00.000Z',
			durationMs: 300_000,
			isError: false,
			result: { delivered: true },
		});
		configureFlueRuntime({ target: 'node', manifest: { agents: [] }, runStore });
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(
			new Request('http://localhost/inspection/runs/run_01DAILYREPORT'),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			runId: 'run_01DAILYREPORT',
			workflowName: 'daily-report',
			status: 'completed',
			startedAt: '2026-06-01T10:00:00.000Z',
			payload: { report: 'weekly' },
			endedAt: '2026-06-01T10:05:00.000Z',
			isError: false,
			durationMs: 300_000,
			result: { delivered: true },
		});
	});

	it('forwards Cloudflare admin run detail requests through the internal metadata path', async () => {
		const runIndex = new InMemoryRunStore();
		await runIndex.createRun({
			runId: 'run_01DAILYREPORT',
			workflowName: 'daily-report',
			startedAt: '2026-06-01T10:00:00.000Z',
			payload: {},
		});
		const routeRunRequest = vi.fn(async (request: Request) => {
			expect(new URL(request.url).pathname).toBe('/__flue/internal/run-metadata');
			return Response.json({ runId: 'run_01DAILYREPORT', status: 'completed' });
		});
		configureFlueRuntime({
			target: 'cloudflare',
			manifest: { agents: [] },
			createRunIndexForRequest: () => runIndex,
			routeRunRequest,
		});
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(
			new Request('http://localhost/inspection/runs/run_01DAILYREPORT'),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ runId: 'run_01DAILYREPORT', status: 'completed' });
		expect(routeRunRequest).toHaveBeenCalledOnce();
	});

	it('rejects run listing when the runtime has no run store', async () => {
		configureFlueRuntime({ target: 'node', manifest: { agents: [] } });
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(new Request('http://localhost/inspection/runs'));

		expect(response.status).toBe(501);
		expect(await response.json()).toEqual({
			error: {
				type: 'run_store_unavailable',
				message: 'Run history is not available in this runtime.',
				details:
					'This endpoint requires the generated runtime to be configured with a run store.',
			},
		});
	});

	it('rejects run detail lookup when the runtime has no run store', async () => {
		configureFlueRuntime({ target: 'node', manifest: { agents: [] } });
		const app = new Hono();
		app.route('/inspection', admin());

		const response = await app.fetch(
			new Request('http://localhost/inspection/runs/run_01DAILYREPORT'),
		);

		expect(response.status).toBe(501);
		expect(await response.json()).toEqual({
			error: {
				type: 'run_store_unavailable',
				message: 'Run history is not available in this runtime.',
				details:
					'This endpoint requires the generated runtime to be configured with a run store.',
			},
		});
	});
});
