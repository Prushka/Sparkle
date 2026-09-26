import { expect, test } from '@playwright/test';

const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';
const fixture = process.env.SPARKLE_ENCODE_TEST_ID;

test('every HDR output mode reports measured bitrate and keeps mobile menus separate', async ({
	page,
	request
}) => {
	test.skip(!fixture, 'Set SPARKLE_ENCODE_TEST_ID to a mapped media fixture; requires NVENC');
	test.setTimeout(180_000);
	const room = `bitrate-modes-${Date.now()}`;
	await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: fixture } });
	await page.addInitScript(() => {
		localStorage.setItem('sparkle.raw.hdr', 'compatible');
		document.addEventListener(
			'provider-setup',
			(event) => {
				(window as any).testProvider = (event as CustomEvent).detail;
			},
			true
		);
	});
	await page.goto(`/${room}/media/${fixture}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	const player = page.locator('[data-media-player]');
	await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 60_000 });
	await page.setViewportSize({ width: 390, height: 844 });
	await player.hover();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
	await expect(page.getByRole('menuitemradio', { name: 'Tone mapping', exact: true })).toHaveCount(
		0
	);
	for (const [mode, label] of [
		['compatible', 'Compatible'],
		['auto', 'Automatic'],
		['av1', 'Encoded AV1'],
		['hevc', 'Encoded HEVC']
	]) {
		await page.getByRole('menuitemradio', { name: label, exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => (window as any).testProvider.status.hdrPreference))
			.toBe(mode);
		await expect(player).toHaveAttribute('data-raw-renderer', 'native');
		await expect
			.poll(() => page.evaluate(() => (window as any).testProvider.status.bitrate?.video ?? 0), {
				timeout: 30000
			})
			.toBeGreaterThan(10_000);
		const reading = page.locator('[data-raw-bitrate]');
		await reading.scrollIntoViewIfNeeded();
		await expect(reading).toHaveText(/^\d.*[Mk]bps$/);
		const bounds = (await reading.boundingBox())!;
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
		await expect(page.getByRole('menuitem', { name: /^Subtitles/ })).toHaveCount(0);
	}
});

for (const codec of ['av1', 'hevc']) {
	test(`encoded ${codec} keeps one audio clock, live bitrate and stable open submenus`, async ({
		page,
		request
	}) => {
		test.skip(
			!fixture,
			'Set SPARKLE_ENCODE_TEST_ID to a fixture with audio and subtitles; requires NVENC'
		);
		test.setTimeout(180_000);
		const room = `encoded-audio-${codec}-${Date.now()}`;
		await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: fixture } });
		await page.addInitScript((mode) => {
			localStorage.setItem('sparkle.raw.hdr', mode);
			document.addEventListener(
				'provider-setup',
				(event) => {
					(window as any).testProvider = (event as CustomEvent).detail;
				},
				true
			);
		}, codec);
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto(`/${room}/media/${fixture}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		const player = page.locator('[data-media-player]');
		const video = page.locator('.sparkle-raw-surface video');
		await expect
			.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 60_000 })
			.toBeGreaterThan(3);
		const clocks = await page.evaluate(() => {
			const p = (window as any).testProvider;
			return {
				separateAudio: !!p.audioEngine,
				native: p.engine.isMSE(),
				audio: p.engine.getSelectedAudioStreamId()
			};
		});
		expect(clocks.separateAudio).toBe(false);
		expect(clocks.native).toBe(true);
		expect(clocks.audio).toBeGreaterThanOrEqual(0);
		await video.evaluate((v) => {
			(v as any).testWaits = 0;
			v.addEventListener('waiting', () => (v as any).testWaits++);
		});
		// Cross at least five six-second fragment boundaries with no audio-only
		// rate adjustments or recovery seeks competing with the native clock.
		await expect
			.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 55_000 })
			.toBeGreaterThan(33);
		expect(await video.evaluate((v) => (v as any).testWaits)).toBe(0);
		await player.hover();
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
		await expect(page.locator('[data-raw-bitrate]')).toHaveText(/^\d.*[Mk]bps$/, { timeout: 8000 });
		const bitrate = await page.evaluate(() => (window as any).testProvider.status.bitrate);
		expect(bitrate.video).toBeGreaterThan(10_000);
		expect(bitrate.audio).toBeGreaterThan(1_000);
		expect(bitrate.audio).toBeLessThan(1_000_000);
		const audio = await page.evaluate(() => (window as any).testProvider.status.audioTracks);
		if (audio.length > 1) {
			await page.getByRole('menuitemradio', { name: audio[1].title, exact: true }).click();
			await expect
				.poll(() =>
					page.evaluate(() => (window as any).testProvider.engine.getSelectedAudioStreamId())
				)
				.toBe(audio[1].id);
			await expect(player).not.toHaveAttribute('data-paused', '');
		}
		const subtitleRoot = page.locator('.vds-subtitles-settings-menu');
		const identity = await subtitleRoot.getAttribute('aria-hidden');
		expect(identity).toBe('true');
		await subtitleRoot.evaluate((el) => el.setAttribute('data-test-stable', 'yes'));
		const other = codec === 'av1' ? 'hevc' : 'av1';
		await page
			.getByRole('menuitemradio', { name: `Encoded ${other.toUpperCase()}`, exact: true })
			.click();
		await expect(player).toHaveAttribute('data-raw-encoding', other, { timeout: 45_000 });
		await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 45_000 });
		await expect(subtitleRoot).toHaveAttribute('data-test-stable', 'yes');
		await expect(subtitleRoot).toHaveAttribute('aria-hidden', 'true');
		await expect(page.getByRole('menuitem', { name: /^Subtitles/ })).toHaveCount(0);
		await expect(page.locator('[data-raw-bitrate]')).toHaveText(/^\d.*[Mk]bps$/, {
			timeout: 12_000
		});
		await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
		await page.getByRole('menuitem', { name: /^Subtitles/ }).click();
		await expect(page.getByText('Primary subtitles', { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
}
test('automatic chooses a shared encode on a slow connection without changing the saved preference', async ({
	page,
	request
}) => {
	test.skip(!fixture, 'Set SPARKLE_ENCODE_TEST_ID; requires NVENC');
	test.setTimeout(120_000);
	const room = `encoded-auto-${Date.now()}`;
	await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: fixture } });
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'auto'));
	await page.route('**/parts/*/file', async (route) => {
		if (route.request().headers().range === 'bytes=0-1048575')
			await new Promise((resolve) => setTimeout(resolve, 1500));
		await route.continue();
	});
	await page.goto(`/${room}/media/${fixture}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	const player = page.locator('[data-media-player]');
	await expect(player).toHaveAttribute('data-raw-encoding', /av1|hevc/, { timeout: 60_000 });
	await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 60_000 });
	expect(await page.evaluate(() => localStorage.getItem('sparkle.raw.hdr'))).toBe('auto');
});
for (const codec of ['av1', 'hevc']) {
	test(`NVENC ${codec} preserves native color, timeline, captions and the saved choice`, async ({
		page,
		request
	}) => {
		test.skip(!fixture, 'Set SPARKLE_ENCODE_TEST_ID to a mapped media fixture; requires NVENC');
		test.setTimeout(180_000);
		const room = `encoded-${codec}-${Date.now()}`;
		expect(
			(await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: fixture } })).ok()
		).toBeTruthy();
		await page.addInitScript((value) => {
			if (!localStorage.getItem('sparkle.raw.hdr')) localStorage.setItem('sparkle.raw.hdr', value);
		}, codec);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (msg) => {
			if (msg.type() === 'error') console.log('browser:', msg.text().slice(0, 500));
		});
		page.on('response', (response) => {
			if (response.url().includes('/encoded/') && !response.ok())
				console.log(response.status(), response.url());
		});
		await page.goto(`/${room}/media/${fixture}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		const player = page.locator('[data-media-player]');
		await expect(player).toHaveAttribute('data-raw-renderer', 'native', { timeout: 90_000 });
		const video = page.locator('.sparkle-raw-surface video');
		await expect
			.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 60_000 })
			.toBeGreaterThan(14);
		const color = await video.evaluate((v) => {
			const f = new VideoFrame(v as HTMLVideoElement);
			const result = f.colorSpace.toJSON();
			f.close();
			return result;
		});
		if (process.env.SPARKLE_ENCODE_EXPECTED_HDR === 'HDR10')
			expect(color).toMatchObject({ primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl' });
		if (process.env.SPARKLE_ENCODE_EXPECTED_HDR === 'HLG')
			expect(color).toMatchObject({ primaries: 'bt2020', transfer: 'hlg' });
		await player.focus();
		await page.keyboard.press('k');
		await expect(player).toHaveAttribute('data-paused', '', { timeout: 3000 });
		await player.hover();
		const slider = page.getByRole('slider', { name: 'Seek', exact: true });
		const box = (await slider.boundingBox())!;
		await slider.click({ position: { x: box.width * 0.7, y: box.height / 2 } });
		await expect(player).not.toHaveAttribute('data-seeking', '', { timeout: 60_000 });
		await expect
			.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 60_000 })
			.toBeGreaterThan(25);
		await player.focus();
		await page.keyboard.press('k');
		const resume = await video.evaluate((v) => (v as HTMLVideoElement).currentTime);
		await expect
			.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 30_000 })
			.toBeGreaterThan(resume + 3);
		await player.hover();
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
		await expect(
			page.getByRole('menuitemradio', { name: `Encoded ${codec.toUpperCase()}`, exact: true })
		).toHaveAttribute('aria-checked', 'true');
		await expect(page.locator('[data-raw-hdr-status]')).toContainText(
			`NVENC ${codec.toUpperCase()}`
		);
		expect(await page.evaluate(() => localStorage.getItem('sparkle.raw.hdr'))).toBe(codec);
		expect(errors).toEqual([]);
		console.log(JSON.stringify({ codec, color, resume }));
	});
}

