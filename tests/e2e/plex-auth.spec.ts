import { expect, test, type Page } from '@playwright/test';

const rawId = 'plex-fixture-1-1';
const denied = { code: 'plex_sign_in_required', error: 'Plex access required' };
const plexProfileId = 'plex-0123456789abcdef0123456789abcdef';

// Browser contracts use a fake PIN service. Backend tests independently verify
// real HTTP cookies, Plex response validation, server membership and revocation.
async function fixture(
	page: Page,
	member = true,
	options: {
		cookiesBlocked?: boolean;
		manualAuthorization?: boolean;
		name?: string;
		roomLibraryDenied?: boolean;
		extraLibrary?: boolean;
	} = {}
) {
	let signedIn = false;
	let authorized = false;
	let authorizationsOpened = 0;
	let mediaId = rawId;
	let roomWrites = 0;
	let libraryIds = options.extraLibrary ? ['1', '2'] : ['1'];
	const catalogSources: string[] = [];
	const status = () => ({
		enabled: true,
		authenticated: signedIn,
		canAccessRaw: signedIn && member,
		libraryIds: signedIn && member ? libraryIds : [],
		...(signedIn ? { name: options.name || 'Test member', profileId: plexProfileId } : {})
	});
	await page.route('**/api/runtime-env', (route) =>
		route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	await page.context().route('https://app.plex.tv/auth*', (route) => {
		authorizationsOpened++;
		if (!options.manualAuthorization) authorized = true;
		return route.fulfill({
			contentType: 'text/html',
			body: '<title>Plex test authorization</title><p>Mock Plex authorization</p>'
		});
	});
	await page.route('**/be/auth/plex/*', async (route) => {
		const action = new URL(route.request().url()).pathname.split('/').pop();
		if (action !== 'session') {
			expect(route.request().method()).toBe('POST');
			expect(route.request().headers()['x-sparkle-auth']).toBe('1');
		}
		if (action === 'start')
			return route.fulfill({
				json: {
					url: 'https://app.plex.tv/auth#?clientID=fixture&code=fixture-pin',
					expiresIn: 600
				},
				headers: options.cookiesBlocked
					? {}
					: {
							'set-cookie':
								'sparkle_plex_pending=opaque-pending-fixture; HttpOnly; SameSite=Lax; Path=/'
						}
			});
		if (action === 'poll') {
			if (!route.request().headers()['cookie']?.includes('sparkle_plex_pending='))
				return route.fulfill({
					status: 400,
					json: {
						code: 'plex_sign_in_cookie_required',
						error:
							'Your browser did not return the sign-in cookie. Allow cookies for Sparkle or contact the server owner.'
					}
				});
			if (!authorized) return route.fulfill({ status: 202, json: { pending: true } });
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
		const rawRoom =
			path === '/be/rooms/private-room' ||
			(path === '/be/rooms' && route.request().postDataJSON()?.mediaId === rawId);
		if (rawRoom && mediaId && !status().canAccessRaw)
			return route.fulfill({ status: 401, json: denied });
		if (rawRoom && mediaId && options.roomLibraryDenied)
			return route.fulfill({
				status: 403,
				json: { code: 'plex_library_access_denied', error: 'Library access required' }
			});
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
					...(status().canAccessRaw
						? libraryIds.map((id) => ({
								id,
								source: 'plex',
								title: id === '1' ? 'Movies' : 'Other Movies'
							}))
						: [])
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
						: []),
					...(status().canAccessRaw && libraryIds.includes('2')
						? [
								{
									id: 'plex-fixture-2-1',
									source: 'plex',
									kind: 'movie',
									title: 'Other library movie',
									duration: 120
								}
							]
						: [])
				],
				total: status().canAccessRaw ? 1 + libraryIds.length : 1
			}
		});
	});
	await page.route(`**/be/media/${rawId}`, (route) =>
		route.fulfill({
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
		})
	);
	await page.route(/\/static\/(?:plex-fixture-1-1|encoded-fixture|pfp)\//, (route) =>
		route.fulfill({ status: 404 })
	);
	await page.route(`**/static/pfp/${plexProfileId}.png*`, (route) =>
		route.fulfill({
			contentType: 'image/png',
			body: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=',
				'base64'
			)
		})
	);
	await page.routeWebSocket('**/be/sync/**', () => {});
	return {
		catalogSources,
		roomWrites: () => roomWrites,
		authorizationsOpened: () => authorizationsOpened,
		authorize: () => {
			authorized = true;
		},
		revokeExtraLibrary: () => {
			libraryIds = ['1'];
		}
	};
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

