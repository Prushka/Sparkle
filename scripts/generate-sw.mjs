import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const nextStaticDir = path.join(rootDir, '.next', 'static');
const standalonePublicDir = path.join(rootDir, '.next', 'standalone', 'public');
const standaloneSwPath = path.join(standalonePublicDir, 'sw.js');
const buildIdPath = path.join(rootDir, '.next', 'BUILD_ID');

const cacheableExtensions = new Set([
	'.css',
	'.gif',
	'.html',
	'.ico',
	'.jpeg',
	'.jpg',
	'.js',
	'.json',
	'.png',
	'.svg',
	'.ttf',
	'.wasm',
	'.webmanifest',
	'.woff',
	'.woff2'
]);

const corePublicUrls = [
	'/',
	'/manifest.json',
	'/offline.html',
	'/favicon.ico',
	'/favicon/android-icon-192x192.png',
	'/favicon/icon-512x512.png',
	'/favicon/icon-maskable-512x512.png'
];

async function walk(dir, base = '') {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		const absolute = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await walk(absolute, relative)));
			continue;
		}

		files.push(relative.replaceAll('\\', '/'));
	}

	return files;
}

function isCacheablePath(filePath) {
	if (filePath.endsWith('.map') || filePath.endsWith('.txt') || filePath.endsWith('/sw.js')) {
		return false;
	}

	return cacheableExtensions.has(path.extname(filePath));
}

async function publicUrlsFrom(directoryName) {
	const dir = path.join(publicDir, directoryName);

	if (!existsSync(dir)) {
		return [];
	}

	const files = await walk(dir);
	return files
		.filter(isCacheablePath)
		.map((file) => `/${directoryName}/${file}`)
		.sort();
}

async function nextStaticUrls() {
	if (!existsSync(nextStaticDir)) {
		return [];
	}

	const files = await walk(nextStaticDir);
	return files
		.filter(isCacheablePath)
		.map((file) => `/_next/static/${file}`)
		.sort();
}

async function readBuildId() {
	try {
		return (await readFile(buildIdPath, 'utf8')).trim();
	} catch {
		return String(Date.now());
	}
}

function sanitizeBuildId(buildId) {
	return buildId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || String(Date.now());
}

