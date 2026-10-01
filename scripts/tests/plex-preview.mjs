import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
	entryPoints: ['lib/player/plex-preview.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { plexPreviewURL, PlexPreviewCache } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const parts = [
	{ start: 0, duration: 12, url: '/media/a/parts/1/file' },
	{ start: 12, duration: 8, url: '/media/a/parts/2/file' }
];
assert.equal(plexPreviewURL('/be', parts, 11.999, 20), '/be/media/a/parts/1/preview/2.jpg');
assert.equal(plexPreviewURL('/be', parts, 12, 20), '/be/media/a/parts/2/preview/0.jpg');
assert.equal(plexPreviewURL('/be/', parts, 20, 20), '/be/media/a/parts/2/preview/1.jpg');
assert.equal(plexPreviewURL('/be', parts, -100, 20), '/be/media/a/parts/1/preview/0.jpg');
assert.equal(plexPreviewURL('/be', parts, NaN, 20), null);
assert.equal(plexPreviewURL('/be', parts, 0, Infinity), null);
assert.equal(plexPreviewURL('/be', [], 0, 20), null);
const fetchOriginal = globalThis.fetch,
	createOriginal = URL.createObjectURL,
	revokeOriginal = URL.revokeObjectURL,
	nowOriginal = Date.now;
let requests = 0,
	created = 0,
	now = 0;
const revoked = [];
URL.createObjectURL = () => `blob:test-${++created}`;
URL.revokeObjectURL = (url) => revoked.push(url);
Date.now = () => now;
globalThis.fetch = async (_, options) => {
	requests++;
	assert.equal(options.credentials, 'include');
	assert.equal(options.cache, 'no-store');
	return new Response(new Blob(['preview'], { type: 'image/jpeg' }));
};
try {
	const cache = new PlexPreviewCache(),
		signal = new AbortController().signal;
	const first = await cache.load('0', signal);
	assert.equal(await cache.load('0', signal), first);
	assert.equal(requests, 1);
	for (let i = 1; i < 65; i++) await cache.load(String(i), signal);
	assert.equal(cache.get('0'), null);
	assert.deepEqual(revoked, [first]);
	now += 300_001;
	assert.equal(cache.get('64'), null);
	cache.dispose();
	assert.equal(revoked.length, created);
	assert.equal(await cache.load('new', signal), null);
	let complete;
	globalThis.fetch = () =>
		new Promise((resolve) => {
			complete = resolve;
		});
	const lateCache = new PlexPreviewCache(),
		controller = new AbortController();
	const pending = lateCache.load('late', controller.signal);
	controller.abort();
	lateCache.dispose();
	complete(new Response(new Blob(['preview'], { type: 'image/jpeg' })));
	assert.equal(await pending, null);
	assert.equal(revoked.length, created, 'cancelled request created an orphaned blob URL');
	let failures = 0;
	globalThis.fetch = async () => {
		failures++;
		return new Response('', { status: 503 });
	};
	const offline = new PlexPreviewCache();
	for (let i = 0; i < 100; i++) assert.equal(await offline.load(String(i), signal), null);
	assert.equal(failures, 1, 'failure cooldown must prevent a request storm');
	now += 5001;
	await offline.load('retry', signal);
	assert.equal(failures, 2);
	offline.dispose();
} finally {
	globalThis.fetch = fetchOriginal;
	URL.createObjectURL = createOriginal;
	URL.revokeObjectURL = revokeOriginal;
	Date.now = nowOriginal;
}
console.log(
	'Plex preview: multipart/end boundaries, authenticated fetches, bounded LRU, expiry, disposal, cancellation and failure cooldown passed'
);