async function expectAccountIdentity(page: Page, name = 'Test member') {
	const identity = page.getByRole('dialog').getByRole('status').filter({ hasText: 'Signed in as' });
	await expect(identity.getByText(name, { exact: true })).toBeVisible();
	const avatar = identity.getByRole('img');
	await expect(avatar).toHaveAttribute('src', new RegExp(`/pfp/${plexProfileId}\\.png`));
	await expect
		.poll(() => avatar.evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBeGreaterThan(0);
}

test('guest Library, member sign-in, cookie privacy and sign-out work on desktop and mobile', async ({
	page
}, testInfo) => {
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
	// The original dialog updates without closing it, navigating or reloading.
	await expectAccountIdentity(page);
	for (const width of [320, 390, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		const dialog = page.getByRole('dialog');
		const bounds = await dialog.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
		expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true
		);
		await dialog.screenshot({ path: testInfo.outputPath(`plex-account-${width}.png`) });
	}
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: /Private movie/ })).toBeVisible();
	expect(await page.evaluate(() => document.cookie)).not.toContain('sparkle_plex_session');
	expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
		'opaque-browser-fixture'
	);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Plex account', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Plex account', exact: true }).click();
	await expectAccountIdentity(page);
	await page.getByRole('button', { name: 'Sign out of Plex' }).click();
	await expect(page.getByRole('button', { name: 'Continue with Plex' })).toBeVisible();
	await expect(page.getByRole('dialog').getByText('Test member', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
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
	const profile = page.getByRole('button', { name: 'Open profile settings', exact: true });
	await expect(profile).toContainText('Test member');
	await expect(profile.locator('img')).toHaveAttribute(
		'src',
		new RegExp(`/pfp/${plexProfileId}\\.png`)
	);
	await expect
		.poll(() => profile.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBeGreaterThan(0);
	await profile.click();
	await expect(
		page.getByRole('dialog').getByRole('heading', { name: 'Plex account' })
	).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
	await expectAccountIdentity(page);
	await page.getByRole('button', { name: 'Sign out of Plex' }).click();
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Current media' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Leave room' }).click();
	await expect(page.getByRole('navigation', { name: 'Library hierarchy' })).toBeVisible();
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
	await expectAccountIdentity(page);
	await expect(page.getByRole('region', { name: 'Current media' })).toHaveCount(0);
});

