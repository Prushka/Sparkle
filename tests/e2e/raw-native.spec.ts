import { test, expect } from '@playwright/test';

test('native HDR keeps decoded color and responds after distant and rapid paused seeks', async ({
	page,
	request
}) => {
	const id = process.env.SPARKLE_HDR_TEST_ID;
	test.skip(!id, 'Set SPARKLE_HDR_TEST_ID to a mapped, long HEVC HDR fixture with audio');
	const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';
	const media = await (await request.get(`${backend}/media/${id}`)).json();
	test.skip(media.Duration < 120, 'A long fixture is required to expose linear audio scans');
	const room = `native-regression-${Date.now()}`;
	expect(
		(await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: id } })).ok()
	).toBeTruthy();
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	let transferred = 0;
	page.on('response', (response) => {
		if (response.url().includes('/parts/') && response.request().method() === 'GET')
			transferred += Number(response.headers()['content-length'] || 0);
	});
	await page.goto(`/${room}/media/${id}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	const player = page.locator('[data-media-player]');
	await expect(player).toHaveAttribute('data-raw-renderer', 'native', { timeout: 45000 });
	const video = page.locator('.sparkle-raw-surface video');
	await expect
		.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 30000 })
		.toBeGreaterThan(2);
	const pause = async () => {
		const start = Date.now();
		await player.focus();
		await page.keyboard.press('k');
		await expect(player).toHaveAttribute('data-paused', '', { timeout: 2000 });
		await expect
			.poll(() => video.evaluate((v) => (v as HTMLVideoElement).paused), { timeout: 2000 })
			.toBe(true);
		return Date.now() - start;
	};
	const pauseMs = await pause();
	await player.hover();
	const slider = page.getByRole('slider', { name: 'Seek', exact: true });
	const bounds = (await slider.boundingBox())!;
	const before = transferred,
		started = Date.now();
	await slider.click({ position: { x: bounds.width * 0.5, y: bounds.height / 2 } });
	await expect
		.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 10000 })
		.toBeGreaterThan(media.Duration * 0.49);
	await expect(player).not.toHaveAttribute('data-seeking', '', { timeout: 10000 });
	await expect
		.poll(() => video.evaluate((v) => (v as HTMLVideoElement).readyState), { timeout: 10000 })
		.toBeGreaterThan(1);
	const seekMs = Date.now() - started;
	const seekBytes = transferred - before;
	expect(before).toBeGreaterThan(0);
	expect(seekBytes).toBeGreaterThan(0);
	expect(seekMs).toBeLessThan(10000);
	// Two decoder range readers must not scan gigabytes from the beginning.
	expect(seekBytes).toBeLessThan(128 * 1024 * 1024);
	await expect(player).toHaveAttribute('data-paused', '');
	const color = await video.evaluate((v) => {
		const f = new VideoFrame(v as HTMLVideoElement);
		const c = f.colorSpace.toJSON();
		f.close();
		return c;
	});
	expect(color).toMatchObject({
		primaries: 'bt2020',
		transfer: 'pq',
		matrix: 'bt2020-ncl',
		fullRange: false
	});
	await player.focus();
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
	await expect(player).not.toHaveAttribute('data-seeking', '', { timeout: 10000 });
	await player.focus();
	await page.keyboard.press('k');
	await expect(player).not.toHaveAttribute('data-paused', '', { timeout: 2000 });
	const resumed = await video.evaluate((v) => (v as HTMLVideoElement).currentTime);
	await expect
		.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 8000 })
		.toBeGreaterThan(resumed + 2);
	await pause();
	await player.hover();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
	const status = page.locator('[data-raw-hdr-status]');
	await expect(status).toContainText('Source');
	await expect(status).toContainText('Native video');
	expect((await status.boundingBox())!.width).toBeLessThanOrEqual(352);
	await page.setViewportSize({ width: 390, height: 844 });
	// Vidstack remounts its small layout and closes the desktop settings menu.
	await player.hover();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
	await expect(status).toBeVisible();
	const box = (await status.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
	expect(errors).toEqual([]);
	console.log(JSON.stringify({ pauseMs, seekMs, requestedSeekBytes: seekBytes, color }));
});
