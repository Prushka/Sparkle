import { expect, test, type Page, type Route } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const root = 'cache/preview-fixtures';
const duration = 24;
function bytes(route: Route, body: Buffer, contentType: string) {
	const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
	const start = Number(range?.[1] || 0),
		end = Math.min(Number(range?.[2] || body.length - 1), body.length - 1);
	return route.fulfill({
		status: range ? 206 : 200,
		contentType,
		headers: {
			'Accept-Ranges': 'bytes',
			...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {})
		},
		body: body.subarray(start, end + 1)
	});
}

async function fixture(page: Page, transfer: string, mode: string) {
	const id = `preview-${transfer}`;
	const hdr = transfer !== 'bt709';
	await page.addInitScript((mode) => {
		localStorage.setItem('sparkle.raw.hdr', mode);
		document.addEventListener(
			'provider-setup',
			(e) => {
				(window as any).previewProvider = (e as CustomEvent).detail;
			},
			true
		);
	}, mode);
	await page.route('**/api/runtime-env', (r) =>
		r.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	await page.route('**/auth/plex/session', (r) =>
		r.fulfill({ json: { enabled: false, authenticated: false, canAccessRaw: true } })
	);
	await page.route('**/encoding/capabilities', (r) =>
		r.fulfill({ json: { codecs: ['av1', 'hevc'] } })
	);
	const original = readFileSync(`${root}/${transfer}/original.mkv`);
	await page.route(`**/be/media/${id}`, (r) =>
		r.fulfill({
			json: {
				Id: id,
				Input: `Preview ${transfer}`,
				Title: { title: `Preview ${transfer}` },
				Duration: duration,
				width: 640,
				height: 360,
				EncodedCodecs: [],
				MappedAudio: {},
				Streams: [],
				Chapters: [],
				DominantColors: [],
				JobModTime: 1,
				Raw: {
					container: 'mkv',
					videoCodec: 'hevc',
					versions: [],
					parts: [
						{
							id: '1',
							url: `/media/${id}/parts/1/file`,
							size: original.length,
							duration,
							start: 0,
							streams: [
								{
									id: 0,
									index: 0,
									streamType: 1,
									codec: 'hevc',
									bitDepth: hdr ? 10 : 8,
									colorTrc: transfer,
									colorPrimaries: hdr ? 'bt2020' : 'bt709',
									colorSpace: hdr ? 'bt2020nc' : 'bt709'
								},
								{ id: 1, index: 1, streamType: 2, codec: 'aac', channels: 1 }
							]
						}
					]
				}
			}
		})
	);
	await page.route(`**/be/media/${id}/parts/1/file`, (r) =>
		bytes(r, original, 'application/octet-stream')
	);
	await page.route(`**/be/media/${id}/parts/1/encoded/**`, (r) => {
		const path = new URL(r.request().url()).pathname.split('/'),
			codec = path.at(-2)!,
			resource = path.at(-1)!;
		if (resource === 'manifest')
			return r.fulfill({
				json: {
					fingerprint: 'preview-fixture',
					playlist: 'master.m3u8',
					codec,
					output: hdr ? (transfer === 'smpte2084' ? 'HDR10' : 'HLG') : 'SDR',
					duration,
					width: 640,
					height: 360,
					audio: true,
					audioChannels: 1,
					subtitleTracks: [],
					hasFonts: false,
					segmentSeconds: 6
				}
			});
		const file = `${root}/${transfer}/${codec}/${resource}`;
		if (!existsSync(file)) return r.fulfill({ status: 404 });
		return bytes(
			r,
			readFileSync(file),
			resource.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
		);
	});
	const requested: string[] = [];
	await page.route(`**/be/media/${id}/parts/1/preview/*`, async (r) => {
		requested.push(r.request().url());
		const n = Number(new URL(r.request().url()).pathname.split('/').at(-1)!.split('.')[0]);
		await r.fulfill({
			contentType: 'image/jpeg',
			body: readFileSync(`${root}/${transfer}/preview-${n * 5}.jpg`)
		});
	});
	return { id, requested };
}

async function hoverTime(page: Page, seconds: number) {
	await page.locator('[data-media-player]').hover();
	const rect = await page.getByRole('slider', { name: 'Seek', exact: true }).boundingBox();
	if (!rect) throw new Error('Seek bar is missing');
	await page.mouse.move(rect.x + (rect.width * seconds) / duration, rect.y + rect.height / 2);
}

for (const transfer of ['bt709', 'smpte2084', 'arib-std-b67']) {
	for (const mode of ['compatible', 'av1', 'hevc']) {
		test(`${transfer} ${mode}: hover previews preserve playback, cache frames and fit mobile`, async ({
			page,
			request
		}, info) => {
			test.skip(
				!existsSync(`${root}/${transfer}/preview-5.jpg`),
				'Prepare preview fixtures and production JPEGs first'
			);
			const { id, requested } = await fixture(page, transfer, mode);
			const room = `preview-${transfer}-${mode}-${Date.now()}`;
			expect((await request.post('/be/rooms', { data: { roomId: room, mediaId: id } })).ok()).toBe(
				true
			);
			await page.goto(`/${room}/media/${id}`);
			await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
				timeout: 30_000
			});
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect(page.getByRole('textbox', { name: 'Chat', exact: true }).last()).toBeEnabled();
			// Let the initial room autoplay finish before exercising a user pause.
			await expect
				.poll(() =>
					page
						.locator('.sparkle-raw-surface video')
						.evaluate((v: HTMLVideoElement) => v.currentTime)
				)
				.toBeGreaterThan(0.5);
			await page.locator('[data-media-player]').hover();
			await page.locator('[data-media-player]').press('k');
			await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
			expect(requested).toHaveLength(0);
			const before = await page.evaluate(() => ({
				time: (window as any).previewProvider.ctx.player.state.currentTime,
				paused: (window as any).previewProvider.ctx.player.state.paused
			}));
			await hoverTime(page, 6);
			const preview = page.locator('.sparkle-plex-preview');
			await expect(preview).toHaveAttribute('data-preview-state', 'ready');
			await expect
				.poll(() =>
					preview.locator('img').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)
				)
				.toBe(true);
			expect(requested).toHaveLength(1);
			await hoverTime(page, 6.5);
			await page.waitForTimeout(200);
			expect(requested).toHaveLength(1);
			await hoverTime(page, 0.5);
			await expect(preview).toHaveAttribute('data-preview-state', 'ready');
			expect(requested).toHaveLength(2);
			await hoverTime(page, 6);
			await expect(preview).toHaveAttribute('data-preview-state', 'ready');
			expect(requested).toHaveLength(2);
			const after = await page.evaluate(() => ({
				time: (window as any).previewProvider.ctx.player.state.currentTime,
				paused: (window as any).previewProvider.ctx.player.state.paused
			}));
			expect(after.paused).toBe(before.paused);
			// The native paused clock can publish its final fractional-frame update.
			expect(Math.abs(after.time - before.time)).toBeLessThan(0.2);
			await page.screenshot({ path: info.outputPath('desktop-preview.png') });
			await page.setViewportSize({ width: 390, height: 844 });
			await hoverTime(page, 6);
			await expect(preview).toHaveAttribute('data-preview-state', 'ready');
			const box = await preview.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(391);
			await page.screenshot({ path: info.outputPath('mobile-preview.png') });
			await page.mouse.move(0, 0);
			await page.getByRole('button', { name: 'Play', exact: true }).click();
			await expect
				.poll(
					() =>
						page
							.locator('.sparkle-raw-surface video')
							.evaluate((v: HTMLVideoElement) => v.currentTime),
					{ timeout: 15_000 }
				)
				.toBeGreaterThan(1);
			await hoverTime(page, 6);
			await expect(preview).toHaveAttribute('data-preview-state', 'ready');
			expect(
				await page.evaluate(() => (window as any).previewProvider.ctx.player.state.paused)
			).toBe(false);
		});
	}
}

