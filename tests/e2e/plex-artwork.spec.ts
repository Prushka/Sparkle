import { expect, test, type Page } from '@playwright/test';

const id = 'plex-123456abcdef-7-1';
const proxy = `/media/${id}/artwork/poster`;
const matched = '/library/artwork/matched.signature';
const direct =
	'https://plex-artwork.example.test/library/metadata/7/thumb/1?X-Plex-Token=viewer-fixture';
const svg =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#446688"/></svg>';

async function fixture(page: Page, options: { signedIn?: boolean; mode?: string } = {}) {
	let signedIn = options.signedIn ?? true;
	let lookups = 0;
	let proxyLoads = 0;
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
	await page.route('**/be/auth/plex/*', (route) => {
		if (route.request().url().endsWith('/logout')) signedIn = false;
		return route.fulfill({
			json: {
				enabled: true,
				authenticated: signedIn,
				canAccessRaw: signedIn,
				directArtwork: signedIn,
				name: signedIn ? 'Artwork member' : undefined,
				libraryIds: signedIn ? ['1'] : undefined
			}
		});
	});
	await page.route('**/be/library/sources', (route) =>
		route.fulfill({ json: { sources: [{ id: '1', source: 'plex', title: 'Movies' }] } })
	);
	await page.route('**/be/library/items?*', (route) =>
		route.fulfill({
			json: {
				total: 3,
				items: [proxy, proxy, matched].map((poster, i) => ({
					id: `fixture-${i}`,
					source: 'processed',
					kind: 'movie',
					title: `Artwork ${i}`,
					duration: 120,
					poster
				}))
			}
		})
	);
	for (const path of [proxy, matched]) {
		await page.route(`**/be${path}`, (route) => {
			proxyLoads++;
			return route.fulfill({ contentType: 'image/svg+xml', body: svg });
		});
		await page.route(`**/be${path}/direct`, async (route) => {
			lookups++;
			expect(route.request().method()).toBe('POST');
			expect(route.request().headers()['x-sparkle-auth']).toBe('1');
			if (options.mode === 'pending' || options.mode === 'lookup-timeout') await pending;
			if (options.mode === 'denied') return route.fulfill({ status: 403 });
			return route.fulfill({
				headers: { 'Cache-Control': 'no-store' },
				json: { url: options.mode === 'insecure' ? direct.replace('https:', 'http:') : direct }
			});
		});
	}
	await page.route('https://plex-artwork.example.test/**', async (route) => {
		expect(route.request().headers()['referer']).toBeUndefined();
		expect(route.request().headers()['origin']).toBeUndefined();
		if (options.mode === 'image-timeout') await pending;
		if (options.mode === 'broken') return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/svg+xml', body: svg });
	});
	return { lookups: () => lookups, proxyLoads: () => proxyLoads, release: () => release!() };
}

async function signOut(page: Page) {
	await page.getByRole('button', { name: 'Plex account', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out of Plex', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Continue with Plex', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
}

test('authorized covers use viewer URLs, coalesce lookup and keep catalog links/storage public', async ({
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
	expect(f.lookups()).toBe(2);
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

test('anonymous covers use the existing proxy without requesting credentials', async ({ page }) => {
	const f = await fixture(page, { signedIn: false });
	await page.goto('/?artwork=anonymous');
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
	expect(f.lookups()).toBe(0);
});

for (const mode of ['denied', 'insecure', 'broken', 'lookup-timeout', 'image-timeout']) {
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
		f.release();
	});
}

test('sign-out discards a late private artwork response', async ({ page }) => {
	const f = await fixture(page, { mode: 'pending' });
	await page.goto('/?artwork=pending');
	await expect.poll(f.lookups).toBe(2);
	await signOut(page);
	f.release();
	await expect(page.locator(`img[src="/be${proxy}"]`)).toHaveCount(2);
	await expect(page.locator('img[src*="X-Plex-Token"]')).toHaveCount(0);
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
	expect(f.lookups()).toBe(1);
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
