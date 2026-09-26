import { expect, test, type Page, type Route } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RawPlaybackStatus } from '../../lib/player/raw-types';

const root = 'cache/track-selection';
const rawId = 'track-raw-fixture',
	encodedId = 'track-encoded-fixture';
const audio = ['eng', 'chi', 'jpn'].map((Language, i) => ({
	Index: i + 1,
	Language,
	Title: ['English', 'Chinese', 'Japanese'][i],
	CodecType: 'audio',
	Location: `${i + 1}-${Language}.opus`
}));
const subtitleStreams = [
	{ Index: 4, Language: 'chi', Title: 'Chinese text', Location: '4.srt', CodecType: 'subtitle' },
	{ Index: 5, Language: 'jpn', Title: 'Japanese styled', Location: '5.ass', CodecType: 'subtitle' },
	{ Index: 6, Language: 'eng', Title: 'English styled', Location: '6.ass', CodecType: 'subtitle' }
];

function serveBytes(route: Route, bytes: Buffer, contentType = 'application/octet-stream') {
	const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
	const start = Number(range?.[1] || 0),
		end = Math.min(Number(range?.[2] || bytes.length - 1), bytes.length - 1);
	return route.fulfill({
		status: range ? 206 : 200,
		contentType,
		headers: {
			'Accept-Ranges': 'bytes',
			...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {})
		},
		body: bytes.subarray(start, end + 1)
	});
}

