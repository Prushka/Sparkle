// Copied by generate-sw.mjs. Only files present in the build manifest can be cached.
const ASSET_CACHE = 'sparkle-assets-v2';
const MANIFEST_CACHE = 'sparkle-manifest-v2';
const MANIFEST_URL = '/_sparkle/assets.json';
const MAX_ENTRIES = 256;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
let manifestPromise;
let writes = Promise.resolve();

async function readManifest() {
	let response;
	try {
		// Revalidate once per full navigation, including on localhost in production.
		response = await fetch(MANIFEST_URL, {
			cache: 'no-cache',
			credentials: 'omit',
			signal: AbortSignal.timeout(4000)
		});
	} catch {
		response = await caches
			.open(MANIFEST_CACHE)
			.then((cache) => cache.match(MANIFEST_URL))
			.catch(() => null);
	}
	if (!response?.ok) return {};
	try {
		const data = await response.clone().json();
		if (!data.assets || typeof data.assets !== 'object' || !data.buildId) return {};
		await caches
			.open(MANIFEST_CACHE)
			.then((cache) => cache.put(MANIFEST_URL, response))
			.catch(() => {});
		return data.assets;
	} catch {
		return {};
	}
}

function refreshManifest() {
	manifestPromise = readManifest();
	return manifestPromise;
}

async function trimCache(cache) {
	const keys = await cache.keys();
	let bytes = 0;
	let entries = 0;
	// Keep the newest inserts; serialize writes so simultaneous loads cannot exceed the limits.
	for (const key of keys.reverse()) {
		const response = await cache.match(key);
		const size = Number(response?.headers.get('X-Sparkle-Asset-Size'));
		bytes += size;
		if (++entries > MAX_ENTRIES || !Number.isFinite(size) || size <= 0 || bytes > MAX_BYTES) {
			await cache.delete(key);
		}
	}
}

async function saveAsset(key, response, asset) {
	if (
		response.status !== 200 ||
		response.redirected ||
		/no-store|private/i.test(response.headers.get('Cache-Control') || '')
	)
		return;
	if (response.headers.get('Vary')?.trim() === '*') return;
	// A deployment can replace a stable filename while a request is in flight.
	// Verify bytes before associating them with that manifest's content revision.
	if (
		!Number.isSafeInteger(asset.size) ||
		asset.size <= 0 ||
		asset.size > MAX_ASSET_BYTES ||
		!response.body
	)
		return;
	const reader = response.body.getReader();
	const bytes = new Uint8Array(asset.size);
	let offset = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		if (offset + value.byteLength > bytes.byteLength) {
			void reader.cancel();
			return;
		}
		bytes.set(value, offset);
		offset += value.byteLength;
	}
	if (offset !== asset.size) return;
	const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
		n.toString(16).padStart(2, '0')
	).join('');
	if (digest !== asset.revision) return;
	const headers = new Headers(response.headers);
	headers.set('X-Sparkle-Asset-Size', String(bytes.byteLength));
	// Fetch has already decoded the body.
	headers.delete('Content-Encoding');
	headers.set('Content-Length', String(bytes.byteLength));
	const stored = new Response(bytes, { status: 200, headers });
	writes = writes
		.then(async () => {
			const cache = await caches.open(ASSET_CACHE);
			await cache.put(key, stored);
			await trimCache(cache);
		})
		.catch(() => {});
	await writes;
}

async function assetResponse(event) {
	const request = event.request;
	const url = new URL(request.url);
	const assets = await (manifestPromise || refreshManifest());
	const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
	if (
		!asset ||
		!/^[a-f0-9]{64}$/.test(asset.revision) ||
		!Number.isSafeInteger(asset.size) ||
		asset.size <= 0 ||
		asset.size > MAX_ASSET_BYTES
	)
		return fetch(request);
	const key = new URL(request.url);
	key.searchParams.set('__sparkle_revision', asset.revision);
	const cached = await caches
		.open(ASSET_CACHE)
		.then((cache) => cache.match(key.href))
		.catch(() => null);
	if (cached) return cached;
	// Force validation on cache misses so a new revision cannot reuse stale HTTP bytes.
	const response = await fetch(request, { cache: 'no-cache' });
	event.waitUntil(saveAsset(key.href, response.clone(), asset).catch(() => {}));
	return response;
}

async function navigate(event, manifest) {
	try {
		const [response] = await Promise.all([fetch(event.request), manifest]);
		return response;
	} catch {
		const assets = await manifest;
		const offline = assets['/offline.html'];
		if (offline) {
			const key = new URL('/offline.html', self.location.origin);
			key.searchParams.set('__sparkle_revision', offline.revision);
			const cached = await caches
				.open(ASSET_CACHE)
				.then((cache) => cache.match(key.href))
				.catch(() => null);
			if (cached) return cached;
		}
		return new Response('Sparkle is offline. Reconnect to open a room.', {
			status: 503,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const assets = await refreshManifest();
			const offline = assets['/offline.html'];
			if (offline) {
				const key = new URL('/offline.html', self.location.origin);
				key.searchParams.set('__sparkle_revision', offline.revision);
				await fetch('/offline.html', { cache: 'no-cache', credentials: 'omit' })
					.then((response) => saveAsset(key.href, response, offline))
					.catch(() => {});
			}
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			await caches
				.keys()
				.then((names) =>
					Promise.all(
						names
							.filter(
								(name) =>
									name.startsWith('sparkle-') && ![ASSET_CACHE, MANIFEST_CACHE].includes(name)
							)
							.map((name) => caches.delete(name))
					)
				)
				.catch(() => {});
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (
		request.method !== 'GET' ||
		url.origin !== self.location.origin ||
		request.headers.has('range') ||
		request.cache === 'no-store' ||
		url.searchParams.has('X-Plex-Token')
	)
		return;
	if (url.pathname === '/sw.js' || url.pathname.startsWith('/_sparkle/')) return;
	if (request.mode === 'navigate') {
		// Install the new manifest promise before any subresource can use the old one.
		event.respondWith(navigate(event, refreshManifest()));
	} else {
		event.respondWith(assetResponse(event));
	}
});
