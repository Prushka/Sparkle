const CACHE_NAME = 'sparkle-dev';
const RUNTIME_CACHE_NAME = `${CACHE_NAME}-runtime`;
const RUNTIME_MAX_ENTRIES = 160;

const PRECACHE_URLS = [
	'/',
	'/manifest.json',
	'/offline.html',
	'/favicon.ico',
	'/favicon/android-icon-192x192.png',
	'/favicon/icon-512x512.png',
	'/favicon/icon-maskable-512x512.png'
];

const CORE_PATHS = new Set(['/manifest.json', '/offline.html', '/favicon.ico']);
const CORE_PREFIXES = ['/_next/static/', '/favicon/', '/fonts/'];
const RUNTIME_PREFIXES = ['/icons/', '/media/', '/scripts/', '/sound/'];
const NETWORK_ONLY_PREFIXES = ['/api/', '/_next/webpack-hmr', '/static/'];

const isLocalDev = () =>
	self.location.hostname === 'localhost' ||
	self.location.hostname === '127.0.0.1' ||
	self.location.hostname === '::1';

function matchesPrefix(pathname, prefixes) {
	return prefixes.some((prefix) => pathname.startsWith(prefix));
}

function shouldHandle(request, url) {
	if (request.method !== 'GET' || url.origin !== self.location.origin) {
		return false;
	}

	if (request.headers.has('range')) {
		return false;
	}

	if (url.pathname === '/sw.js' || matchesPrefix(url.pathname, NETWORK_ONLY_PREFIXES)) {
		return false;
	}

	return true;
}

function isCoreAsset(url) {
	return CORE_PATHS.has(url.pathname) || matchesPrefix(url.pathname, CORE_PREFIXES);
}

function isRuntimeAsset(url) {
	return matchesPrefix(url.pathname, RUNTIME_PREFIXES);
}

function isCacheable(response) {
	if (!response || !response.ok) {
		return false;
	}

	const cacheControl = response.headers.get('Cache-Control') || '';
	return !/no-store/i.test(cacheControl);
}

async function trimCache(cacheName, maxEntries) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();

	if (keys.length <= maxEntries) {
		return;
	}

	await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

async function addToCache(cacheName, request, response) {
	if (!isCacheable(response)) {
		return;
	}

	const cache = await caches.open(cacheName);
	await cache.put(request, response.clone());

	if (cacheName === RUNTIME_CACHE_NAME) {
		await trimCache(cacheName, RUNTIME_MAX_ENTRIES);
	}
}

async function fetchAndCache(request, cacheName) {
	const response = await fetch(request);
	await addToCache(cacheName, request, response);
	return response;
}

async function precacheCore() {
	const cache = await caches.open(CACHE_NAME);

	await Promise.all(
		PRECACHE_URLS.map(async (url) => {
			try {
				const request = new Request(url, { cache: 'reload' });
				const response = await fetch(request);

				if (isCacheable(response)) {
					await cache.put(url, response);
				}
			} catch {
				// A single missing optional asset should not prevent service worker install.
			}
		})
	);
}

async function offlineResponse(request) {
	if (request.mode === 'navigate') {
		return (
			(await caches.match(request)) ||
			(await caches.match('/')) ||
			(await caches.match('/offline.html')) ||
			Response.error()
		);
	}

	return (
		(await caches.match(request)) ||
		new Response('Offline', {
			status: 503,
			statusText: 'Offline',
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		})
	);
}

async function networkFirst(event, cacheName = CACHE_NAME) {
	try {
		const preload = await event.preloadResponse;
		const response = preload || (await fetch(event.request));
		await addToCache(cacheName, event.request, response);
		return response;
	} catch {
		return offlineResponse(event.request);
	}
}

async function cacheFirst(event, cacheName = CACHE_NAME) {
	const cached = await caches.match(event.request);

	if (cached) {
		return cached;
	}

	try {
		return await fetchAndCache(event.request, cacheName);
	} catch {
		return offlineResponse(event.request);
	}
}

async function staleWhileRevalidate(event, cacheName) {
	const cached = await caches.match(event.request);
	const revalidate = fetchAndCache(event.request, cacheName).catch(() => undefined);

	if (cached) {
		event.waitUntil(revalidate);
		return cached;
	}

	return (await revalidate) || offlineResponse(event.request);
}

self.addEventListener('install', (event) => {
	event.waitUntil(precacheCore());
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		Promise.all([
			caches.keys().then((cacheNames) =>
				Promise.all(
					cacheNames
						.filter((cacheName) => cacheName.startsWith('sparkle-') && cacheName !== CACHE_NAME)
						.filter((cacheName) => cacheName !== RUNTIME_CACHE_NAME)
						.map((cacheName) => caches.delete(cacheName))
				)
			),
			self.registration.navigationPreload?.enable()
		])
	);
	self.clients.claim();
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	if (!shouldHandle(event.request, url)) {
		return;
	}

	if (event.request.mode === 'navigate') {
		event.respondWith(networkFirst(event));
		return;
	}

	if (isCoreAsset(url)) {
		event.respondWith(isLocalDev() ? networkFirst(event) : cacheFirst(event));
		return;
	}

	if (isRuntimeAsset(url)) {
		event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE_NAME));
	}
});
