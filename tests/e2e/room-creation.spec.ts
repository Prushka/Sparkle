import { expect, test } from '@playwright/test';

test('opening a missing room creates it and retains the room through reload', async ({
	page,
	request
}) => {
	const roomId = `recreated-${Date.now()}`;
	expect((await request.get(`/be/rooms/${roomId}`)).status()).toBe(404);
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Room URL or ID' }).fill(roomId);
	await page.getByRole('button', { name: 'Open room', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Media library', exact: true })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/${roomId}$`));
	expect(await (await request.get(`/be/rooms/${roomId}`)).json()).toMatchObject({
		roomId,
		mediaId: ''
	});
	await page.reload();
	await expect(page).toHaveURL(new RegExp(`/${roomId}$`));
	await expect(page.getByRole('region', { name: 'Media library', exact: true })).toBeVisible();
});

test('missing media links restore their title for two clients', async ({
	page,
	context,
	request
}) => {
	const roomId = `recreated-media-${Date.now()}`;
	const mediaId = 'room-creation-fixture';
	await context.route(`**/be/media/${mediaId}`, (route) =>
		route.fulfill({
			json: {
				Id: mediaId,
				Source: 'processed',
				Input: 'Restored title.mkv',
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
	await context.route(`**/static/${mediaId}/**`, (route) => route.fulfill({ status: 404 }));
	const other = await context.newPage();
	await Promise.all([
		page.goto(`/${roomId}/media/${mediaId}`),
		other.goto(`/${roomId}/media/${mediaId}`)
	]);
	for (const client of [page, other]) {
		await expect(client.getByRole('region', { name: 'Current media' })).toContainText(
			'Restored title'
		);
		await expect(
			client.getByRole('button', { name: 'Join Watch Room', exact: true })
		).toBeVisible();
	}
	expect(await (await request.get(`/be/rooms/${roomId}`)).json()).toMatchObject({
		roomId,
		mediaId
	});
	await page.getByRole('button', { name: 'Go back to library', exact: true }).click();
	for (const client of [page, other]) {
		await expect(client).toHaveURL(new RegExp(`/${roomId}$`));
		await expect(client.getByRole('region', { name: 'Media library', exact: true })).toBeVisible();
	}
});

for (const status of [401, 403, 500]) {
	test(`room read ${status} does not create or overwrite a room`, async ({ page }) => {
		let writes = 0;
		await page.route('**/be/rooms/protected-room', (route) =>
			route.fulfill({
				status,
				json: { code: status === 401 ? 'plex_sign_in_required' : 'plex_library_access_denied' }
			})
		);
		await page.route('**/be/rooms', (route) => {
			writes++;
			return route.fulfill({ status: 500 });
		});
		await page.goto('/protected-room');
		await expect(
			page.getByRole('heading', {
				name: status === 500 ? 'Unable to load room' : 'Plex access required'
			})
		).toBeVisible();
		expect(writes).toBe(0);
	});
}

test('missing media link creates its room and honors a concurrent visitor’s selection', async ({
	page
}) => {
	const writes: unknown[] = [];
	await page.route('**/be/rooms/expired-media', (route) => route.fulfill({ status: 404 }));
	await page.route('**/be/rooms', (route) => {
		writes.push(route.request().postDataJSON());
		return route.fulfill({ json: { roomId: 'expired-media', mediaId: 'selected-by-other' } });
	});
	await page.route('**/be/media/selected-by-other', (route) => route.fulfill({ status: 500 }));
	await page.goto('/expired-media/media/from-link');
	await expect(page).toHaveURL(/\/expired-media\/media\/selected-by-other$/);
	await expect(page.getByRole('heading', { name: 'Unable to load room' })).toBeVisible();
	expect(writes[0]).toEqual({ roomId: 'expired-media', mediaId: 'from-link' });
});
