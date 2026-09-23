import { test, expect } from '@playwright/test';

const backend = process.env.SPARKLE_TEST_BACKEND_URL || '/be';

test('million-item library fetches bounded pages and virtualizes cards', async ({ page }) => {
	const sizes: number[] = [];
	const urls: string[] = [];
	page.on('request', (r) => urls.push(new URL(r.url()).pathname));
	await page.route('**/library/sources', (route) =>
		route.fulfill({ json: { sources: [{ id: '1', title: 'Test Movies', source: 'plex' }] } })
	);
	await page.route('**/library/items?*', (route) => {
		const u = new URL(route.request().url()),
			limit = Number(u.searchParams.get('limit')),
			offset = Number(u.searchParams.get('cursor') || 0);
		sizes.push(limit);
		return route.fulfill({
			json: {
				total: 1_000_000,
				nextCursor: String(offset + limit),
				items: Array.from({ length: limit }, (_, i) => ({
					id: `plex-test-${offset + i}-1`,
					source: 'plex',
					kind: 'movie',
					title: `Fixture ${offset + i}`,
					duration: 60
				}))
			}
		});
	});
	await page.goto('/');
	await expect(page.getByRole('navigation', { name: 'Library hierarchy' })).toContainText(
		'1,000,000'
	);
	await expect(page.getByText('Raw', { exact: true }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Your library', exact: true })).toHaveCount(0);
	const grid = page.getByLabel('Library titles', { exact: true });
	for (let i = 0; i < 4; i++) {
		const previous = sizes.length;
		await grid.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect.poll(() => sizes.length).toBeGreaterThan(previous);
		await expect(grid).toHaveAttribute('aria-busy', 'false');
	}
	expect(sizes.every((n) => n === 48)).toBeTruthy();
	expect(sizes.length).toBeLessThan(10);
	expect(await page.getByText('Raw', { exact: true }).count()).toBeLessThan(100);
	expect(urls).not.toContain('/be/all');
	expect(urls).not.toContain('/all');
	for (const name of ['Source', 'Plex library', 'Sort library'])
		await expect(page.getByRole('combobox', { name, exact: true })).toHaveCSS('cursor', 'pointer');
	await grid.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect
		.poll(async () => {
			const viewport = await grid.boundingBox();
			const card = await grid.locator('a,button').first().boundingBox();
			return !!viewport && !!card && card.x - viewport.x >= 10 && card.y - viewport.y >= 10;
		})
		.toBeTruthy();
	await page.getByRole('searchbox', { name: 'Search library' }).fill('specific');
	await page.waitForRequest((r) => r.url().includes('query=specific'));
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
		.toBeTruthy();
	await expect(page.getByRole('button', { name: 'Movies', exact: true })).toBeVisible();
	for (const name of ['Source', 'Plex library', 'Sort library'])
		await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
	for (const name of ['Source', 'Plex library'])
		expect(
			(await page.getByRole('combobox', { name, exact: true }).boundingBox())!.width
		).toBeGreaterThan(110);
});

test('two raw clients synchronize playback, pause, seek and delayed join', async ({
	browser,
	request,
	baseURL
}) => {
	const media = process.env.SPARKLE_RAW_TEST_ID;
	if (process.env.SPARKLE_RAW_EXPECTED_HDR) test.setTimeout(180_000);
	test.skip(!media, 'Set SPARKLE_RAW_TEST_ID to a mapped real-media fixture');
	const metadata = await (await request.get(`${backend}/media/${media}`)).json();
	const hasSubtitles = metadata.Raw.parts[0].streams.some(
		(stream: { streamType: number }) => stream.streamType === 3
	);
	const room = `raw-e2e-${Date.now()}`;
	const response = await request.post(`${backend}/rooms`, {
		data: { roomId: room, mediaId: media }
	});
	expect(response.ok()).toBeTruthy();
	const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
	const pages = await Promise.all(contexts.map((c) => c.newPage()));
	const messages: any[][] = [[], []];
	const errors: string[] = [];
	for (const [index, page] of pages.entries()) {
		if (process.env.SPARKLE_RAW_ENCODE_MODE)
			await page.addInitScript(
				(mode) => localStorage.setItem('sparkle.raw.hdr', mode),
				process.env.SPARKLE_RAW_ENCODE_MODE
			);
		await page.addInitScript(() => {
			const sockets: WebSocket[] = [];
			(window as any).testSockets = sockets;
			window.WebSocket = new Proxy(WebSocket, {
				construct(Target, args) {
					const socket = new Target(...(args as [string]));
					sockets.push(socket);
					return socket;
				}
			});
		});
		page.on('pageerror', (e) => {
			errors.push(e.stack || e.message);
			console.error(e.stack || e.message);
		});
		page.on('websocket', (ws) => {
			if (!ws.url().includes('cottage') && !ws.url().includes('webpack'))
				ws.on('framesent', (frame) => {
					try {
						messages[index].push(JSON.parse(String(frame.payload)));
					} catch {}
				});
		});
		await page.goto(`${baseURL}/${room}/media/${media}`);
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
			timeout: 45_000
		});
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect
			.poll(() => messages[index].filter((m) => m.type === 'time').at(-1)?.time || 0, {
				timeout: 30_000
			})
			.toBeGreaterThan(3);
	}
	const player = pages[0].locator('[data-media-player]');
	await player.focus();
	await pages[0].keyboard.press('k');
	await expect(pages[1].locator('[data-media-player]')).toHaveAttribute('data-paused', '', {
		timeout: 10_000
	});
	await player.focus();
	await pages[0].keyboard.press('ArrowRight');
	await expect
		.poll(() => messages[0].filter((m) => m.type === 'time').at(-1)?.time || 0)
		.toBeGreaterThan(8);
	await player.focus();
	await pages[0].keyboard.press('k');
	await expect(pages[1].locator('[data-media-player]'))
		.not.toHaveAttribute('data-paused', '', {
			timeout: 10_000
		})
		.catch(async (error) => {
			await test.info().attach('resume-diagnostics', {
				body: JSON.stringify(
					{
						messages: messages.map((list) => list.slice(-25)),
						players: await Promise.all(
							pages.map((p) =>
								p.locator('[data-media-player]').evaluate((el) => ({
									attributes: [...el.attributes].map((a) => [a.name, a.value]),
									videos: [...el.querySelectorAll('video')].map((v) => ({
										paused: v.paused,
										time: v.currentTime,
										ready: v.readyState
									}))
								}))
							)
						)
					},
					null,
					2
				),
				contentType: 'application/json'
			});
			throw error;
		});
	// Reconnect with the current timeline, without publishing stale startup time.
	const sentBefore = messages[1].length;
	await pages[1].evaluate(() => (window as any).testSockets.forEach((s: WebSocket) => s.close()));
	await expect
		.poll(
			() =>
				messages[1]
					.slice(sentBefore)
					.filter((m) => m.type === 'time')
					.at(-1)?.time || 0,
			{ timeout: 30_000 }
		)
		.toBeGreaterThan(8);
	// Local subtitle changes preserve pause state and do not control the peer.
	await player.hover();
	if (
		(await pages[0]
			.getByRole('button', { name: 'Settings', exact: true })
			.getAttribute('aria-expanded')) !== 'true'
	)
		await pages[0].getByRole('button', { name: 'Settings', exact: true }).click();
	const subtitles = pages[0].getByRole('menuitem', { name: /^Subtitles/ });
	if (hasSubtitles) {
		await expect(subtitles).toBeVisible();
		// First menu open must include subtitles inside the measured menu, without
		// visiting Video Settings to force a second measurement.
		await expect
			.poll(async () => {
				const menu = await pages[0]
					.getByRole('menu', { name: 'Settings', exact: true })
					.boundingBox();
				const entry = await subtitles.boundingBox();
				return !!menu && !!entry && entry.y + entry.height <= menu.y + menu.height;
			})
			.toBeTruthy();
		const pauseCount = messages[0].filter((m) => m.type === 'pause').length;
		await subtitles.click();
		const off = pages[0].getByRole('menuitemradio', { name: 'Off', exact: true }).first();
		await off.click();
		await expect(off).toHaveAttribute('aria-checked', 'true');
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pauseCount);
	}
	await pages[0].keyboard.press('Escape');
	await pages[0].keyboard.press('Escape');
	const captions = pages[0].locator('.sparkle-raw-caption-button');
	if (hasSubtitles) {
		await expect(captions).toBeAttached();
		await player.hover();
		const pauseCount = messages[0].filter((m) => m.type === 'pause').length;
		await captions.click();
		await expect(captions).toHaveAttribute('aria-pressed', 'true');
		await expect(captions).toBeEnabled({ timeout: 15_000 });
		await player.hover();
		await captions.click();
		await expect(captions).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pauseCount);
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
	}
	// Raw settings use Vidstack's existing nested menu, including local audio.
	await player.hover();
	if (
		(await pages[0]
			.getByRole('button', { name: 'Settings', exact: true })
			.getAttribute('aria-expanded')) !== 'true'
	)
		await pages[0].getByRole('button', { name: 'Settings', exact: true }).click();
	await pages[0].getByRole('menuitem', { name: /^Video Settings/ }).click();
	await expect(pages[0].locator('[data-raw-hdr-status]')).toContainText(
		(process.env.SPARKLE_RAW_EXPECTED_HDR || 'SDR')
			.replaceAll('Dolby Vision Profile ', 'Dolby Vision P')
			.replaceAll(' / ', ' · ')
	);
	const audioOptions = pages[0]
		.locator('.vds-video-settings-menu')
		.getByRole('menuitemradio')
		.filter({ hasNotText: /Automatic|Compatible|Tone mapping|Encoded AV1|Encoded HEVC/ });
	if ((await audioOptions.count()) > 1) {
		const pauseCount = messages[0].filter((m) => m.type === 'pause').length;
		await audioOptions.nth(1).click();
		await expect(audioOptions.nth(1)).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pauseCount);
	}
	if (process.env.SPARKLE_RAW_EXPECTED_HDR) {
		const pauseCount = messages[0].filter((m) => m.type === 'pause').length;
		const time = messages[0].filter((m) => m.type === 'time').at(-1)?.time || 0;
		await pages[0].getByRole('menuitemradio', { name: 'Tone mapping', exact: true }).click();
		await expect(player).toHaveAttribute('data-raw-renderer', 'software', { timeout: 30_000 });
		await expect
			.poll(() => messages[0].filter((m) => m.type === 'time').at(-1)?.time || 0, {
				timeout: 30_000
			})
			.toBeGreaterThan(time + 1);
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pauseCount);
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		await pages[0].keyboard.press('Escape');
		await pages[0].keyboard.press('Escape');
		await player.focus();
		await pages[0].keyboard.press('k');
		await expect(pages[1].locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		const pausedCount = messages[0].filter((m) => m.type === 'pause').length;
		await player.hover();
		await pages[0].getByRole('button', { name: 'Settings', exact: true }).click();
		await pages[0].getByRole('menuitem', { name: /^Video Settings/ }).click();
		await pages[0].getByRole('menuitemradio', { name: /^Compatible/ }).click();
		await expect(player).toHaveAttribute('data-raw-renderer', 'native', { timeout: 30_000 });
		await expect(player).toHaveAttribute('data-paused', '');
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pausedCount);
		await pages[0].keyboard.press('Escape');
		await pages[0].keyboard.press('Escape');
		await player.focus();
		await pages[0].keyboard.press('k');
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
	}
	if (process.env.SPARKLE_RAW_ENCODE_MODE) {
		const pauses = messages[0].filter((m) => m.type === 'pause').length;
		await pages[0].getByRole('menuitemradio', { name: 'Compatible', exact: true }).click();
		await expect(player).toHaveAttribute('data-raw-encoding', '', { timeout: 30_000 });
		await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 30_000 });
		expect(await pages[0].evaluate(() => localStorage.getItem('sparkle.raw.hdr'))).toBe(
			'compatible'
		);
		await pages[0]
			.getByRole('menuitemradio', {
				name: `Encoded ${process.env.SPARKLE_RAW_ENCODE_MODE.toUpperCase()}`,
				exact: true
			})
			.click();
		await expect(player).toHaveAttribute('data-raw-encoding', process.env.SPARKLE_RAW_ENCODE_MODE, {
			timeout: 30_000
		});
		await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 30_000 });
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pauses);
	}
	await pages[0].keyboard.press('Escape');
	await pages[0].keyboard.press('Escape');
	// Document PiP keeps the same raw renderer/subtitles and the room timeline.
	if (await pages[0].evaluate(() => 'documentPictureInPicture' in window)) {
		await player.hover();
		const pipButton = pages[0].getByRole('button', { name: 'PiP', exact: true });
		const pauseCount = messages[0].filter((m) => m.type === 'pause').length;
		const time = messages[0].filter((m) => m.type === 'time').at(-1)?.time || 0;
		await pipButton.click();
		await expect(pipButton).toHaveAttribute('aria-pressed', 'true');
		await expect
			.poll(() =>
				pages[0].evaluate(() => {
					const pip = (window as any).documentPictureInPicture.window as Window | null;
					return (
						!!pip?.document.querySelector('video,canvas') &&
						pip.document.body.textContent?.includes('Back to tab')
					);
				})
			)
			.toBeTruthy();
		await expect
			.poll(() => messages[0].filter((m) => m.type === 'time').at(-1)?.time || 0)
			.toBeGreaterThan(time + 1);
		await player.hover();
		await pipButton.click();
		await expect(pipButton).toHaveAttribute('aria-pressed', 'false');
		await expect(player.locator('video,canvas').first()).toBeAttached();
		expect(messages[0].filter((m) => m.type === 'pause').length).toBe(pauseCount);
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
	}
	await player.hover();
	await pages[0].getByRole('button', { name: 'Google Cast options', exact: true }).click();
	await expect(pages[0].getByText('Direct casting unavailable', { exact: true })).toBeVisible();
	await pages[0].keyboard.press('Escape');
	expect(
		messages
			.flat()
			.filter((m) => m.type === 'time' || m.type === 'pause')
			.every((m) => m.mediaId === media && m.mediaUpdated > 0)
	).toBeTruthy();
	expect(errors).toEqual([]);
	const processed = process.env.SPARKLE_PROCESSED_TEST_ID,
		otherRaw = process.env.SPARKLE_RAW_SECOND_ID;
	if (processed && otherRaw) {
		if (await pages[0].evaluate(() => 'documentPictureInPicture' in window)) {
			await player.hover();
			await pages[0].getByRole('button', { name: 'PiP', exact: true }).click();
			await expect(pages[0].getByRole('button', { name: 'PiP', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
		}
		for (const page of pages)
			await page.route(new URL(`${backend}/media/${otherRaw}`, baseURL).href, async (route) => {
				await new Promise((r) => setTimeout(r, 1800));
				await route.continue();
			});
		await request.put(`${backend}/rooms/${room}`, { data: { mediaId: otherRaw } });
		await request.put(`${backend}/rooms/${room}`, { data: { mediaId: processed } });
		for (const page of pages) {
			await expect(page).toHaveURL(new RegExp(`/media/${processed}`), { timeout: 30_000 });
			await expect(page.locator('[data-media-player]')).not.toHaveAttribute(
				'data-raw-ready',
				'true'
			);
			await expect
				.poll(() => page.evaluate(() => !!(window as any).documentPictureInPicture?.window))
				.toBeFalsy();
		}
		await request.put(`${backend}/rooms/${room}`, { data: { mediaId: media } });
		for (const page of pages) {
			await expect(page).toHaveURL(new RegExp(`/media/${media}`), { timeout: 30_000 });
			await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
				timeout: 30_000
			});
		}
		expect(errors).toEqual([]);
	}
	await Promise.all(contexts.map((c) => c.close()));
});

