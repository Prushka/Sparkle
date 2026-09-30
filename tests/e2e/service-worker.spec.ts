import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test.use({ serviceWorkers: 'allow' });

type Asset = { body: string; headers?: Record<string, string>; revision?: string; size?: number };
let server: Server;
let origin: string;
let assets: Record<string, Asset>;
let counts: Record<string, number>;
let worker: string;
const metadata = (asset: Asset) => ({
	revision: asset.revision ?? createHash('sha256').update(asset.body).digest('hex'),
	size: asset.size ?? Buffer.byteLength(asset.body)
});

test.beforeEach(async () => {
	assets = {
		'/offline.html': { body: '<h1>Sparkle is offline</h1>' },
		'/scripts/app.js': { body: 'version-one' },
		'/fonts/font.woff2': { body: 'unchanged-font' },
		'/vendor/libmedia/decoder.wasm': { body: 'decoder-bytes' },
		'/media/emotes/test.webp': { body: 'image-bytes' },
		'/sound/test.mp3': { body: 'sound-bytes' }
	};
	counts = {};
	worker = await readFile('scripts/service-worker.js', 'utf8');
	server = createServer((req, res) => {
		const path = new URL(req.url!, origin).pathname;
		counts[path] = (counts[path] || 0) + 1;
		res.setHeader('Cache-Control', 'no-cache');
		if (path === '/sw.js') {
			res.setHeader('Content-Type', 'application/javascript');
			res.end(worker);
		} else if (path === '/_sparkle/assets.json') {
			res.setHeader('Content-Type', 'application/json');
			res.end(
				JSON.stringify({
					buildId: 'fixture',
					assets: Object.fromEntries(
						Object.entries(assets).map(([url, asset]) => [url, metadata(asset)])
					)
				})
			);
		} else if (assets[path]) {
			res.setHeader(
				'Content-Type',
				path.endsWith('.html') ? 'text/html' : 'application/octet-stream'
			);
			for (const [key, value] of Object.entries(assets[path].headers || {}))
				res.setHeader(key, value);
			if (req.headers.range) res.statusCode = 206;
			res.end(assets[path].body);
		} else {
			res.setHeader('Content-Type', 'text/html');
			res.end('<h1>Online room</h1>');
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterEach(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
});

async function install(page: Page) {
	await page.goto(origin);
	await page.evaluate(async () => {
		await caches
			.open('sparkle-dev')
			.then((cache) => cache.put('/scripts/app.js', new Response('stale')));
		await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;
	});
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('sparkle-dev');
}
async function cachedPaths(page: Page) {
	return page.evaluate(async () =>
		(await (await caches.open('sparkle-assets-v2')).keys()).map((key) => new URL(key.url).pathname)
	);
}
const fetchText = (page: Page, url: string) =>
	page.evaluate(async (url) => (await fetch(url)).text(), url);

test('bundled scripts, decoders, fonts, emotes and sounds avoid repeat network requests', async ({
	page
}) => {
	await install(page);
	for (const path of Object.keys(assets).filter((path) => path !== '/offline.html')) {
		expect(await fetchText(page, path)).toBe(assets[path].body);
		await expect.poll(() => cachedPaths(page)).toContain(path);
		expect(await fetchText(page, path)).toBe(assets[path].body);
		expect(counts[path]).toBe(1);
	}
	await page.reload();
	expect(await fetchText(page, '/scripts/app.js')).toBe('version-one');
	expect(counts['/scripts/app.js']).toBe(1);
});

test('navigation invalidates changed bytes and retains unchanged assets across deployments', async ({
	page
}) => {
	await install(page);
	await fetchText(page, '/scripts/app.js');
	await fetchText(page, '/fonts/font.woff2');
	await expect.poll(() => cachedPaths(page)).toContain('/fonts/font.woff2');
	assets['/scripts/app.js'].body = 'version-two';
	await page.reload();
	expect(await fetchText(page, '/scripts/app.js')).toBe('version-two');
	await expect.poll(() => cachedPaths(page)).toContain('/scripts/app.js');
	expect(await fetchText(page, '/fonts/font.woff2')).toBe('unchanged-font');
	expect(counts['/scripts/app.js']).toBe(2);
	expect(counts['/fonts/font.woff2']).toBe(1);
});

test('private data, ranges, no-store and bytes inconsistent with the manifest are never cached', async ({
	page
}) => {
	assets['/scripts/private.js'] = { body: 'private', headers: { 'Cache-Control': 'private' } };
	assets['/scripts/no-store.js'] = { body: 'secret', headers: { 'Cache-Control': 'no-store' } };
	assets['/scripts/mismatch.js'] = { body: 'wrong', revision: '0'.repeat(64) };
	assets['/scripts/oversize.js'] = { body: 'larger-than-declared', size: 1 };
	await install(page);
	for (const path of [
		'/api/runtime-env',
		'/be/auth/plex/session',
		'/be/rooms/room',
		'/be/media/plex-private/file',
		'/static/movie/video.mp4',
		'/scripts/private.js',
		'/scripts/no-store.js',
		'/scripts/mismatch.js',
		'/scripts/oversize.js'
	]) {
		await fetchText(page, path);
		await fetchText(page, path);
		expect(counts[path]).toBe(2);
		expect(await cachedPaths(page)).not.toContain(path);
	}
	for (let i = 0; i < 2; i++) {
		await page.evaluate(() =>
			fetch('/sound/test.mp3', { headers: { Range: 'bytes=0-3' } }).then((response) =>
				response.text()
			)
		);
		await page.evaluate(() =>
			fetch('/scripts/app.js', { cache: 'no-store' }).then((response) => response.text())
		);
	}
	expect(counts['/sound/test.mp3']).toBe(2);
	expect(counts['/scripts/app.js']).toBe(2);
	expect(await cachedPaths(page)).toEqual(['/offline.html']);
});

test('cache storage failure does not break network assets', async ({ page, context }) => {
	await install(page);
	await context.serviceWorkers()[0].evaluate(() => {
		caches.open = async () => {
			throw new Error('Simulated storage failure');
		};
	});
	expect(await fetchText(page, '/scripts/app.js')).toBe('version-one');
	expect(await fetchText(page, '/scripts/app.js')).toBe('version-one');
	expect(counts['/scripts/app.js']).toBe(2);
});

test('offline navigation shows only the offline page and bounded caches evict old assets', async ({
	page,
	context
}) => {
	worker = worker
		.replace('MAX_ENTRIES = 256', 'MAX_ENTRIES = 3')
		.replace('MAX_BYTES = 256 * 1024 * 1024', 'MAX_BYTES = 100');
	await install(page);
	for (let i = 0; i < 6; i++) assets[`/icons/${i}.png`] = { body: String(i).repeat(40) };
	await page.reload();
	for (let i = 0; i < 6; i++) {
		await fetchText(page, `/icons/${i}.png`);
		await expect.poll(() => cachedPaths(page)).toContain(`/icons/${i}.png`);
	}
	await expect.poll(() => cachedPaths(page)).toHaveLength(2);
	await fetchText(page, '/offline.html');
	await expect.poll(() => cachedPaths(page)).toContain('/offline.html');
	await context.setOffline(true);
	await page.goto(`${origin}/private-room`);
	await expect(page.getByRole('heading', { name: 'Sparkle is offline' })).toBeVisible();
	await context.setOffline(false);
});
