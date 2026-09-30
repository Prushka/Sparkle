import { expect, test, type Page } from '@playwright/test';

const id = 'plex-123456abcdef-7-1';
const proxy = `/media/${id}/artwork/poster`;
const matched = '/library/artwork/matched.signature';
const artwork = { libraryId: '1', poster: '/library/metadata/7/thumb/1' };
const direct =
	'https://plex-artwork.example.test/library/metadata/7/thumb/1?X-Plex-Token=viewer-fixture';
const svg =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#446688"/></svg>';

async function fixture(page: Page, options: { signedIn?: boolean; mode?: string } = {}) {
	let signedIn = options.signedIn ?? true;
	let refreshes = 0;
	let perCoverRequests = 0;
	let listLoads = 0;
	let proxyLoads = 0;
	let holdRefresh = false;
	let libraryIds = ['1'];
	let token = 'viewer-fixture';
	let expiresAt = Date.now() + 5 * 60_000;
	let release: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/be/rooms', (route) =>
		route.fulfill({ json: { roomId: 'artwork-library', mediaId: '' } })
	);
	await page.route('**/be/rooms/artwork-library', (route) =>
		route.fulfill({ json: { roomId: 'artwork-library', mediaId: '' } })
	);
	await page.route('**/api/runtime-env', (route) =>
		route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.endsWith('/direct')) perCoverRequests++;
	});
	await page.route('**/be/auth/plex/*', async (route) => {
		if (route.request().url().endsWith('/logout')) signedIn = false;
		const isRefresh = route.request().url().endsWith('/session');
		if (isRefresh) {
			refreshes++;
			expect(route.request().method()).toBe('POST');
			expect(route.request().headers()['x-sparkle-auth']).toBe('1');
		}
		const json = {
			enabled: true,
			authenticated: signedIn,
			canAccessRaw: signedIn,
			directArtwork: signedIn,
			name: signedIn ? 'Artwork member' : undefined,
			libraryIds: signedIn ? libraryIds : undefined,
			artwork:
				isRefresh && signedIn && options.mode !== 'disabled'
					? {
							baseUrl:
								options.mode === 'insecure'
									? 'http://plex-artwork.example.test'
									: 'https://plex-artwork.example.test',
							token,
							expiresAt
						}
					: undefined
		};
		if (isRefresh && (holdRefresh || options.mode === 'session-timeout')) await pending;
		return route.fulfill({ headers: { 'Cache-Control': 'no-store' }, json });
	});
	await page.route('**/be/library/sources', (route) =>
		route.fulfill({ json: { sources: [{ id: '1', source: 'plex', title: 'Movies' }] } })
	);
	await page.route('**/be/library/items?*', (route) => {
		listLoads++;
		return route.fulfill({
			json: {
				total: 3,
				items: [proxy, proxy, matched].map((poster, i) => ({
					id: `fixture-${i}`,
					source: 'processed',
					kind: 'movie',
					title: `Artwork ${i}`,
					duration: 120,
					poster,
					plexArtwork:
						options.mode === 'missing-path'
							? undefined
							: {
									...artwork,
									...(options.mode === 'unsafe-path'
										? { poster: '//untrusted.example/thumb' }
										: {}),
									...(options.mode === 'unshared-library' ? { libraryId: '2' } : {})
								}
				}))
			}
		});
	});
	for (const path of [proxy, matched]) {
		await page.route(`**/be${path}`, (route) => {
			proxyLoads++;
			return route.fulfill({ contentType: 'image/svg+xml', body: svg });
		});
	}
	await page.route('https://plex-artwork.example.test/**', async (route) => {
		expect(route.request().headers()['referer']).toBeUndefined();
		expect(route.request().headers()['origin']).toBeUndefined();
		if (options.mode === 'image-timeout') await pending;
		if (options.mode === 'broken') return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/svg+xml', body: svg });
	});
	return {
		refreshes: () => refreshes,
		perCoverRequests: () => perCoverRequests,
		listLoads: () => listLoads,
		proxyLoads: () => proxyLoads,
		holdRefresh: () => {
			holdRefresh = true;
		},
		revoke: () => {
			libraryIds = ['2'];
		},
		rotate: () => {
			token = 'viewer-rotated';
		},
		renew: () => {
			expiresAt += 5 * 60_000;
		},
		release: () => release!()
	};
}

