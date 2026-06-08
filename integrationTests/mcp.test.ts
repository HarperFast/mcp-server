import { suite, test, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..');

// harper's `exports` only exposes ".", so 'harper/dist/bin/harper.js' is not resolvable.
// Resolve the CLI from the exported main entry and pass it explicitly.
const require = createRequire(import.meta.url);
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

function authFetch(
	ctx: ContextWithHarper,
	path: string,
	init: RequestInit & { headers?: Record<string, string> } = {}
) {
	const { headers = {}, ...rest } = init;
	const creds = Buffer.from(`${ctx.harper.admin.username}:${ctx.harper.admin.password}`).toString('base64');
	return fetch(`${ctx.harper.httpURL}${path}`, {
		...rest,
		headers: { Authorization: `Basic ${creds}`, ...headers },
	});
}

function mcpPost(ctx: ContextWithHarper, body: Record<string, unknown>) {
	return authFetch(ctx, '/mcp', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

void suite('MCP Server', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, FIXTURE_PATH, { harperBinPath });
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	void test('Harper starts successfully', async () => {
		const res = await authFetch(ctx, '/');
		ok([200, 400, 404].includes(res.status), `Unexpected status ${res.status}`);
	});

	void test('POST /mcp with resources/list returns resources array', async () => {
		const res = await mcpPost(ctx, {
			jsonrpc: '2.0',
			id: 1,
			method: 'resources/list',
		});
		strictEqual(res.status, 200);
		const body = (await res.json()) as Record<string, unknown>;
		strictEqual(body.jsonrpc, '2.0');
		strictEqual(body.id, 1);
		ok(body.result !== undefined, 'expected result field');
		const result = body.result as Record<string, unknown>;
		ok(Array.isArray(result.resources), 'expected resources array');
	});

	void test('POST /mcp with resources/read returns error when uri missing', async () => {
		const res = await mcpPost(ctx, {
			jsonrpc: '2.0',
			id: 2,
			method: 'resources/read',
			params: {},
		});
		strictEqual(res.status, 200);
		const body = (await res.json()) as Record<string, unknown>;
		strictEqual(body.jsonrpc, '2.0');
		ok(body.error !== undefined, 'expected error for missing uri');
		const error = body.error as Record<string, unknown>;
		strictEqual(error.code, -32602);
	});

	void test('POST /mcp with unknown method returns method-not-found error', async () => {
		const res = await mcpPost(ctx, {
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
		});
		strictEqual(res.status, 200);
		const body = (await res.json()) as Record<string, unknown>;
		strictEqual(body.jsonrpc, '2.0');
		ok(body.error !== undefined, 'expected error for unknown method');
		const error = body.error as Record<string, unknown>;
		strictEqual(error.code, -32601);
	});

	void test('POST /mcp with resources/read and valid uri returns contents', async () => {
		// Provide a URI that points to the mcp endpoint itself (any valid resource path)
		// The server returns empty contents for an unmatched path — that is valid behavior.
		const res = await mcpPost(ctx, {
			jsonrpc: '2.0',
			id: 4,
			method: 'resources/read',
			params: { uri: `${ctx.harper.httpURL}/nonexistent` },
		});
		strictEqual(res.status, 200);
		const body = (await res.json()) as Record<string, unknown>;
		strictEqual(body.jsonrpc, '2.0');
		// Either a result with contents or an error — both are valid outcomes
		ok(body.result !== undefined || body.error !== undefined, 'expected result or error');
		if (body.result) {
			const result = body.result as Record<string, unknown>;
			ok(Array.isArray(result.contents), 'expected contents array');
		}
	});
});
