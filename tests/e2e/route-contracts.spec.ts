import { expect, test } from '@playwright/test';

test('removed route aliases and the unused room mutation API return 404', async ({ request }) => {
	for (const path of ['/rooms/new', '/rooms/old-room/media/old-title', '/old-room/library']) {
		expect((await request.get(path)).status(), path).toBe(404);
	}
	expect((await request.get('/api/cm?room=old-room&mediaId=old-title')).status()).toBe(404);
	expect((await request.post('/api/cm', { data: { roomId: 'old-room' } })).status()).toBe(404);
});

test('canonical room paths ignore old query-based room and media aliases', async ({ page }) => {
	const roomReads: string[] = [];
	let writes = 0;
	await page.route('**/be/rooms**', (route) => {
		if (route.request().method() !== 'GET') writes++;
		roomReads.push(new URL(route.request().url()).pathname);
		return route.fulfill({ json: { roomId: 'path-room', mediaId: '' } });
	});
	await page.goto('/path-room?room=old-room&mediaId=old-title&channel_id=discord-room');
	await expect(page.getByRole('region', { name: 'Media library', exact: true })).toBeVisible();
	expect(roomReads.length).toBeGreaterThan(0);
	expect(new Set(roomReads)).toEqual(new Set(['/be/rooms/path-room']));
	expect(writes).toBe(0);
});

test('root media entry and Discord launch retain the canonical room and media path', async ({
	page
}) => {
	const creations: unknown[] = [];
	await page.route('**/be/rooms**', (route) => {
		if (route.request().method() === 'POST') creations.push(route.request().postDataJSON());
		return route.fulfill({ json: { roomId: 'discord-room', mediaId: 'selected-title' } });
	});
	await page.route('**/be/media/selected-title', (route) => route.fulfill({ status: 500 }));
	await page.goto('/?mediaId=selected-title&channel_id=discord-room&room=obsolete-room');
	await expect(page).toHaveURL('/discord-room/media/selected-title?channel_id=discord-room');
	await expect(page.getByRole('heading', { name: 'Unable to load room' })).toBeVisible();
	expect(creations.length).toBeGreaterThan(0);
	for (const creation of creations) {
		expect(creation).toEqual({ roomId: 'discord-room', mediaId: 'selected-title' });
	}
});