async function signOut(page: Page) {
	await page.getByRole('button', { name: 'Plex account', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out of Plex', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Continue with Plex', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
}

test('authorized covers construct viewer URLs without per-cover requests and keep links/storage public', async ({
	page
}) => {
	const f = await fixture(page);
	await page.goto('/?artwork=direct');
	const images = page.locator('img[src*="X-Plex-Token"]');
	await expect(images).toHaveCount(3);
	await expect
		.poll(() =>
			images.evaluateAll((els) => els.every((el) => (el as HTMLImageElement).naturalWidth > 0))
		)
		.toBe(true);
	expect(f.refreshes()).toBe(1);
	expect(f.perCoverRequests()).toBe(0);
	expect(f.proxyLoads()).toBe(0);
	expect(
		await page.locator('a').evaluateAll((els) => els.some((el) => el.href.includes('X-Plex-Token')))
	).toBe(false);
	expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
		'viewer-fixture'
	);
	await signOut(page);
	await expect(images).toHaveCount(0);
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
});

test('anonymous covers use the existing proxy without per-cover requests', async ({ page }) => {
	const f = await fixture(page, { signedIn: false });
	await page.goto('/?artwork=anonymous');
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
	expect(f.perCoverRequests()).toBe(0);
});

for (const mode of [
	'disabled',
	'insecure',
	'broken',
	'session-timeout',
	'image-timeout',
	'missing-path',
	'unsafe-path',
	'unshared-library'
]) {
	test(`${mode} falls back to the proxy`, async ({ page }) => {
		const f = await fixture(page, { mode });
		await page.goto(`/?artwork=${mode}`);
		await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2, { timeout: 20_000 });
		await expect
			.poll(() =>
				page
					.locator(`img[src="/be${proxy}"]`)
					.first()
					.evaluate((el: HTMLImageElement) => el.naturalWidth)
			)
			.toBeGreaterThan(0);
		await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(0);
		expect(f.perCoverRequests()).toBe(0);
		f.release();
	});
}

test('sign-out discards a late private session response', async ({ page }) => {
	const f = await fixture(page);
	await page.goto('/?artwork=pending');
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(3);
	f.holdRefresh();
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await expect.poll(f.refreshes).toBe(2);
	await signOut(page);
	const response = page.waitForResponse('**/be/auth/plex/session');
	f.release();
	await response;
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(0);
});

test('refresh rotates private credentials without reloading the catalog, and revocation restores proxies', async ({
	page
}) => {
	const f = await fixture(page);
	await page.goto('/?artwork=refresh');
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(3);
	const initialLists = f.listLoads();
	f.rotate();
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await expect(page.locator('img[src*="viewer-rotated"]')).toHaveCount(3);
	expect(f.listLoads()).toBe(initialLists);
	f.revoke();
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(0);
	expect(f.perCoverRequests()).toBe(0);
});

test('renewing the same credentials keeps loaded images without starting a fallback timeout', async ({
	page
}) => {
	await page.clock.install();
	const f = await fixture(page);
	await page.goto('/?artwork=renew');
	const images = page.locator('img[src*="X-Plex-Token"]');
	await expect(images).toHaveCount(3);
	await expect
		.poll(() =>
			images.evaluateAll((els) => els.every((el) => (el as HTMLImageElement).naturalWidth > 0))
		)
		.toBe(true);
	f.renew();
	const renewed = page.waitForResponse('**/be/auth/plex/session');
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await renewed;
	await page.clock.fastForward(9_000);
	await expect(images).toHaveCount(3);
	expect(f.proxyLoads()).toBe(0);
	expect(f.perCoverRequests()).toBe(0);
});

test('expired credentials are removed while the session is revalidated', async ({ page }) => {
	await page.clock.install();
	const f = await fixture(page);
	await page.goto('/?artwork=expiry');
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(3);
	f.holdRefresh();
	await page.clock.fastForward(5 * 60_000 + 1_000);
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(0);
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
	expect(f.refreshes()).toBeGreaterThan(1);
	expect(f.perCoverRequests()).toBe(0);
	await signOut(page);
	f.release();
});

test('player and current-media images use direct artwork while Vidstack metadata stays public', async ({
	page
}) => {
	const f = await fixture(page);
	await page.routeWebSocket('**/be/sync/**', () => {});
	await page.route('**/be/rooms/artwork-room', (route) =>
		route.fulfill({ json: { roomId: 'artwork-room', mediaId: 'artwork-fixture' } })
	);
	await page.route('**/be/media/artwork-fixture', (route) =>
		route.fulfill({
			json: {
				Id: 'artwork-fixture',
				Source: 'processed',
				Input: 'Artwork Movie.mkv',
				State: 'complete',
				Duration: 120,
				Poster: matched,
				plexArtwork: artwork,
				EncodedCodecs: ['h264-8bit'],
				Files: { 'h264-8bit.mp4': 1024 },
				MappedAudio: {},
				Streams: [{ Index: 0, CodecType: 'video', CodecName: 'h264', Width: 1280, Height: 720 }],
				Chapters: [],
				DominantColors: [],
				JobModTime: 1
			}
		})
	);
	await page.route('**/static/artwork-fixture/**', (route) => route.fulfill({ status: 404 }));
	await page.goto('/artwork-room/media/artwork-fixture');
	const cover = page.getByRole('region', { name: 'Current media' }).locator('img');
	await expect(cover).toHaveAttribute('src', direct);
	await expect(page.locator('img.vds-poster')).toHaveAttribute('src', direct);
	expect(f.perCoverRequests()).toBe(0);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.mediaSession?.metadata?.artwork[0]?.src || ''))
		.toContain(`/be${matched}`);
	expect((await page.locator('video').first().getAttribute('poster')) || '').not.toContain(
		'X-Plex-Token'
	);
	expect(
		await page.evaluate(() => JSON.stringify(navigator.mediaSession?.metadata?.artwork || []))
	).not.toContain('viewer-fixture');
});
