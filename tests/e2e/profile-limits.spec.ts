import { expect, test, type Page } from '@playwright/test';

async function profileFixture(page: Page, usernameLimit = 4) {
	await page.addInitScript(() => {
		localStorage.setItem('name', 'Dan');
		localStorage.setItem('id', 'profile-limit-viewer');
	});
	await page.route('**/api/runtime-env', (route) =>
		route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	await page.route('**/be/auth/plex/session', (route) =>
		route.fulfill({ json: { enabled: false, authenticated: false, canAccessRaw: false } })
	);
	await page.route('**/be/profile/limits', (route) =>
		route.fulfill({ json: { maxPfpBytes: 1024, maxUsernameLength: usernameLimit } })
	);
	const profileMessages: { type?: string; name?: string }[] = [];
	await page.routeWebSocket('**/be/sync/**', (socket) => {
		socket.onMessage((message) => {
			const payload = JSON.parse(message.toString()) as { type?: string; name?: string };
			if (payload.type === 'profile') profileMessages.push(payload);
		});
	});
	await page.route('**/be/rooms/profile-limit-room', (route) =>
		route.fulfill({ json: { roomId: 'profile-limit-room', mediaId: 'profile-limit-movie' } })
	);
	await page.route('**/be/media/profile-limit-movie', (route) =>
		route.fulfill({
			json: {
				Id: 'profile-limit-movie',
				Source: 'processed',
				Input: 'Profile Limits.mkv',
				State: 'complete',
				Duration: 60,
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
	await page.route('**/static/profile-limit-movie/**', (route) => route.fulfill({ status: 404 }));
	await page.route('**/static/pfp/**', (route) => route.fulfill({ status: 404 }));
	await page.goto('/profile-limit-room/media/profile-limit-movie');
	await page.getByRole('button', { name: 'Open profile settings', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Username' })).toBeEnabled();
	return profileMessages;
}

test('avatars start with their revision URL instead of downloading an unversioned copy first', async ({
	page
}) => {
	const requests: string[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith('/static/pfp/')) requests.push(url.search);
	});
	await profileFixture(page);
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	expect(requests.every((query) => /^\?\d+$/.test(query))).toBe(true);
});

test('configured guest name limit rejects long names and counts Unicode consistently', async ({
	page
}) => {
	const messages = await profileFixture(page);
	const username = page.getByRole('textbox', { name: 'Username' });
	await username.fill('😀枯水ab');
	await expect(username).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
		'Username must be 4 characters or fewer.'
	);
	await page.keyboard.press('Escape');
	await expect.poll(() => page.evaluate(() => localStorage.getItem('name'))).toBe('Dan');
	expect(messages.some((message) => message.name === '😀枯水ab')).toBeFalsy();
	await page.getByRole('button', { name: 'Open profile settings', exact: true }).click();
	await username.fill('  😀枯水a  ');
	await expect(username).toHaveAttribute('aria-invalid', 'false');
	await expect(page.getByText('4/4 characters', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect.poll(() => page.evaluate(() => localStorage.getItem('name'))).toBe('😀枯水a');
});

test('32-character guest limit accepts the boundary and rejects one more character', async ({
	page
}) => {
	await profileFixture(page, 32);
	const username = page.getByRole('textbox', { name: 'Username' });
	await username.fill('😀'.repeat(32));
	await expect(username).toHaveAttribute('aria-invalid', 'false');
	await expect(page.getByText('32/32 characters', { exact: true })).toBeVisible();
	await username.fill('😀'.repeat(33));
	await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
		'Username must be 32 characters or fewer.'
	);
});

test('avatar limit blocks oversized files before upload and permits the exact size', async ({
	page
}) => {
	await profileFixture(page);
	let uploads = 0;
	await page.route('**/be/pfp/**', (route) => {
		uploads++;
		return route.fulfill({ json: { revision: 101 } });
	});
	const upload = page.getByRole('dialog').locator('input[type="file"]');
	await upload.setInputFiles({
		name: 'large.png',
		mimeType: 'image/png',
		buffer: Buffer.alloc(1025)
	});
	await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
		'Avatar file is too large. Maximum size is 1,024 bytes.'
	);
	await expect(upload).toHaveValue('');
	expect(uploads).toBe(0);
	await upload.setInputFiles({
		name: 'boundary.png',
		mimeType: 'image/png',
		buffer: Buffer.alloc(1024)
	});
	await expect.poll(() => uploads).toBe(1);
	await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
	await expect(upload).toHaveValue('');
});

test('backend upload rejection remains visible in the profile dialog', async ({ page }) => {
	await profileFixture(page);
	await page.route('**/be/pfp/**', (route) =>
		route.fulfill({ status: 413, body: 'Avatar file is too large. Maximum size is 64 bytes.' })
	);
	await page
		.getByRole('dialog')
		.locator('input[type="file"]')
		.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.alloc(100) });
	await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
		'Avatar file is too large. Maximum size is 64 bytes.'
	);
});

test('profile controls wait for authoritative limits and recover after retry', async ({ page }) => {
	await profileFixture(page);
	await page.route('**/be/profile/limits', (route) => route.fulfill({ status: 503 }));
	await page.reload();
	await page.getByRole('button', { name: 'Open profile settings', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Username' })).toBeDisabled();
	await expect(page.getByRole('dialog').locator('input[type="file"]')).toBeDisabled();
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
		'Unable to load profile limits'
	);
	await page.route('**/be/profile/limits', (route) =>
		route.fulfill({ json: { maxPfpBytes: 1024, maxUsernameLength: 4 } })
	);
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Username' })).toBeEnabled();
	await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});