test('a member with another shared library cannot enter an unshared Raw room', async ({ page }) => {
	const f = await fixture(page, true, { roomLibraryDenied: true });
	await page.goto('/private-room');
	await signIn(page);
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await expect(page.getByRole('dialog')).toContainText('share this media’s Plex library');
	await expect(page.getByRole('region', { name: 'Current media' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Leave room' }).click();
	await expect(page.getByRole('link', { name: /Private movie/ })).toBeVisible();
	expect(f.roomWrites()).toBe(0);
});

test('legacy media links keep the library permission gate after member sign-in', async ({
	page
}) => {
	await fixture(page, true, { roomLibraryDenied: true });
	await page.goto(`/?mediaId=${rawId}`);
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await signIn(page);
	await expect(page.getByRole('heading', { name: 'Plex access required' })).toBeVisible();
	await expect(page.getByRole('dialog')).toContainText('share this media’s Plex library');
	await expect(page.getByText('Loading room...', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Leave room' }).click();
	await expect(page.getByRole('link', { name: /Public movie/ })).toBeVisible();
});

test('library revocation refreshes the catalog while the member retains another library', async ({
	page
}) => {
	const f = await fixture(page, true, { extraLibrary: true });
	await page.goto('/public-room');
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	await signIn(page);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: /Other library movie/ })).toBeVisible();
	f.revokeExtraLibrary();
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await expect(page.getByRole('link', { name: /Other library movie/ })).toHaveCount(0);
	await expect(page.getByRole('link', { name: /Private movie/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Plex account', exact: true })).toBeVisible();
});

test('account popup keeps a long name and avatar fallback readable on mobile', async ({ page }) => {
	const name = 'LongPlexUsername'.repeat(8);
	await fixture(page, true, { name });
	await page.route(`**/static/pfp/${plexProfileId}.png*`, (route) =>
		route.fulfill({ status: 404 })
	);
	await page.setViewportSize({ width: 320, height: 844 });
	await page.goto('/public-room');
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	await signIn(page);
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText(name, { exact: true })).toBeVisible();
	await expect(dialog.getByRole('img', { name: `${name} pfp`, exact: true })).toHaveText('L');
	await expect(dialog.locator('img')).toHaveCount(0);
	expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Plex profile overrides an Encoded room and sign-out restores guest customization', async ({
	page
}) => {
	await fixture(page);
	await page.addInitScript(() => {
		localStorage.setItem('name', 'Saved guest');
		localStorage.setItem('id', 'saved-guest-avatar');
	});
	await page.route('**/be/media/encoded-fixture', (route) =>
		route.fulfill({
			json: {
				Id: 'encoded-fixture',
				Source: 'processed',
				Input: 'Public movie.mkv',
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
		})
	);
	await page.route('**/be/rooms/public-room', (route) =>
		route.fulfill({ json: { roomId: 'public-room', mediaId: 'encoded-fixture' } })
	);
	await page.goto('/public-room/media/encoded-fixture');
	const profile = page.getByRole('button', { name: 'Open profile settings', exact: true });
	await expect(profile).toContainText('Saved guest');
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	await signIn(page);
	await expectAccountIdentity(page);
	await page.keyboard.press('Escape');
	await expect(profile).toContainText('Test member');
	await profile.click();
	await expect(page.getByRole('heading', { name: 'Plex account', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Sign out of Plex' }).click();
	await expect(profile).toContainText('Saved guest');
	await profile.click();
	await expect(page.getByRole('heading', { name: 'Profile Settings', exact: true })).toBeVisible();
	await expect(page.getByRole('textbox').last()).toHaveValue('Saved guest');
	expect(
		await page.evaluate(() => ({
			name: localStorage.getItem('name'),
			id: localStorage.getItem('id')
		}))
	).toEqual({ name: 'Saved guest', id: 'saved-guest-avatar' });
});

test('HTTP network addresses explain HTTPS before opening a popup or starting a PIN', async ({
	page,
	baseURL
}) => {
	// Serve the real frontend under a non-loopback origin without requiring a
	// LAN interface or DNS entry. Auth and catalog requests use the fixture below.
	const origin = 'http://192.0.2.1';
	// Next's development runtime also needs its real HMR connection to hydrate.
	await page.routeWebSocket('**/_next/hmr**', (route) => {
		const target = new URL(route.url());
		const server = new URL(baseURL!);
		target.host = server.host;
		target.protocol = server.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(target);
		socket.binaryType = 'arraybuffer';
		socket.addEventListener('message', (event) =>
			route.send(typeof event.data === 'string' ? event.data : Buffer.from(event.data))
		);
		route.onMessage((message) => {
			if (socket.readyState === WebSocket.OPEN) socket.send(message);
		});
		route.onClose(() => socket.close());
	});
	await page.route(`${origin}/**`, async (route) => {
		const url = new URL(route.request().url());
		const response = await page.request.get(new URL(url.pathname + url.search, baseURL!).href);
		await route.fulfill({ response });
	});
	const f = await fixture(page);
	const mutations: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().includes('/auth/plex/'))
			mutations.push(request.url());
	});
	let popups = 0;
	page.on('popup', () => popups++);
	await page.goto(`${origin}/public-room`);
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	await page.getByRole('button', { name: 'Continue with Plex' }).click();
	const alert = page.getByRole('dialog').getByRole('alert');
	await expect(alert).toContainText('requires HTTPS on a network address');
	await expect(alert).toContainText('localhost');
	await expect(page.getByRole('button', { name: 'Continue with Plex' })).toBeEnabled();
	expect(popups).toBe(0);
	expect(mutations).toEqual([]);
	expect(f.authorizationsOpened()).toBe(0);
});

test('blocked cookies are reported before opening Plex authorization', async ({ page }) => {
	const f = await fixture(page, true, { cookiesBlocked: true });
	await page.goto('/public-room');
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	const popup = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Continue with Plex' }).click();
	const authWindow = await popup;
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('sign-in cookie');
	await expect(page.getByRole('button', { name: 'Continue with Plex' })).toBeEnabled();
	await expect.poll(() => authWindow.isClosed()).toBe(true);
	expect(f.authorizationsOpened()).toBe(0);
	await expect(page.getByRole('link', { name: /Private movie/ })).toHaveCount(0);
});

test('delayed authorization survives a closed popup handle and a stale focus refresh', async ({
	page
}) => {
	const f = await fixture(page, true, { manualAuthorization: true });
	await page.goto('/public-room');
	await page.getByRole('button', { name: 'Sign in with Plex', exact: true }).click();
	const popup = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Continue with Plex' }).click();
	const authWindow = await popup;
	await expect(authWindow).toHaveURL(/https:\/\/app\.plex\.tv\/auth/);
	let releaseRefresh!: () => void;
	const heldRefresh = new Promise<void>((resolve) => {
		releaseRefresh = resolve;
	});
	await page.route('**/be/auth/plex/session', async (route) => {
		await heldRefresh;
		await route.fulfill({ json: { enabled: true, authenticated: false, canAccessRaw: false } });
	});
	const staleRequest = page.waitForRequest('**/be/auth/plex/session');
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await staleRequest;
	await authWindow.close();
	// Another pending response must not interpret a severed handle as cancellation.
	const pending = await page.waitForResponse('**/be/auth/plex/poll');
	expect(pending.status()).toBe(202);
	f.authorize();
	await expect(page.getByRole('button', { name: 'Sign out of Plex' })).toBeVisible();
	await expectAccountIdentity(page);
	const staleResponse = page.waitForResponse('**/be/auth/plex/session');
	releaseRefresh();
	await staleResponse;
	await page.unroute('**/be/auth/plex/session');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: /Private movie/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Plex account', exact: true })).toBeVisible();
});