test('rapid hover rejects obsolete previews and backs off failed requests', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/bt709/preview-5.jpg`), 'Prepare preview fixtures first');
	const { id } = await fixture(page, 'bt709', 'compatible');
	const room = `preview-race-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: id } });
	let requests = 0,
		releaseOld: (() => void) | undefined;
	const old = new Promise<void>((resolve) => {
		releaseOld = resolve;
	});
	await page.route(`**/be/media/${id}/parts/1/preview/*`, async (route) => {
		requests++;
		const frame = new URL(route.request().url()).pathname.split('/').at(-1);
		if (frame === '0.jpg') await old;
		if (frame === '4.jpg') return route.fulfill({ status: 503 });
		await route
			.fulfill({
				contentType: 'image/jpeg',
				body: readFileSync(`${root}/bt709/preview-${frame === '0.jpg' ? 0 : 5}.jpg`)
			})
			.catch(() => {});
	});
	await page.goto(`/${room}/media/${id}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true');
	await hoverTime(page, 0.5);
	await expect.poll(() => requests).toBe(1);
	await hoverTime(page, 6);
	const preview = page.locator('.sparkle-plex-preview');
	await expect(preview).toHaveAttribute('data-preview-state', 'ready');
	const latest = await preview.locator('img').getAttribute('src');
	releaseOld!();
	await page.waitForTimeout(200);
	expect(await preview.locator('img').getAttribute('src')).toBe(latest);
	await hoverTime(page, 21);
	await expect(preview).toHaveAttribute('data-preview-state', 'unavailable');
	const failedRequests = requests;
	await hoverTime(page, 12);
	await expect(preview).toHaveAttribute('data-preview-state', 'unavailable');
	expect(requests).toBe(failedRequests);
	await hoverTime(page, 6);
	await expect(preview).toHaveAttribute('data-preview-state', 'ready');
	expect(requests).toBe(failedRequests);
	await page.getByRole('button', { name: 'Go back to library', exact: true }).click();
	await expect(preview).toHaveCount(0);
});

test('cached previews survive Compatible, AV1 and HEVC output changes', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/smpte2084/preview-5.jpg`), 'Prepare preview fixtures first');
	const { id, requested } = await fixture(page, 'smpte2084', 'compatible');
	const room = `preview-modes-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: id } });
	await page.goto(`/${room}/media/${id}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true');
	await hoverTime(page, 6);
	await expect(page.locator('.sparkle-plex-preview')).toHaveAttribute(
		'data-preview-state',
		'ready'
	);
	for (const [mode, label] of [
		['av1', 'Encoded AV1'],
		['hevc', 'Encoded HEVC'],
		['compatible', 'Compatible']
	]) {
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
		await page.getByRole('menuitemradio', { name: label, exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => (window as any).previewProvider.status.hdrPreference))
			.toBe(mode);
		await expect
			.poll(() => page.evaluate(() => (window as any).previewProvider.status.changing))
			.toBe(false);
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await hoverTime(page, 6);
		await expect(page.locator('.sparkle-plex-preview')).toHaveAttribute(
			'data-preview-state',
			'ready'
		);
		expect(requested).toHaveLength(1);
	}
});