function uniqueSorted(values) {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function renderServiceWorker({ cacheName, precacheUrls }) {
	return `const CACHE_NAME = ${JSON.stringify(cacheName)};
const RUNTIME_CACHE_NAME = \`${'${CACHE_NAME}'}-runtime\`;
const RUNTIME_MAX_ENTRIES = 160;

const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, '\t')};

const CORE_PATHS = new Set(['/manifest.json', '/offline.html', '/favicon.ico']);
const CORE_PREFIXES = ['/_next/static/', '/favicon/', '/fonts/'];
const RUNTIME_PREFIXES = ['/icons/', '/media/', '/scripts/', '/sound/', '/static/'];
const NETWORK_ONLY_PREFIXES = ['/api/', '/_next/webpack-hmr'];

const isLocalDev = () =>
\tself.location.hostname === 'localhost' ||
\tself.location.hostname === '127.0.0.1' ||
\tself.location.hostname === '::1';

function matchesPrefix(pathname, prefixes) {
\treturn prefixes.some((prefix) => pathname.startsWith(prefix));
}

function shouldHandle(request, url) {
\tif (request.method !== 'GET' || url.origin !== self.location.origin) {
\t\treturn false;
\t}

\tif (request.headers.has('range')) {
\t\treturn false;
\t}

\tif (url.pathname === '/sw.js' || matchesPrefix(url.pathname, NETWORK_ONLY_PREFIXES)) {
\t\treturn false;
\t}

\treturn true;
}

function isCoreAsset(url) {
\treturn CORE_PATHS.has(url.pathname) || matchesPrefix(url.pathname, CORE_PREFIXES);
}

function isRuntimeAsset(url) {
\treturn matchesPrefix(url.pathname, RUNTIME_PREFIXES);
}

function isCacheable(response) {
\tif (!response || !response.ok) {
\t\treturn false;
\t}

\tconst cacheControl = response.headers.get('Cache-Control') || '';
\treturn !/no-store/i.test(cacheControl);
}

async function trimCache(cacheName, maxEntries) {
\tconst cache = await caches.open(cacheName);
\tconst keys = await cache.keys();

\tif (keys.length <= maxEntries) {
\t\treturn;
\t}

\tawait Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

async function addToCache(cacheName, request, response) {
\tif (!isCacheable(response)) {
\t\treturn;
\t}

\tconst cache = await caches.open(cacheName);
\tawait cache.put(request, response.clone());

\tif (cacheName === RUNTIME_CACHE_NAME) {
\t\tawait trimCache(cacheName, RUNTIME_MAX_ENTRIES);
\t}
}

async function fetchAndCache(request, cacheName) {
\tconst response = await fetch(request);
\tawait addToCache(cacheName, request, response);
\treturn response;
}

async function precacheCore() {
\tconst cache = await caches.open(CACHE_NAME);

\tawait Promise.all(
\t\tPRECACHE_URLS.map(async (url) => {
\t\t\ttry {
\t\t\t\tconst request = new Request(url, { cache: 'reload' });
\t\t\t\tconst response = await fetch(request);

\t\t\t\tif (isCacheable(response)) {
\t\t\t\t\tawait cache.put(url, response);
\t\t\t\t}
\t\t\t} catch {
\t\t\t\t// A single missing optional asset should not prevent service worker install.
\t\t\t}
\t\t})
\t);
}

async function offlineResponse(request) {
\tif (request.mode === 'navigate') {
\t\treturn (
\t\t\t(await caches.match(request)) ||
\t\t\t(await caches.match('/')) ||
\t\t\t(await caches.match('/offline.html')) ||
\t\t\tResponse.error()
\t\t);
\t}

\treturn (
\t\t(await caches.match(request)) ||
\t\tnew Response('Offline', {
\t\t\tstatus: 503,
\t\t\tstatusText: 'Offline',
\t\t\theaders: { 'Content-Type': 'text/plain; charset=utf-8' }
\t\t})
\t);
}

async function networkFirst(event, cacheName = CACHE_NAME) {
\ttry {
\t\tconst preload = await event.preloadResponse;
\t\tconst response = preload || (await fetch(event.request));
\t\tawait addToCache(cacheName, event.request, response);
\t\treturn response;
\t} catch {
\t\treturn offlineResponse(event.request);
\t}
}

async function cacheFirst(event, cacheName = CACHE_NAME) {
\tconst cached = await caches.match(event.request);

\tif (cached) {
\t\treturn cached;
\t}

\ttry {
\t\treturn await fetchAndCache(event.request, cacheName);
\t} catch {
\t\treturn offlineResponse(event.request);
\t}
}

async function staleWhileRevalidate(event, cacheName) {
\tconst cached = await caches.match(event.request);
\tconst revalidate = fetchAndCache(event.request, cacheName).catch(() => undefined);

\tif (cached) {
\t\tevent.waitUntil(revalidate);
\t\treturn cached;
\t}

\treturn (await revalidate) || offlineResponse(event.request);
}

self.addEventListener('install', (event) => {
\tevent.waitUntil(precacheCore());
\tself.skipWaiting();
});

self.addEventListener('activate', (event) => {
\tevent.waitUntil(
\t\tPromise.all([
\t\t\tcaches.keys().then((cacheNames) =>
\t\t\t\tPromise.all(
\t\t\t\t\tcacheNames
\t\t\t\t\t\t.filter((cacheName) => cacheName.startsWith('sparkle-') && cacheName !== CACHE_NAME)
\t\t\t\t\t\t.filter((cacheName) => cacheName !== RUNTIME_CACHE_NAME)
\t\t\t\t\t\t.map((cacheName) => caches.delete(cacheName))
\t\t\t\t)
\t\t\t),
\t\t\tself.registration.navigationPreload?.enable()
\t\t])
\t);
\tself.clients.claim();
});

self.addEventListener('message', (event) => {
\tif (event.data?.type === 'SKIP_WAITING') {
\t\tself.skipWaiting();
\t}
});

self.addEventListener('fetch', (event) => {
\tconst url = new URL(event.request.url);

\tif (!shouldHandle(event.request, url)) {
\t\treturn;
\t}

\tif (event.request.mode === 'navigate') {
\t\tevent.respondWith(networkFirst(event));
\t\treturn;
\t}

\tif (isCoreAsset(url)) {
\t\tevent.respondWith(isLocalDev() ? networkFirst(event) : cacheFirst(event));
\t\treturn;
\t}

\tif (isRuntimeAsset(url)) {
\t\tevent.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE_NAME));
\t}
});
`;
}

const buildId = sanitizeBuildId(await readBuildId());
const precacheUrls = uniqueSorted([
	...corePublicUrls,
	...(await publicUrlsFrom('favicon')),
	...(await publicUrlsFrom('fonts')),
	...(await nextStaticUrls())
]);

await mkdir(standalonePublicDir, { recursive: true });
await writeFile(
	standaloneSwPath,
	renderServiceWorker({
		cacheName: `sparkle-${buildId}`,
		precacheUrls
	}),
	'utf8'
);

console.log(
	`Generated ${path.relative(rootDir, standaloneSwPath)} with ${precacheUrls.length} precache URLs.`
);
