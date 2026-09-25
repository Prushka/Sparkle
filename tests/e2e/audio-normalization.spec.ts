import { expect, test } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

// Exercise ordinary browser autoplay policy, including cold encoder startup.
test.use({ launchOptions: { args: [] } });

test('normalization is local, persistent, responsive, and leaves room playback controls intact', async ({
	browser,
	request,
	baseURL
}) => {
	test.skip(
		!existsSync('cache/audio-normalization/stereo.mp4'),
		'Run the audio qualification script to create disposable media'
	);
	const mediaId = 'normalization-fixture',
		roomId = `normalize-${Date.now()}`;
	const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';
	expect((await request.post(`${backend}/rooms`, { data: { roomId, mediaId } })).ok()).toBe(true);
	const bytes = readFileSync('cache/audio-normalization/stereo.mp4');
	const pages = await Promise.all([browser.newPage(), browser.newPage()]);
	const errors: string[] = [];
	try {
		for (const page of pages) {
			page.on('pageerror', (e) => errors.push(e.message));
			await page.route('**/api/runtime-env', (route) =>
				route.fulfill({ json: { backendBaseUrl: backend, staticBaseUrl: '/static' } })
			);
			await page.route(`**/be/media/${mediaId}`, (route) =>
				route.fulfill({
					json: {
						Id: mediaId,
						Source: 'processed',
						Input: 'Normalization fixture.mkv',
						State: 'complete',
						Duration: 48,
						EncodedCodecs: ['h264-8bit'],
						Files: { 'h264-8bit.mp4': bytes.length },
						MappedAudio: {},
						Streams: [{ Index: 0, CodecType: 'video', CodecName: 'h264', Width: 320, Height: 180 }],
						Chapters: [],
						DominantColors: [],
						JobModTime: 1
					}
				})
			);
			await page.route(`**/static/${mediaId}/**`, (route) => {
				if (!new URL(route.request().url()).pathname.endsWith('.mp4'))
					return route.fulfill({ status: 404 });
				const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
				const start = Number(range?.[1] || 0),
					end = range?.[2] ? Number(range[2]) : bytes.length - 1;
				return route.fulfill({
					status: range ? 206 : 200,
					contentType: 'video/mp4',
					headers: {
						'Accept-Ranges': 'bytes',
						...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {})
					},
					body: bytes.subarray(start, end + 1)
				});
			});
			await page.goto(`${baseURL}/${roomId}/media/${mediaId}`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect
				.poll(() => page.locator('video').evaluate((v) => v.currentTime), { timeout: 15000 })
				.toBeGreaterThan(1);
		}
		const [a, b] = pages;
		const player = a.locator('[data-media-player]'),
			other = b.locator('[data-media-player]');
		const button = a.getByRole('button', { name: 'Normalize audio', exact: true });
		const boost = (value: number) =>
			player.evaluate(
				(el, gain) =>
					new Promise<number | null>((resolve) => {
						el.addEventListener(
							'audio-gain-change',
							(event) => resolve((event as CustomEvent<number | null>).detail),
							{ once: true }
						);
						el.dispatchEvent(
							new CustomEvent('media-audio-gain-change-request', {
								detail: gain,
								bubbles: true,
								composed: true
							})
						);
					}),
				value
			);
		// Boost before normalization must not claim a competing MediaElementSource.
		expect(await boost(2)).toBe(2);
		await player.hover();
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		await expect(player).toHaveAttribute('data-normalization-state', 'active');
		await expect(other).toHaveAttribute('data-normalization-state', 'off');
		await expect
			.poll(async () => Number(await player.getAttribute('data-normalization-gain-d-b')), {
				timeout: 10000
			})
			.toBeGreaterThan(1);
		expect(await a.evaluate(() => localStorage.getItem('sparkle.audio.normalize'))).toBe('true');
		await player.focus();
		await a.keyboard.press('k');
		await expect(other).toHaveAttribute('data-paused', '');
		expect(await boost(1)).toBeNull();
		await player.hover();
		await button.click();
		await expect(player).toHaveAttribute('data-normalization-state', 'off');
		await expect(player).toHaveAttribute('data-paused', '');
		await expect(other).toHaveAttribute('data-paused', '');
		await player.focus();
		await a.keyboard.press('ArrowRight');
		await expect.poll(() => b.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(6);
		for (const width of [1280, 390, 320]) {
			await a.setViewportSize({ width, height: 844 });
			await player.hover();
			await button.focus();
			await expect(button).toBeVisible();
			const bounds = (await button.boundingBox())!;
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
			const settings = await a.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(settings!.x + 1);
		}
		await button.click();
		await a.setViewportSize({ width: 1280, height: 844 });
		await a.reload();
		await a.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => a.locator('video').evaluate((v) => v.readyState)).toBeGreaterThan(1);
		await a.mouse.move(0, 840);
		await player.hover();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		await expect(player).toHaveAttribute('data-normalization-state', 'active');
		// The reverse order and clearing Boost must retain the normalization graph.
		expect(await boost(1.5)).toBe(1.5);
		expect(await boost(1)).toBeNull();
		await expect(player).toHaveAttribute('data-can-play', '');
		await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
		await a.getByRole('button', { name: 'Play', exact: true }).click({ force: true });
		await expect(other).not.toHaveAttribute('data-paused', '');
		expect(errors).toEqual([]);
	} finally {
		await Promise.all(pages.map((page) => page.close()));
	}
});

