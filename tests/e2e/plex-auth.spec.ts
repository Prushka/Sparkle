import { expect, test, type Page } from '@playwright/test';

const rawId = 'plex-fixture-1-1';
const denied = { code: 'plex_sign_in_required', error: 'Plex access required' };

// Browser contracts use a fake PIN service. Backend tests independently verify
// real HTTP cookies, Plex response validation, server membership and revocation.
async function fixture(page: Page, member = true) {
	let signedIn = false;
	let mediaId = rawId;
	let roomWrites = 0;
	const catalogSources: string[] = [];
	const status = () => ({
		enabled: true,
		authenticated: signedIn,
		canAccessRaw: signedIn && member,
		...(signedIn ? { name: 'Test member' } : {})
	});
	await page.route('**/api/runtime-env', (route) =>
		route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	await page.context().route('https://app.plex.tv/auth*', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<title>Plex test authorization</title><p>Mock Plex authorization</p>'
		})
	);
	await page.route('**/be/auth/plex/*', async (route) => {
		const action = new URL(route.request().url()).pathname.split('/').pop();
		if (action !== 'session') {
			expect(route.request().method()).toBe('POST');
			expect(route.request().headers()['x-sparkle-auth']).toBe('1');
		}
		if (action === 'start')
			return route.fulfill({
				json: { url: 'https://app.plex.tv/auth#?clientID=fixture&code=fixture-pin', expiresIn: 600 }
			});
		if (action === 'poll') {
			signedIn = true;
			return route.fulfill({
				json: status(),
				headers: {
					'set-cookie':
						'sparkle_plex_session=opaque-browser-fixture; HttpOnly; SameSite=Lax; Path=/'
				}
			});
		}
		if (action === 'logout') signedIn = false;
		return route.fulfill({ json: status() });
	});
	await page.route('**/be/rooms**', (route) => {
		const path = new URL(route.request().url()).pathname;
		const rawRoom = path === '/be/rooms/private-room';
		if (rawRoom && mediaId && !status().canAccessRaw)
			return route.fulfill({ status: 401, json: denied });
		if (route.request().method() === 'PUT') {
			roomWrites++;
			mediaId = route.request().postDataJSON().mediaId;
		}
		return route.fulfill({
			json: { roomId: rawRoom ? 'private-room' : 'public-room', mediaId: rawRoom ? mediaId : '' }
		});
	});
	await page.route('**/be/library/sources', (route) =>
		route.fulfill({
			json: {
				sources: [
					{ id: 'processed', source: 'processed', title: 'Encoded' },
					...(status().canAccessRaw ? [{ id: '1', source: 'plex', title: 'Movies' }] : [])
				]
			}
		})
	);
	await page.route('**/be/library/items?*', (route) => {
		catalogSources.push(new URL(route.request().url()).searchParams.get('source') || 'all');
		return route.fulfill({
			json: {
				items: [
					{
						id: 'encoded-fixture',
						source: 'processed',
						kind: 'movie',
						title: 'Public movie',
						duration: 120
					},
					...(status().canAccessRaw
						? [{ id: rawId, source: 'plex', kind: 'movie', title: 'Private movie', duration: 120 }]
						: [])
				],
				total: status().canAccessRaw ? 2 : 1
			}
		});
	});
	await page.route(`**/be/media/${rawId}`, (route) =>
		route.fulfill(
			status().canAccessRaw
				? {
						json: {
							Id: rawId,
							Source: 'plex',
							Input: 'Private movie.mkv',
							State: 'complete',
							Duration: 120,
							EncodedCodecs: ['h264-8bit'],
							Files: {},
							MappedAudio: {},
							Streams: [],
							Chapters: [],
							DominantColors: [],
							JobModTime: 1
						}
					}
				: { status: 401, json: denied }
		)
	);
	await page.route(/\/static\/(?:plex-fixture-1-1|encoded-fixture|pfp)\//, (route) =>
		route.fulfill({ status: 404 })
	);
	await page.routeWebSocket('**/be/sync/**', () => {});
	return { catalogSources, roomWrites: () => roomWrites };
}

async function signIn(page: Page) {
	const popup = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Continue with Plex', exact: true }).click();
	const authWindow = await popup;
	await expect(authWindow).toHaveURL(/https:\/\/app\.plex\.tv\/auth/);
	// Some browsers sever a noopener popup's window handle after navigation.
	// Authorization is determined by the bound backend PIN, never that handle.
	await expect(
		page.getByRole('button', { name: /Plex account|Sign out of Plex/ }).first()
	).toBeVisible();
	if (!authWindow.isClosed()) await authWindow.close();
}

test('guest Library, member sign-in, cookie privacy and sign-out work on desktop and mobile', async ({
	page
}) => {
	const f = await fixture(page);
	await page.goto('/public-room');
	await expect(page.getByRole('link', { name: /Public movie/ })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toContainText(
		'Encoded'
	);
	expect(f.catalogSources.every((source) => source === 'processed')).toBeTruthy();
	for (const width of [1280, 390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
		).toBeTruthy();
		const bounds = await page.getByRole('dialog').boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
		await page.keyboard.press('Escape');
	}
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	await signIn(page);
	await expect(page.getByRole('button', { name: 'Sign out of Plex' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: /Private movie/ })).toBeVisible();
	expect(await page.evaluate(() => document.cookie)).not.toContain('sparkle_plex_session');
	expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
		'opaque-browser-fixture'
	);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Plex account', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Plex account', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out of Plex' }).click();
	await expect(page.getByRole('button', { name: 'Continue with Plex' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: /Private movie/ })).toHaveCount(0);
	await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toContainText(
		'Encoded'
	);
});

test('Raw room prompts, resumes the same room after sign-in and gates sign-out', async ({
	page
}) => {
	const f = await fixture(page);
	await page.goto(`/private-room/media/${rawId}?query=keep`);
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Leave room' })).toBeVisible();
	await signIn(page);
	await expect(page.getByRole('region', { name: 'Current media' })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/private-room/media/${rawId}\\?query=keep`));
	await page.getByRole('button', { name: 'Plex account', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out of Plex' }).click();
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Current media' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Leave room' }).click();
	await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
	expect(f.roomWrites()).toBe(0);
});

test('an authenticated Plex account without server membership cannot enter a Raw room', async ({
	page
}) => {
	await fixture(page, false);
	await page.goto('/private-room');
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await signIn(page);
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('does not have access');
	await expect(page.getByRole('button', { name: 'Sign out of Plex' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Current media' })).toHaveCount(0);
});