async function fixture(page: Page) {
	await page.addInitScript(() => {
		document.addEventListener(
			'provider-setup',
			(event) => {
				(window as any).trackTestProvider = (event as CustomEvent).detail;
			},
			true
		);
	});
	await page.route('**/api/runtime-env', (route) =>
		route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	await page.route('**/auth/plex/session', (route) =>
		route.fulfill({ json: { enabled: false, authenticated: false, canAccessRaw: true } })
	);
	await page.route('**/encoding/capabilities', (route) =>
		route.fulfill({
			json: { codecs: ['av1', 'hevc'].filter((c) => existsSync(`${root}/${c}/master.m3u8`)) }
		})
	);
	const files = Object.fromEntries(
		audio.map((a) => [
			`h264-8bit-${a.Index}-${a.Language}.mp4`,
			readFileSync(`${root}/h264-8bit-${a.Index}-${a.Language}.mp4`).length
		])
	);
	const bytes = readFileSync(`${root}/multilingual.mkv`);
	for (const id of [rawId, encodedId]) {
		await page.route(`**/be/media/${id}`, (route) =>
			route.fulfill({
				json: {
					Id: id,
					Title: { title: 'Track fixture', titleId: 'track-fixture', id, modTime: 1 },
					Source: id === rawId ? 'plex' : 'processed',
					Input: 'Track fixture.mkv',
					State: 'complete',
					Duration: 48,
					width: 320,
					height: 180,
					Files: files,
					EncodedCodecs: id === rawId ? [] : ['h264-8bit'],
					MappedAudio: { 'h264-8bit': audio },
					Streams: subtitleStreams,
					Chapters: [],
					DominantColors: [],
					JobModTime: 1,
					...(id === rawId
						? {
								Raw: {
									container: 'mkv',
									videoCodec: 'h264',
									versions: [],
									parts: [
										{
											id: '1',
											url: '/media/track-raw-fixture/parts/1/file',
											size: bytes.length,
											duration: 48,
											start: 0,
											streams: [
												{ id: 0, index: 0, streamType: 1, codec: 'h264' },
												...audio.map((a) => ({
													id: a.Index,
													index: a.Index,
													streamType: 2,
													codec: 'aac',
													languageCode: a.Language,
													displayTitle: a.Title
												})),
												...subtitleStreams.map((s) => ({
													id: s.Index,
													index: s.Index,
													streamType: 3,
													codec: s.Location.split('.')[1],
													languageCode: s.Language,
													displayTitle: s.Title
												}))
											]
										}
									]
								}
							}
						: {})
				}
			})
		);
	}
	await page.route('**/be/media/track-raw-fixture/parts/1/file', (route) =>
		serveBytes(route, bytes)
	);
	await page.route('**/be/media/track-raw-fixture/parts/1/encoded/**', (route) => {
		const segments = new URL(route.request().url()).pathname.split('/');
		const codec = segments.at(-2)!,
			file = segments.at(-1)!;
		if (file === 'manifest')
			return route.fulfill({
				json: {
					fingerprint: 'fixture',
					playlist: 'master.m3u8',
					codec,
					output: 'SDR',
					duration: 48,
					width: 320,
					height: 180,
					audio: true,
					subtitleTracks: subtitleStreams.map((s, id) => ({ id, title: s.Title })),
					hasFonts: false,
					segmentSeconds: 6
				}
			});
		if (file.startsWith('subtitles-')) return route.fulfill({ json: { tracks: [], packets: [] } });
		if (!existsSync(`${root}/${codec}/${file}`)) return route.fulfill({ status: 404 });
		return serveBytes(
			route,
			readFileSync(`${root}/${codec}/${file}`),
			file.endsWith('m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
		);
	});
	await page.route(`**/static/${encodedId}/**`, (route) => {
		const file = new URL(route.request().url()).pathname.split('/').pop()!;
		if (file.endsWith('.srt'))
			return route.fulfill({
				body: readFileSync(`${root}/captions.srt`),
				contentType: 'text/plain'
			});
		if (file.endsWith('.ass'))
			return route.fulfill({
				body: '[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n',
				contentType: 'text/plain'
			});
		if (!existsSync(`${root}/${file}`)) return route.fulfill({ status: 404 });
		return serveBytes(route, readFileSync(`${root}/${file}`), 'video/mp4');
	});
}

async function status(page: Page) {
	return page.evaluate(() => (window as any).trackTestProvider?.status as RawPlaybackStatus);
}
async function audioTitle(page: Page) {
	const s = await status(page);
	return s?.audioTracks.find((t) => t.id === s.audio)?.title;
}
async function encodedSource(page: Page) {
	return page.locator('video').evaluate((video: HTMLVideoElement) => video.currentSrc);
}
async function openVideoSettings(page: Page) {
	await page.locator('[data-media-player]').hover();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
}

for (const mode of ['compatible', 'av1', 'hevc']) {
	test(`Raw ${mode}: shared defaults, explicit persistence and local selection keep room sync`, async ({
		browser,
		request,
		baseURL
	}) => {
		test.skip(
			!existsSync(`${root}/multilingual.mkv`),
			'Run node scripts/tests/prepare-track-fixture.mjs --nvenc'
		);
		test.skip(
			mode !== 'compatible' && !existsSync(`${root}/${mode}/master.m3u8`),
			'Prepare the optional NVENC fixtures'
		);
		const room = `track-${mode}-${Date.now()}`;
		expect((await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } })).ok()).toBe(
			true
		);
		const pages = await Promise.all([browser.newPage(), browser.newPage()]);
		const messages: unknown[][] = [[], []];
		for (const [index, page] of pages.entries()) {
			page.on('websocket', (socket) => {
				if (!socket.url().includes('/sync/')) return;
				socket.on('framesent', (frame) => messages[index].push(JSON.parse(String(frame.payload))));
			});
		}
		try {
			for (const page of pages) {
				await fixture(page);
				await page.addInitScript((m) => {
					localStorage.setItem('sparkle.raw.hdr', m);
				}, mode);
				await page.goto(`${baseURL}/${room}/media/${rawId}`);
				await expect(page.locator('[data-media-player]')).toHaveAttribute(
					'data-raw-ready',
					'true',
					{ timeout: 20_000 }
				);
				await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
				await expect(page.getByRole('textbox', { name: 'Chat', exact: true }).last()).toBeEnabled();
				await expect.poll(() => audioTitle(page), { timeout: 20_000 }).toBe('Japanese');
				await expect
					.poll(async () => {
						const s = await status(page);
						return s.subtitleTracks.find((t) => t.id === s.subtitle)?.title;
					})
					.toBe('English styled');
				expect(await page.evaluate(() => localStorage.getItem('audioSelection'))).toBeNull();
				expect(await page.evaluate(() => localStorage.getItem('sparkle.raw.subtitle'))).toBeNull();
			}
			const [first, peer] = pages;
			await openVideoSettings(first);
			await first.getByRole('menuitemradio', { name: 'English', exact: true }).click();
			await expect.poll(() => audioTitle(first)).toBe('English');
			await expect
				.poll(() =>
					first.evaluate(() => JSON.parse(localStorage.getItem('audioSelection') || '{}').language)
				)
				.toBe('en-US');
			expect(await audioTitle(peer)).toBe('Japanese');
			await expect(peer.locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
			await first.keyboard.press('Escape');
			await first.keyboard.press('Escape');
			await first.locator('[data-media-player]').focus();
			await first.keyboard.press('k');
			await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
			await openVideoSettings(first);
			await first.getByRole('menuitemradio', { name: 'Chinese', exact: true }).click();
			await expect.poll(() => audioTitle(first)).toBe('Chinese');
			await expect(first.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
			await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
			expect(await audioTitle(peer)).toBe('Japanese');
			await first.getByRole('menuitemradio', { name: 'English', exact: true }).click();
			await expect.poll(() => audioTitle(first)).toBe('English');
			await first.keyboard.press('Escape');
			await first.keyboard.press('Escape');
			await first.locator('[data-media-player]').focus();
			// One keyboard step can fall inside the room's six-second drift tolerance.
			const seek = first.getByRole('slider', { name: 'Seek', exact: true });
			const seekBounds = await seek.boundingBox();
			await seek.click({ position: { x: seekBounds!.width * 0.55, y: seekBounds!.height / 2 } });
			await expect
				.poll(() =>
					first
						.locator('.sparkle-raw-surface video')
						.evaluate((v: HTMLVideoElement) => v.currentTime)
				)
				.toBeGreaterThan(20);
			await expect
				.poll(async () => {
					const times = await Promise.all(
						pages.map((p) =>
							p
								.locator('.sparkle-raw-surface video')
								.evaluate((v: HTMLVideoElement) => v.currentTime)
						)
					);
					return Math.abs(times[0] - times[1]);
				})
				.toBeLessThan(1.5);
			await first.locator('[data-media-player]').focus();
			await first.keyboard.press('k');
			await expect(peer.locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
			await first.locator('[data-media-player]').hover();
			await first.getByRole('button', { name: 'Closed captions', exact: true }).click();
			await expect.poll(async () => (await status(first))?.subtitle).toBe(-1);
			await first.reload();
			await first.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect.poll(() => audioTitle(first)).toBe('English');
			await expect.poll(async () => (await status(first))?.subtitle).toBe(-1);
			await first.locator('[data-media-player]').hover();
			await first.getByRole('button', { name: 'Closed captions', exact: true }).click();
			await expect
				.poll(async () => {
					const s = await status(first);
					return s.subtitleTracks.find((t) => t.id === s.subtitle)?.title;
				})
				.toBe('English styled');
			expect(await audioTitle(peer)).toBe('Japanese');
		} catch (error) {
			const diagnosticsPath = test.info().outputPath('track-sync-diagnostics.json');
			writeFileSync(
				diagnosticsPath,
				JSON.stringify(
					{
						messages: messages.map((list) => list.slice(-35)),
						players: await Promise.all(
							pages.map((page) =>
								page.evaluate(() => {
									const p = (window as any).trackTestProvider;
									return {
										timeline: p?.timeline,
										canPublish: p?.canPublishPlayback,
										paused: p?.paused,
										buffering: p?.buffering,
										starting: p?.starting,
										remoteOperations: p?.remoteOperations,
										status: p?.status,
										videos: [...document.querySelectorAll('video')].map((v) => ({
											time: v.currentTime,
											paused: v.paused,
											ready: v.readyState
										}))
									};
								})
							)
						)
					},
					null,
					2
				)
			);
			await test.info().attach('track-sync-diagnostics', {
				contentType: 'application/json',
				path: diagnosticsPath
			});
			throw error;
		} finally {
			await Promise.all(pages.map((p) => p.close()));
		}
	});
}

test('Encoded and Raw audio save only explicit choices and restore them across sources', async ({
	page,
	request,
	baseURL
}) => {
	test.skip(!existsSync(`${root}/multilingual.mkv`), 'Prepare the multilingual fixture');
	await fixture(page);
	const room = `track-encoded-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: encodedId } });
	await page.goto(`${baseURL}/${room}/media/${encodedId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => encodedSource(page)).toMatch(/3-jpn\.mp4/);
	expect(await page.evaluate(() => localStorage.getItem('audioSelection'))).toBeNull();
	await openVideoSettings(page);
	await page.getByRole('menuitemradio', { name: /English/ }).click();
	await expect.poll(() => encodedSource(page)).toMatch(/1-eng\.mp4/);
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(localStorage.getItem('audioSelection') || '{}').language)
		)
		.toBe('en-US');
	await page.reload();
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => encodedSource(page)).toMatch(/1-eng\.mp4/);
	await request.put(`/be/rooms/${room}`, { data: { mediaId: rawId } });
	await page.goto(`${baseURL}/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => audioTitle(page)).toBe('English');
	await openVideoSettings(page);
	await page.getByRole('menuitemradio', { name: 'Chinese', exact: true }).click();
	await expect.poll(() => audioTitle(page)).toBe('Chinese');
	await request.put(`/be/rooms/${room}`, { data: { mediaId: encodedId } });
	await page.goto(`${baseURL}/${room}/media/${encodedId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => encodedSource(page)).toMatch(/2-chi\.mp4/);
});
