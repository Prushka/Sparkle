import { expect, test } from '@playwright/test';

const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';
const mediaId = 'library-return-fixture';

for (const joined of [false, true]) {
	test(`return to Library clears media for both clients ${joined ? 'after' : 'before'} joining playback`, async ({
		browser,
		request,
		baseURL
	}) => {
		const roomId = `library-return-${Date.now()}`;
		const roomUrl = `${backend}/rooms/${roomId}`;
		expect(
			(await request.post(`${backend}/rooms`, { data: { roomId, mediaId } })).ok()
		).toBeTruthy();
		const pages = await Promise.all([browser.newPage(), browser.newPage()]);
		try {
			for (const page of pages) {
				await page.route('**/api/runtime-env', (route) =>
					route.fulfill({ json: { backendBaseUrl: backend, staticBaseUrl: '/static' } })
				);
				await page.route(`**/media/${mediaId}`, (route) =>
					route.fulfill({
						json: {
							Id: mediaId,
							Source: 'processed',
							Input: 'Library return fixture.mkv',
							State: 'complete',
							Duration: 60,
							EncodedCodecs: ['h264-8bit'],
							Files: { 'h264-8bit.mp4': 1024 },
							MappedAudio: {},
							Streams: [
								{ Index: 0, CodecType: 'video', CodecName: 'h264', Width: 1280, Height: 720 }
							],
							Chapters: [],
							DominantColors: [],
							JobModTime: 1
						}
					})
				);
				await page.route(`**/static/${mediaId}/**`, (route) => route.fulfill({ status: 404 }));
				await page.route('**/library/sources', (route) => route.fulfill({ json: { sources: [] } }));
				await page.route('**/library/items?*', (route) =>
					route.fulfill({ json: { items: [], total: 0 } })
				);
				await page.goto(`${baseURL}/${roomId}/media/${mediaId}?query=fixture&mediaId=${mediaId}`);
				await expect(page.getByRole('button', { name: 'Go back to library' })).toBeVisible();
				if (joined) {
					const connected = page.waitForEvent('websocket', {
						predicate: (socket) =>
							socket.url().includes(`/sync/${roomId}/`) && !socket.url().includes('/media_')
					});
					await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
					await connected;
				}
			}
			const returnButton = pages[0].getByRole('button', { name: 'Go back to library' });
			if (!joined) {
				// A failed update must keep the current room/media available for retry.
				await pages[0].route(`**/rooms/${roomId}`, (route) =>
					route.request().method() === 'PUT' ? route.fulfill({ status: 503 }) : route.continue()
				);
				const failure = pages[0].waitForResponse((response) => response.status() === 503);
				await returnButton.click();
				await failure;
				await expect(returnButton).toBeVisible();
				expect((await (await request.get(roomUrl)).json()).mediaId).toBe(mediaId);
				await pages[0].unroute(`**/rooms/${roomId}`);
			}
			await returnButton.click();
			for (const page of pages) {
				await expect(page.getByRole('navigation', { name: 'Library hierarchy' })).toBeVisible();
				expect(new URL(page.url()).pathname).toBe(`/${roomId}`);
				expect(new URL(page.url()).searchParams.get('query')).toBe('fixture');
				expect(new URL(page.url()).searchParams.has('mediaId')).toBe(false);
			}
			const record = await (await request.get(roomUrl)).json();
			expect(record.roomId).toBe(roomId);
			expect(record.mediaId).toBe('');
			await pages[0].reload();
			await expect(pages[0].getByRole('navigation', { name: 'Library hierarchy' })).toBeVisible();
		} finally {
			await Promise.all(pages.map((page) => page.close()));
		}
	});
}