test('multipart raw timeline seeks across parts and recovers from delayed ranges', async ({
	page,
	request,
	baseURL
}) => {
	const media = process.env.SPARKLE_RAW_SECOND_ID;
	test.skip(!media, 'Set SPARKLE_RAW_SECOND_ID to a short real-media fixture');
	const metadata = await (await request.get(`${backend}/media/${media}`)).json();
	const part = metadata.Raw.parts[0],
		duration = metadata.Duration;
	// Repeat a real fixture as two parts without writing or copying media files.
	metadata.Duration = metadata.duration = duration * 2;
	metadata.Raw.parts = [
		{ ...part, start: 0, duration },
		{ ...part, start: duration, duration }
	];
	metadata.parts = metadata.Raw.parts;
	await page.route(new URL(`${backend}/media/${media}`, baseURL).href, (route) =>
		route.fulfill({ json: metadata })
	);
	const room = `multipart-e2e-${Date.now()}`;
	await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: media } });
	const errors: string[] = [],
		messages: any[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('websocket', (ws) =>
		ws.on('framesent', (frame) => {
			try {
				messages.push(JSON.parse(String(frame.payload)));
			} catch {}
		})
	);
	await page.goto(`/${room}/media/${media}`);
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect
		.poll(() => messages.filter((m) => m.type === 'time').at(-1)?.time ?? 0)
		.toBeGreaterThan(1);
	let delayed = false;
	await page.route('**/parts/*/file', async (route) => {
		if (!delayed && route.request().method() === 'GET') {
			delayed = true;
			await new Promise((r) => setTimeout(r, 5000));
		}
		await route.continue();
	});
	const pauseCount = messages.filter((m) => m.type === 'pause').length;
	const seek = async (time: number) => {
		await page.mouse.move(0, 0);
		await page.locator('[data-media-player]').hover();
		const box = await page.getByRole('slider', { name: 'Seek', exact: true }).boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.click(box!.x + (box!.width * time) / (duration * 2), box!.y + box!.height / 2);
	};
	await seek(duration + 2);
	await expect
		.poll(() => messages.filter((m) => m.type === 'time').at(-1)?.time ?? 0, { timeout: 35_000 })
		.toBeGreaterThan(duration + 2);
	expect(delayed).toBeTruthy();
	expect(messages.filter((m) => m.type === 'pause').length).toBe(pauseCount);
	await seek(duration - 2);
	await expect
		.poll(() => messages.filter((m) => m.type === 'time').at(-1)?.time ?? duration * 2, {
			timeout: 15_000
		})
		.toBeLessThan(duration);
	await expect
		.poll(() => messages.filter((m) => m.type === 'time').at(-1)?.time ?? 0, { timeout: 30_000 })
		.toBeGreaterThan(duration + 1);
	expect(errors).toEqual([]);
});
