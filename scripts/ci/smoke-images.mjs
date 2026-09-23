import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const base = process.env.SPARKLE_TEST_URL;
assert.ok(base, 'SPARKLE_TEST_URL is required');
async function get(path, options) {
	const response = await fetch(new URL(path, base), {
		signal: AbortSignal.timeout(15_000),
		...options
	});
	assert.ok(response.ok, `${path}: HTTP ${response.status}`);
	return response;
}

const config = await (await get('/api/runtime-env')).json();
assert.equal(config.backendBaseUrl, '/be');
assert.equal(config.staticBaseUrl, '/static');
const sources = await (await get('/be/library/sources')).json();
assert.ok(
	sources.sources.some((source) => source.id === 'processed' && source.title === 'Encoded')
);
const page = await (await get('/be/library/items?limit=48')).json();
assert.deepEqual(page.items, []);
assert.equal(page.total, 0);
const room = await (
	await get('/be/rooms', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ roomId: 'container-smoke' })
	})
).json();
assert.equal(room.roomId, 'container-smoke');
assert.equal((await (await get('/be/rooms/container-smoke')).json()).roomId, room.roomId);
await get('/');

const head = await get('/static/ci-probe.txt', { method: 'HEAD' });
assert.equal(Number(head.headers.get('content-length')), 32);
const range = await get('/static/ci-probe.txt', { headers: { Range: 'bytes=0-6' } });
assert.equal(range.status, 206);
assert.equal(range.headers.get('content-range'), 'bytes 0-6/32');
assert.equal(await range.text(), 'sparkle');

const manifest = JSON.parse(await readFile('vendor/libmedia/manifest.json', 'utf8'));
for (const file of ['avplayer/avplayer.js', 'truehd.wasm']) {
	const path = file === 'truehd.wasm' ? 'decode/truehd.wasm' : 'avplayer.js';
	const bytes = await (await get(`/vendor/libmedia/${manifest.version}/${path}`)).arrayBuffer();
	assert.equal(
		createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
		manifest.artifacts[file]
	);
}
await get('/vendor/libmedia/jassub/worker.js');
await get('/sw.js');
console.log('Container HTTP, runtime configuration, ranges and pinned player assets passed.');
