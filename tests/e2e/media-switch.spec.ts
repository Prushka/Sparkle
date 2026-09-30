import { expect, test, type Page, type WebSocket } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';

test('same-room switches retain participation through delayed raw/processed readiness', async ({
	browser,
	request,
	baseURL
}) => {
	const file = await readFile('cache/audio-normalization/stereo.mp4').catch(() => null);
	test.skip(!file, 'Run npm run test:audio to prepare the disposable stereo fixture');
	const room = `media-switch-${Date.now()}`;
	const ids = ['switch-first', 'switch-raw', 'switch-last'];
	expect(
		(await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: ids[0] } })).ok()
	).toBe(true);
	const pages = await Promise.all([browser.newPage(), browser.newPage()]);
	const sockets: WebSocket[][] = [[], []];
	const metadata: string[][] = [[], []];
	const renders: string[] = [];
	const errors: string[] = [];
	let delayRaw = false;
	let releaseRaw = () => {};
	const rawGate = new Promise<void>((resolve) => (releaseRaw = resolve));
	let delayMetadata = false;
	let releaseMetadata = () => {};
	let metadataStarted = () => {};
	const metadataGate = new Promise<void>((resolve) => (releaseMetadata = resolve));
	const obsoleteLoad = new Promise<void>((resolve) => (metadataStarted = resolve));
	const player = (page: Page) => page.locator('[data-media-player]');
	try {
		for (const [index, page] of pages.entries()) {
			await page.addInitScript(() => {
				localStorage.setItem('sparkle.raw.hdr', 'compatible');
				document.addEventListener(
					'provider-setup',
					(event) => {
						const provider = (event as CustomEvent).detail;
						if (provider.type === 'sparkle-raw') (window as any).testRawProvider = provider;
					},
					true
				);
			});
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('websocket', (socket) => {
				if (socket.url().includes(`/sync/${room}/`) && !socket.url().includes('/media_'))
					sockets[index].push(socket);
			});
			page.on('request', (request) => {
				if (new URL(request.url()).searchParams.has('_rsc')) renders.push(request.url());
			});
			await page.route('**/auth/plex/session', (route) =>
				route.fulfill({ json: { enabled: false, authenticated: false, canAccessRaw: true } })
			);
			await page.route('**/encoding/capabilities', (route) =>
				route.fulfill({ json: { codecs: [] } })
			);
			await page.route(new URL(`${backend}/media/switch-*`, baseURL).href, async (route) => {
				const id = new URL(route.request().url()).pathname.split('/').pop()!;
				metadata[index].push(id);
				if (
					delayMetadata &&
					index === 1 &&
					id === ids[1] &&
					metadata[index].filter((value) => value === id).length === 4
				) {
					metadataStarted();
					await metadataGate;
					await route.fulfill({ status: 503 });
					return;
				}
				await route.fulfill({
					json: {
						Id: id,
						Source: id === ids[1] ? 'plex' : 'processed',
						Input: `${id}.mkv`,
						Title: { title: id },
						State: 'complete',
						Duration: 48,
						EncodedCodecs: ['h264-8bit'],
						Files: {},
						MappedAudio: {},
						Streams: [],
						Chapters: [],
						DominantColors: [],
						JobModTime: 1,
						...(id === ids[1]
							? {
									Raw: {
										container: 'mp4',
										videoCodec: 'h264',
										versions: [],
										parts: [
											{
												id: '1',
												url: '/switch-file',
												size: file!.length,
												duration: 48,
												start: 0,
												streams: [
													{ id: 0, index: 0, streamType: 1, codec: 'h264' },
													{ id: 1, index: 1, streamType: 2, codec: 'aac', channels: 2 }
												]
											}
										]
									}
								}
							: {})
					}
				});
			});
			await page.route(/\/(?:switch-file|static\/switch-[^/]+\/.*\.mp4)$/, async (route) => {
				if (index === 1 && delayRaw && route.request().url().endsWith('/switch-file'))
					await rawGate;
				const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
				const start = range ? Number(range[1]) : 0;
				const end = Math.min(range?.[2] ? Number(range[2]) : file!.length - 1, file!.length - 1);
				await route.fulfill({
					status: range ? 206 : 200,
					contentType: 'video/mp4',
					headers: {
						'Accept-Ranges': 'bytes',
						...(range ? { 'Content-Range': `bytes ${start}-${end}/${file!.length}` } : {})
					},
					body: file!.subarray(start, end + 1)
				});
			});
			await page.route('**/library/sources', (route) => route.fulfill({ json: { sources: [] } }));
			await page.route('**/library/items?*', (route) =>
				route.fulfill({
					json: {
						items: ids.map((id) => ({
							id,
							source: 'processed',
							kind: 'movie',
							title: id,
							duration: 48
						})),
						total: ids.length
					}
				})
			);
			await page.goto(`${baseURL}/${room}/media/${ids[0]}?query=switch`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toBeEnabled();
			await expect(player(page)).not.toHaveAttribute('data-paused', '');
			await page
				.locator('#chat-page-input')
				.evaluate((el) => el.setAttribute('data-test-retained', 'yes'));
		}
		await player(pages[0]).focus();
		await pages[0].keyboard.press('k');
		await expect(player(pages[1])).toHaveAttribute('data-paused', '');
		delayRaw = true;
		renders.length = 0;
		await pages[0].getByRole('button', { name: 'Change media', exact: true }).click();
		await pages[0].getByRole('button', { name: /Encoded switch-raw/ }).click();
		for (const page of pages) {
			await expect(page).toHaveURL(new RegExp(`/media/${ids[1]}\\?query=switch$`), {
				timeout: 15000
			});
			await expect(page.locator('#chat-page-input')).toHaveAttribute('data-test-retained', 'yes');
			await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toBeEnabled();
		}
		expect(sockets.map((list) => list.length)).toEqual([1, 1]);
		expect(sockets.flat().every((socket) => !socket.isClosed())).toBe(true);
		expect(renders).toEqual([]);
		// One lookup supplies the countdown, one resolves the new title. The
		// provider must not add a third serialized metadata request.
		expect(metadata.map((list) => list.filter((id) => id === ids[1]).length)).toEqual([2, 2]);
		releaseRaw();
		for (const page of pages) {
			await expect(player(page)).toHaveAttribute('data-raw-ready', 'true');
			await expect(player(page)).toHaveAttribute('data-paused', '');
		}
		await player(pages[0]).focus();
		await pages[0].keyboard.press('ArrowRight');
		await expect
			.poll(async () => {
				const times = await Promise.all(
					pages.map((page) =>
						page
							.locator('.sparkle-raw-surface video')
							.evaluate((v: HTMLVideoElement) => v.currentTime)
					)
				);
				return times.every((time) => time >= 4) && Math.abs(times[0] - times[1]) < 1.5;
			})
			.toBe(true);
		// Recovery must revalidate metadata instead of indefinitely reusing the
		// initial source handoff, and must preserve the paused shared position.
		await pages[0].evaluate(() => (window as any).testRawProvider.recoverPlayback());
		expect(metadata[0].filter((id) => id === ids[1])).toHaveLength(3);
		for (const page of pages) await expect(player(page)).toHaveAttribute('data-paused', '');
		await pages[0].keyboard.press('k');
		await expect(player(pages[1])).not.toHaveAttribute('data-paused', '');
		await request.put(`${backend}/rooms/${room}`, { data: { mediaId: ids[2] } });
		for (const page of pages) {
			await expect(page).toHaveURL(new RegExp(`/media/${ids[2]}\\?query=switch$`), {
				timeout: 15000
			});
			await expect(page.locator('#chat-page-input')).toHaveAttribute('data-test-retained', 'yes');
			// The backend intentionally initializes each replacement title paused.
			await expect(player(page)).toHaveAttribute('data-paused', '');
		}
		expect(sockets.map((list) => list.length)).toEqual([1, 1]);
		// Replace a title again while the peer is still fetching its metadata.
		// A late failure from that obsolete generation must not replace the latest title.
		delayMetadata = true;
		await request.put(`${backend}/rooms/${room}`, { data: { mediaId: ids[1] } });
		await obsoleteLoad;
		await request.put(`${backend}/rooms/${room}`, { data: { mediaId: ids[0] } });
		for (const page of pages) {
			await expect(page).toHaveURL(new RegExp(`/media/${ids[0]}\\?query=switch$`), {
				timeout: 15000
			});
			await expect(player(page)).toHaveAttribute('data-can-play', '');
		}
		const failedObsolete = pages[1].waitForResponse((response) => response.status() === 503);
		releaseMetadata();
		await failedObsolete;
		// Back must resolve the current shared title, rather than restoring stale media.
		await pages[0].goBack();
		await expect(pages[0]).toHaveURL(new RegExp(`/media/${ids[0]}\\?query=switch$`));
		for (const page of pages) {
			await expect(page.locator('#chat-page-input')).toHaveAttribute('data-test-retained', 'yes');
			await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toBeEnabled();
		}
		expect(sockets.map((list) => list.length)).toEqual([1, 1]);
		expect(errors).toEqual([]);
	} finally {
		releaseRaw();
		releaseMetadata();
		await Promise.all(pages.map((page) => page.close()));
	}
});