for (const mode of ['compatible', 'av1', 'hevc'] as const) {
	test(`Raw ${mode} survives saved normalization, room startup, toggles and reconnect`, async ({
		browser,
		request,
		baseURL
	}) => {
		test.skip(
			!existsSync('cache/audio-normalization/hdr-flac.mkv') ||
				(mode !== 'compatible' && !existsSync(`cache/encoded-audio-fixture/${mode}/master.m3u8`)),
			'Generate the audio fixtures first'
		);
		const mediaId = `normalization-raw-${mode}-fixture`,
			roomId = `normalize-raw-${Date.now()}`;
		const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';
		expect((await request.post(`${backend}/rooms`, { data: { roomId, mediaId } })).ok()).toBe(true);
		const bytes = readFileSync('cache/audio-normalization/hdr-flac.mkv');
		const pages = await Promise.all([browser.newPage(), browser.newPage()]);
		try {
			for (const [index, page] of pages.entries()) {
				await page.addInitScript(
					({ enabled, mode }) => {
						localStorage.setItem('sparkle.audio.normalize', String(enabled));
						localStorage.setItem('sparkle.raw.hdr', mode);
						if (mode !== 'compatible') localStorage.setItem('sparkle.raw.audio', 'Alternate test');
					},
					{ enabled: index === 0, mode }
				);
				await page.route('**/encoding/capabilities', (route) =>
					route.fulfill({ json: { codecs: ['av1', 'hevc'] } })
				);
				await page.route(`**/media/${mediaId}/parts/1/encoded/**`, async (route) => {
					const resource = new URL(route.request().url()).pathname.split('/').at(-1)!;
					if (resource === 'manifest')
						return route.fulfill({
							json: {
								fingerprint: 'fixture',
								playlist: 'master.m3u8',
								codec: mode,
								output: 'SDR',
								duration: 30,
								width: 320,
								height: 180,
								audio: true,
								subtitleTracks: [],
								hasFonts: false,
								segmentSeconds: 6
							}
						});
					if (!/^[\w.-]+$/.test(resource)) return route.fulfill({ status: 404 });
					if (mode === 'av1' && resource === 'video-init.mp4')
						await new Promise((resolve) => setTimeout(resolve, 6500));
					return route.fulfill({
						body: readFileSync(`cache/encoded-audio-fixture/${mode}/${resource}`),
						contentType: resource.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
					});
				});
				await page.route('**/api/runtime-env', (route) =>
					route.fulfill({ json: { backendBaseUrl: backend, staticBaseUrl: '/static' } })
				);
				await page.route(`**/be/media/${mediaId}`, (route) =>
					route.fulfill({
						json: {
							Id: mediaId,
							Source: 'plex',
							Input: 'Raw normalization fixture.mkv',
							Title: { title: 'Raw normalization fixture', titleId: mediaId },
							EncodedCodecs: [],
							JobModTime: 1,
							ExtractedQuality: '',
							width: 320,
							height: 180,
							State: 'complete',
							Duration: mode === 'compatible' ? 48 : 30,
							Files: {},
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
										url: `/media/${mediaId}/parts/1/file`,
										start: 0,
										duration: mode === 'compatible' ? 48 : 30,
										size: bytes.length,
										streams: [
											{
												id: 0,
												index: 0,
												streamType: 1,
												codec: 'hevc',
												bitDepth: 10,
												colorTrc: 'smpte2084',
												colorPrimaries: 'bt2020',
												colorSpace: 'bt2020nc'
											},
											{
												id: 1,
												index: 1,
												streamType: 2,
												codec: 'flac',
												channels: 6,
												displayTitle: '5.1 test'
											},
											{
												id: 2,
												index: 2,
												streamType: 2,
												codec: 'opus',
												channels: 2,
												displayTitle: 'Alternate test'
											}
										]
									}
								]
							}
						}
					})
				);
				await page.route(`**/media/${mediaId}/parts/1/file`, (route) => {
					const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
					const start = Number(range?.[1] || 0),
						end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
					return route.fulfill({
						status: range ? 206 : 200,
						contentType: 'video/x-matroska',
						headers: {
							'Accept-Ranges': 'bytes',
							...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {})
						},
						body: bytes.subarray(start, end + 1)
					});
				});
				await page.goto(`${baseURL}/${roomId}/media/${mediaId}`);
				await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
				await expect(page.locator('.sparkle-raw-surface')).toHaveCount(1);
				await expect
					.poll(
						() =>
							page
								.locator('.sparkle-raw-surface video')
								.evaluate((v: HTMLVideoElement) => v.currentTime),
						{ timeout: 20000 }
					)
					.toBeGreaterThan(1);
			}
			const [a, b] = pages,
				player = a.locator('[data-media-player]'),
				other = b.locator('[data-media-player]');
			await expect(player).toHaveAttribute('data-normalization-state', 'active');
			await expect(other).toHaveAttribute('data-normalization-state', 'off');
			await player.focus();
			await a.keyboard.press('k');
			await expect(other).toHaveAttribute('data-paused', '');
			await player.hover();
			await a.getByRole('button', { name: 'Normalize audio', exact: true }).click();
			await expect(player).toHaveAttribute('data-normalization-state', 'off');
			await expect(other).toHaveAttribute('data-paused', '');
			const beforeSeek = await a
				.locator('.sparkle-raw-surface video')
				.evaluate((v: HTMLVideoElement) => v.currentTime);
			await player.focus();
			await a.keyboard.press('ArrowRight');
			await expect
				.poll(() =>
					b.locator('.sparkle-raw-surface video').evaluate((v: HTMLVideoElement) => v.currentTime)
				)
				.toBeGreaterThan(beforeSeek + 4.5);
			await a.reload();
			await a.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 20000 });
			await expect(a.locator('.sparkle-raw-surface')).toHaveCount(1);
			await expect(a.getByRole('button', { name: 'Normalize audio', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
			await a.getByRole('button', { name: 'Play', exact: true }).click({ force: true });
			await expect(other).not.toHaveAttribute('data-paused', '');
			await expect(player).toHaveAttribute('data-normalization-state', 'active');
			// A native decoder failure used to leave the room looking permanently
			// buffered. Exercise libmedia's native error bridge without publishing
			// the browser's detailed diagnostic or pausing the other participant.
			await a.locator('.sparkle-raw-surface video').evaluate((video) => {
				Object.defineProperty(video, 'error', {
					configurable: true,
					value: { code: 3, message: 'Private native pipeline diagnostic' }
				});
				video.dispatchEvent(new Event('error'));
			});
			await expect(player).toHaveAttribute('data-raw-ready', 'false');
			await expect
				.poll(() =>
					a
						.locator('.sparkle-raw-surface video')
						.evaluate((video: HTMLVideoElement) => video.paused)
				)
				.toBe(true);
			await expect(other).not.toHaveAttribute('data-paused', '');
			await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
		} finally {
			await Promise.all(pages.map((page) => page.close()));
		}
	});
}