test('encoded ASS fonts load on caption selection and settings fit a mobile viewport', async ({
	page,
	request
}) => {
	const id = process.env.SPARKLE_ENCODE_ASS_ID;
	test.skip(!id, 'Set SPARKLE_ENCODE_ASS_ID to an ASS fixture with embedded fonts');
	test.setTimeout(120_000);
	const room = `encoded-fonts-${Date.now()}`;
	await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: id } });
	await page.addInitScript(() => {
		if (!localStorage.getItem('sparkle.raw.hdr')) localStorage.setItem('sparkle.raw.hdr', 'av1');
		localStorage.setItem('sparkle.raw.subtitle', 'off');
	});
	const fontRequests: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/fonts.json')) fontRequests.push(r.url());
	});
	await page.goto(`/${room}/media/${id}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	const player = page.locator('[data-media-player]');
	const video = page.locator('.sparkle-raw-surface video');
	await expect
		.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 60_000 })
		.toBeGreaterThan(2);
	expect(fontRequests).toHaveLength(0);
	await player.hover();
	const downloaded = page.waitForResponse((r) => r.url().includes('/fonts.json') && r.ok());
	await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
	expect((await (await downloaded).json()).length).toBeGreaterThan(0);
	await expect
		.poll(
			() =>
				page
					.locator('.sparkle-raw-surface canvas')
					.evaluateAll((canvases) => canvases.some((c) => (c as HTMLCanvasElement).width > 300)),
			{ timeout: 15_000 }
		)
		.toBeTruthy();
	await player.focus();
	await page.keyboard.press('k');
	await page.setViewportSize({ width: 390, height: 844 });
	await player.hover();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
	for (const name of ['Automatic', 'Compatible', 'Encoded AV1', 'Encoded HEVC']) {
		const option = page.getByRole('menuitemradio', { name, exact: true });
		await option.scrollIntoViewIfNeeded();
		const box = (await option.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(391);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.y + box.height).toBeLessThanOrEqual(845);
	}
	await page.getByRole('menuitemradio', { name: 'Encoded HEVC', exact: true }).click();
	await expect(player).toHaveAttribute('data-raw-encoding', 'hevc', { timeout: 45_000 });
	expect(await page.evaluate(() => localStorage.getItem('sparkle.raw.hdr'))).toBe('hevc');
	await page.reload();
	await expect(player).toHaveAttribute('data-raw-encoding', 'hevc', { timeout: 45_000 });
});
