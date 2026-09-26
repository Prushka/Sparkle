import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('native output migrates tone mapping and preserves two-client playback', async ({
	browser,
	request,
	baseURL
}) => {
	const file = await readFile('cache/audio-normalization/hdr-flac.mkv').catch(() => null);
	test.skip(!file, 'Run npm run test:audio to prepare the disposable HEVC/FLAC fixture');
	const id = 'native-output-fixture';
	const room = `native-output-${Date.now()}`;
	const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';
	expect(
		(await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: id } })).ok()
	).toBe(true);
	const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
	const pages = await Promise.all(contexts.map((context) => context.newPage()));
	try {
		for (const [index, page] of pages.entries()) {
			await page.addInitScript(
				(mode) => {
					if (!localStorage.getItem('sparkle.raw.hdr'))
						localStorage.setItem('sparkle.raw.hdr', mode);
				},
				index === 0 ? 'sdr' : 'compatible'
			);
			await page.route('**/auth/plex/session', (route) =>
				route.fulfill({ json: { enabled: false, authenticated: false, canAccessRaw: true } })
			);
			await page.route('**/encoding/capabilities', (route) =>
				route.fulfill({ json: { codecs: [] } })
			);
			await page.route(new URL(`${backend}/media/${id}`, baseURL).href, (route) =>
				route.fulfill({
					json: {
						Id: id,
						Input: 'Native output fixture.mkv',
						Source: 'plex',
						State: 'complete',
						Files: {},
						Title: 'Native output fixture',
						Duration: 48,
						width: 320,
						height: 180,
						EncodedCodecs: [],
						MappedAudio: {},
						Streams: [],
						Chapters: [],
						DominantColors: [],
						Raw: {
							container: 'mkv',
							videoCodec: 'hevc',
							versions: [],
							parts: [
								{
									id: '1',
									url: '/native-output-file',
									size: file!.length,
									duration: 48,
									start: 0,
									streams: [
										{
											id: 0,
											index: 0,
											streamType: 1,
											codec: 'hevc',
											colorTrc: 'smpte2084',
											bitDepth: 10
										},
										{
											id: 1,
											index: 1,
											streamType: 2,
											codec: 'flac',
											channels: 6,
											displayTitle: 'FLAC 5.1'
										}
									]
								}
							]
						}
					}
				})
			);
			await page.route('**/native-output-file', (route) => {
				const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
				const start = range ? Number(range[1]) : 0;
				const end = Math.min(range?.[2] ? Number(range[2]) : file!.length - 1, file!.length - 1);
				return route.fulfill({
					status: range ? 206 : 200,
					contentType: 'application/octet-stream',
					headers: {
						'Accept-Ranges': 'bytes',
						...(range ? { 'Content-Range': `bytes ${start}-${end}/${file!.length}` } : {})
					},
					body: file!.subarray(start, end + 1)
				});
			});
			await page.goto(`${baseURL}/${room}/media/${id}`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect(page.locator('[data-media-player]')).toHaveAttribute(
				'data-raw-renderer',
				'native'
			);
			await expect
				.poll(() =>
					page
						.locator('.sparkle-raw-surface video')
						.evaluate((v: HTMLVideoElement) => v.currentTime)
				)
				.toBeGreaterThan(1);
		}
		const first = pages[0],
			player = first.locator('[data-media-player]');
		expect(await first.evaluate(() => localStorage.getItem('sparkle.raw.hdr'))).toBe('compatible');
		await player.hover();
		await first.getByRole('button', { name: 'Settings', exact: true }).click();
		await first.getByRole('menuitem', { name: /^Video Settings/ }).click();
		await expect(
			first.getByRole('menuitemradio', { name: 'Tone mapping', exact: true })
		).toHaveCount(0);
		await expect(
			first.getByRole('menuitemradio', { name: 'Compatible', exact: true })
		).toHaveAttribute('aria-checked', 'true');
		const beforeModeChange = await first
			.locator('.sparkle-raw-surface video')
			.evaluate((video: HTMLVideoElement) => video.currentTime);
		await first.getByRole('menuitemradio', { name: 'Automatic', exact: true }).click();
		await expect(player).toHaveAttribute('data-raw-blocked', 'true');
		await expect(first.locator('[data-raw-hdr-status]')).toContainText(
			'Automatic requires Encoded AV1 or HEVC'
		);
		// An unavailable local encode must not pause the other participant.
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		await first.getByRole('menuitemradio', { name: 'Compatible', exact: true }).click();
		await expect(player).toHaveAttribute('data-raw-ready', 'true');
		await expect(player).toHaveAttribute('data-raw-renderer', 'native');
		await expect
			.poll(() =>
				first
					.locator('.sparkle-raw-surface video')
					.evaluate((video: HTMLVideoElement) => video.currentTime)
			)
			.toBeGreaterThanOrEqual(beforeModeChange - 0.5);
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		await first.keyboard.press('Escape');
		await first.keyboard.press('Escape');
		await player.focus();
		await first.keyboard.press('k');
		await expect(pages[1].locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		await first.keyboard.press('ArrowRight');
		await expect
			.poll(async () => {
				const times = await Promise.all(
					pages.map((page) =>
						page
							.locator('.sparkle-raw-surface video')
							.evaluate((v: HTMLVideoElement) => v.currentTime)
					)
				);
				return Math.abs(times[0] - times[1]);
			})
			.toBeLessThan(1.5);
		await first.keyboard.press('k');
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		await pages[1].reload();
		const join = pages[1].getByRole('button', { name: 'Join Watch Room', exact: true });
		await join.click();
		await expect(pages[1].locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true');
		await expect
			.poll(async () => {
				const times = await Promise.all(
					pages.map((page) =>
						page
							.locator('.sparkle-raw-surface video')
							.evaluate((v: HTMLVideoElement) => v.currentTime)
					)
				);
				return Math.abs(times[0] - times[1]);
			})
			.toBeLessThan(2);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});
