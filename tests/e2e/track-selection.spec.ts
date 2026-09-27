import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RawPlaybackStatus } from '../../lib/player/raw-types';

const root = 'cache/track-selection';
const rawId = 'track-raw-fixture',
	encodedId = 'track-encoded-fixture';
test.afterEach(async ({ page }, info) => {
	if (info.status === info.expectedStatus) return;
	const diagnostics = await page
		.evaluate(async () => {
			const provider = (window as any).trackTestProvider;
			const captions = provider?.encodedCaptions;
			const group = (captions?.renderers[0] ?? provider?.subtitles)?.composition;
			return {
				selected: captions?.selected,
				chunks: captions && [...captions.chunks.keys()],
				failures: captions && [...captions.failures],
				pending: captions && [...captions.pending.keys()],
				fontsLoaded: captions?.fontsLoaded,
				flushing: group?.flushing,
				dirty: group?.dirty,
				destroyed: group?.destroyed,
				message: group?.text.textContent,
				layers:
					group &&
					[...group.layers].map((layer: any) => ({
						format: layer.format,
						contentLength: layer.content.length
					})),
				styles: group?.renderer && !group.flushing ? await group.renderer.renderer.getStyles() : []
			};
		})
		.catch(() => ({}));
	await info.attach('subtitle-rendering-diagnostics', {
		body: JSON.stringify(diagnostics, null, 2),
		contentType: 'application/json'
	});
});
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
	{ Index: 6, Language: 'eng', Title: 'English styled', Location: '6.ass', CodecType: 'subtitle' },
	{ Index: 7, Language: 'eng', Title: 'English styled', Location: '7.ass', CodecType: 'subtitle' },
	{ Index: 8, Language: 'chi', Title: 'Chinese styled', Location: '8.ass', CodecType: 'subtitle' },
	{ Index: 9, Language: 'eng', Title: 'English text', Location: '9.vtt', CodecType: 'subtitle' },
	{ Index: 10, Language: 'chi', Title: 'Chinese text', Location: '10.vtt', CodecType: 'subtitle' }
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
		// Track-only cases also run without NVENC fixtures. Output-policy cases
		// explicitly override this choice below.
		if (!localStorage.getItem('sparkle.raw.hdr'))
			localStorage.setItem('sparkle.raw.hdr', 'compatible');
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
		if (file.startsWith('subtitles-'))
			return route.fulfill({
				json: {
					tracks: subtitleStreams.map((s, id) => ({
						id,
						codec: s.Location.endsWith('.ass')
							? 0x17016
							: s.Location.endsWith('.srt')
								? 0x17011
								: 0x17012,
						header: s.Location.endsWith('.ass')
							? readFileSync(`${root}/captions.ass`).toString('base64')
							: null
					})),
					packets: subtitleStreams.flatMap((s, id) => {
						const text = s.Index === 10 ? '中文文本' : s.Title;
						const intervals = s.Location.endsWith('.vtt')
							? ([
									[0, 15_000, text],
									[15_000, 15_000, `${text} — second`],
									[32_000, 15_000, `${text} — last`]
								] as const)
							: ([
									[0, 47_000, s.Location.endsWith('.ass') ? `0,0,Default,,0,0,0,,${text}` : text]
								] as const);
						return intervals.map(([pts, duration, data]) => ({
							key: `subtitle-${id}-${pts}`,
							id,
							pts,
							duration,
							data: Buffer.from(data).toString('base64')
						}));
					})
				}
			});
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
				body: readFileSync(`${root}/captions.ass`),
				contentType: 'text/plain'
			});
		if (file.endsWith('.vtt'))
			return route.fulfill({
				body: 'WEBVTT\n\n00:00:00.000 --> 00:00:47.000\nTrack selection fixture\n',
				contentType: 'text/vtt'
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

function textOverlay(page: Page) {
	return page
		.locator('.sparkle-raw-surface [data-raw-subtitle-composition="text"]')
		.filter({ hasText: 'English text' });
}
async function nativeCaptions(page: Page) {
	return page.locator('.sparkle-raw-surface video').evaluate((v: HTMLVideoElement) => {
		const track = [...v.textTracks].find((t) => t.label === 'Sparkle subtitles');
		return {
			mode: track?.mode,
			tracks: v.textTracks.length,
			text: [...(track?.activeCues ?? [])]
				.map((c) => (c as VTTCue).getCueAsHTML().textContent)
				.join('\n')
		};
	});
}
async function seekRaw(page: Page, seconds: number) {
	await page.evaluate(
		async (seconds) => (window as any).trackTestProvider.setCurrentTime(seconds),
		seconds
	);
	await expect
		.poll(() =>
			page.locator('.sparkle-raw-surface video').evaluate((v: HTMLVideoElement) => v.currentTime)
		)
		.toBeGreaterThanOrEqual(seconds - 0.1);
}
async function selectVttLayers(page: Page) {
	const player = page.locator('[data-media-player]');
	await player.press('k');
	await expect(player).toHaveAttribute('data-paused', '');
	await openSubtitles(page);
	await page.getByRole('radio', { name: 'Native', exact: true }).click();
	await expect.poll(() => rawSubtitleIndex(page)).toBe(9);
	await rawToggle(page, 10, true);
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await player.press('k');
	await expect(textOverlay(page)).toHaveText('English text\n中文文本');
	await expect
		.poll(() => nativeCaptions(page))
		.toEqual({ mode: 'hidden', text: 'English text\n中文文本', tracks: 1 });
}

for (const mode of ['compatible', 'av1', 'hevc']) {
	for (const api of ['native', 'presentation'] as const) {
		test(`Raw ${mode} mobile fullscreen uses the active video and VTT layers with the iOS ${api} API`, async ({
			page,
			request
		}, info) => {
			test.skip(
				!existsSync(`${root}/multilingual.mkv`),
				'Run node scripts/tests/prepare-track-fixture.mjs'
			);
			test.skip(
				mode !== 'compatible' && !existsSync(`${root}/${mode}/master.m3u8`),
				'Prepare NVENC fixtures'
			);
			await page.addInitScript((mode) => localStorage.setItem('sparkle.raw.hdr', mode), mode);
			await page.setViewportSize({ width: 390, height: 844 });
			await page.addInitScript((api) => {
				// Simulate iOS video-only fullscreen without claiming physical-device coverage.
				Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
				Object.defineProperty(document, 'webkitFullscreenEnabled', { get: () => false });
				const proto = HTMLVideoElement.prototype as any;
				if (api === 'native') {
					Object.defineProperty(proto, 'webkitSupportsFullscreen', {
						get() {
							return this.readyState > 0;
						}
					});
					proto.webkitEnterFullscreen = function () {
						this.dataset.captionsAtEntry = this.textTracks[0]?.mode;
						this.dataset.nativeFullscreen = 'true';
						this.dispatchEvent(new Event('webkitbeginfullscreen'));
					};
					proto.webkitExitFullscreen = function () {
						this.dataset.nativeFullscreen = 'false';
						this.dispatchEvent(new Event('webkitendfullscreen'));
					};
				} else {
					proto.webkitSupportsPresentationMode = function () {
						return this.readyState > 0;
					};
					proto.webkitSetPresentationMode = function (mode: string) {
						if (mode === 'fullscreen') this.dataset.captionsAtEntry = this.textTracks[0]?.mode;
						this.webkitPresentationMode = mode;
						this.dataset.nativeFullscreen = String(mode === 'fullscreen');
						this.dispatchEvent(new Event('webkitpresentationmodechanged'));
					};
				}
			}, api);
			await fixture(page);
			const room = `fullscreen-${mode}-${api}-${Date.now()}`;
			expect(
				(await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } })).ok()
			).toBe(true);
			await page.goto(`/${room}/media/${rawId}`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			const player = page.locator('[data-media-player]');
			const video = page.locator('.sparkle-raw-surface video');
			await expect
				.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
				.toBeGreaterThan(1);
			await selectVttLayers(page);
			await player.hover();
			const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true });
			await expect(fullscreen).toBeVisible();
			await expect(player.locator('.vds-controls')).toHaveCSS('opacity', '1');
			const bounds = (await fullscreen.boundingBox())!;
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
			await page.screenshot({ path: info.outputPath('mobile-fullscreen.png') });
			await fullscreen.click();
			await expect(video).toHaveAttribute('data-native-fullscreen', 'true');
			await expect(player).toHaveAttribute('data-fullscreen', '');
			await expect(video).toHaveAttribute('data-captions-at-entry', 'showing');
			await expect
				.poll(() => nativeCaptions(page))
				.toEqual({ mode: 'showing', text: 'English text\n中文文本', tracks: 1 });
			await expect(textOverlay(page)).toBeHidden();
			// Native cue scheduling, including overlaps, gaps and backwards seeks.
			for (const [time, text] of [
				[14, 'English text — second\n中文文本 — second'],
				[31, ''],
				[32, 'English text — last\n中文文本 — last'],
				[0, 'English text\n中文文本']
			] as const) {
				await seekRaw(page, time);
				await expect.poll(async () => (await nativeCaptions(page)).text).toBe(text);
			}
			// The native Done gesture, outside Sparkle's controls, must update Vidstack too.
			await video.evaluate((v: any) => {
				if (v.webkitExitFullscreen) v.webkitExitFullscreen();
				else v.webkitSetPresentationMode('inline');
			});
			await expect(player).not.toHaveAttribute('data-fullscreen');
			await expect.poll(async () => (await nativeCaptions(page)).mode).toBe('hidden');
			await expect(textOverlay(page)).toHaveText('English text\n中文文本');
			await expect(textOverlay(page)).toBeVisible();
			await openSubtitles(page);
			await rawToggle(page, 10, false);
			await page.keyboard.press('Escape');
			await page.keyboard.press('Escape');
			await expect.poll(async () => (await nativeCaptions(page)).text).toBe('English text');
			await page.setViewportSize({ width: 844, height: 390 });
			await player.hover();
			await expect(fullscreen).toBeVisible();
			await fullscreen.click();
			await expect(player).toHaveAttribute('data-fullscreen', '');
			await player.hover();
			await fullscreen.click();
			await expect(player).not.toHaveAttribute('data-fullscreen');
			await expect(video).toHaveAttribute('data-native-fullscreen', 'false');
			await player.hover();
			await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
			await expect.poll(async () => (await nativeCaptions(page)).text).toBe('');
			expect((await nativeCaptions(page)).tracks).toBe(1);
		});
	}
}

test.describe('Android Chrome fullscreen', () => {
	const { userAgent, viewport, screen, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
	test.use({ userAgent, viewport, screen, deviceScaleFactor, isMobile, hasTouch });

	for (const mode of ['compatible', 'av1', 'hevc', 'auto']) {
		test(`Raw ${mode} keeps touch controls and overlays in whole-player fullscreen`, async ({
			page,
			request
		}, info) => {
			test.skip(!existsSync(`${root}/multilingual.mkv`), 'Prepare multilingual fixtures');
			test.skip(
				mode !== 'compatible' &&
					!existsSync(`${root}/${mode === 'auto' ? 'av1' : mode}/master.m3u8`),
				'Prepare the optional NVENC fixtures'
			);
			await fixture(page);
			await page.addInitScript((mode) => localStorage.setItem('sparkle.raw.hdr', mode), mode);
			const room = `fullscreen-android-${mode}-${Date.now()}`;
			expect(
				(await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } })).ok()
			).toBe(true);
			await page.goto(`/${room}/media/${rawId}`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).tap();
			const player = page.locator('[data-media-player]');
			const video = page.locator('.sparkle-raw-surface video');
			const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true });
			await expect
				.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
				.toBeGreaterThan(1);
			await selectVttLayers(page);
			expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
			expect(await page.evaluate(() => document.fullscreenEnabled)).toBe(true);
			const showControls = async () => {
				if ((await player.locator('.vds-controls').getAttribute('data-visible')) === null) {
					const bounds = (await player.boundingBox())!;
					await player.tap({ position: { x: bounds.width / 4, y: bounds.height / 3 } });
				}
				await expect(fullscreen).toBeVisible();
				await expect(player.locator('.vds-controls')).toHaveCSS('opacity', '1');
			};
			for (const viewport of [
				{ width: 412, height: 839 },
				{ width: 839, height: 412 }
			]) {
				await seekRaw(page, 0);
				await page.setViewportSize(viewport);
				await showControls();
				const bounds = (await fullscreen.boundingBox())!;
				expect(bounds.x).toBeGreaterThanOrEqual(0);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
				const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
				await fullscreen.tap();
				await expect(player).toHaveAttribute('data-fullscreen', '');
				await expect
					.poll(() => player.evaluate((el) => document.fullscreenElement === el))
					.toBe(true);
				await expect(player).not.toHaveAttribute('data-paused');
				await expect
					.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
					.toBeGreaterThan(before);
				// Use Chrome's actual Fullscreen API, not an Android/WebKit API stub.
				expect(await video.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(true);
				const captions = textOverlay(page);
				await expect(captions).toHaveText('English text\n中文文本');
				await expect(captions).toBeVisible();
				await expect.poll(async () => (await nativeCaptions(page)).mode).toBe('hidden');
				expect(await captions.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(
					true
				);
				await showControls();
				await page.getByRole('button', { name: 'Settings', exact: true }).tap();
				const settings = page.getByRole('menuitem', { name: /^Video Settings/ });
				await expect(settings).toBeVisible();
				expect(await settings.evaluate((el) => document.fullscreenElement!.contains(el))).toBe(
					true
				);
				await page.getByRole('button', { name: 'Settings', exact: true }).tap();
				await expect(settings).toBeHidden();
				await showControls();
				await page.screenshot({
					path: info.outputPath(`android-fullscreen-${viewport.width}.png`)
				});
				await fullscreen.tap();
				await expect(player).not.toHaveAttribute('data-fullscreen');
				await expect
					.poll(() => page.evaluate(() => document.fullscreenElement === null))
					.toBe(true);
				await showControls();
			}
			// Browser-driven exit (for example Android Back) also resets the control state.
			await fullscreen.tap();
			await expect(player).toHaveAttribute('data-fullscreen', '');
			await page.evaluate(() => document.exitFullscreen());
			await expect(player).not.toHaveAttribute('data-fullscreen');
			await expect(player).not.toHaveAttribute('data-paused');
		});
	}
});

for (const mode of ['compatible', 'av1', 'hevc', 'auto']) {
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
			mode !== 'compatible' && !existsSync(`${root}/${mode === 'auto' ? 'av1' : mode}/master.m3u8`),
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
				if (mode === 'auto')
					await expect(page.locator('[data-media-player]')).toHaveAttribute(
						'data-raw-encoding',
						/av1|hevc/
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
			await openSubtitles(first);
			await rawToggle(first, 8, true);
			await rawToggle(first, 6, false);
			await expect.poll(() => rawSubtitleIndex(first)).toBe(8);
			expect(await rawSubtitleIndex(peer)).toBe(6);
			await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
			await first.keyboard.press('Escape');
			await first.keyboard.press('Escape');
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

test('Raw VTT layers stay local through delayed join, reconnect and rapid source changes', async ({
	browser,
	request,
	baseURL
}) => {
	test.skip(!existsSync(`${root}/multilingual.mkv`), 'Prepare multilingual fixtures');
	const room = `subtitle-lifecycle-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	const first = await browser.newPage(),
		peer = await browser.newPage();
	try {
		await fixture(first);
		await fixture(peer);
		await peer.route(`**/be/media/${rawId}`, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1200));
			await route.fallback();
		});
		await first.goto(`${baseURL}/${room}/media/${rawId}`);
		await first.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect
			.poll(() =>
				first.locator('.sparkle-raw-surface video').evaluate((v: HTMLVideoElement) => v.currentTime)
			)
			.toBeGreaterThan(1);
		await selectVttLayers(first);
		await peer.goto(`${baseURL}/${room}/media/${rawId}`);
		await peer.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(peer)).toBe(6);
		await peer.reload();
		await peer.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(peer)).toBe(6);
		await expect.poll(async () => (await status(first)).subtitleLayers?.length).toBe(1);
		await expect(first.locator('[data-media-player]')).not.toHaveAttribute('data-paused');
		await first.evaluate(() => {
			(window as any).oldRawVideo = document.querySelector('.sparkle-raw-surface video');
		});
		for (const id of [encodedId, rawId, encodedId])
			expect((await request.put(`/be/rooms/${room}`, { data: { mediaId: id } })).ok()).toBe(true);
		for (const page of [first, peer]) {
			await expect(page).toHaveURL(new RegExp(`/media/${encodedId}$`), { timeout: 20_000 });
			await expect(page.locator('.sparkle-raw-surface')).toHaveCount(0);
		}
		await expect
			.poll(() =>
				first.evaluate(() => {
					const track = (window as any).oldRawVideo.textTracks[0];
					return { mode: track.mode, cues: track.cues?.length ?? 0 };
				})
			)
			.toEqual({ mode: 'disabled', cues: 0 });
		expect((await request.put(`/be/rooms/${room}`, { data: { mediaId: rawId } })).ok()).toBe(true);
		for (const page of [first, peer])
			await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
				timeout: 20_000
			});
		// Room media changes begin paused; initialize the replacement providers with play.
		await first.locator('[data-media-player]').press('k');
		await expect.poll(() => audioTitle(first)).toBe('Japanese');
		await expect.poll(async () => (await status(first)).subtitleLayers?.length).toBe(1);
		await expect.poll(() => rawSubtitleIndex(peer)).toBe(6);
		await expect.poll(async () => (await nativeCaptions(first)).tracks).toBe(1);
	} finally {
		await Promise.all([first.close(), peer.close()]);
	}
});

for (const codec of ['av1', 'hevc']) {
	test(`Automatic selects ${codec} by native support without reading the original, and Compatible remains explicit`, async ({
		page,
		request
	}) => {
		test.skip(!existsSync(`${root}/${codec}/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
		await fixture(page);
		await page.addInitScript((codec) => {
			if (!sessionStorage.getItem('seeded-output-preference')) {
				localStorage.setItem('sparkle.raw.hdr', 'auto');
				sessionStorage.setItem('seeded-output-preference', 'true');
			}
			Object.defineProperty(navigator, 'connection', {
				configurable: true,
				value: {
					effectiveType: codec === 'av1' ? '4g' : '3g',
					downlink: codec === 'av1' ? 1000 : 0.2,
					saveData: codec === 'hevc'
				}
			});
			if (codec === 'hevc') {
				const supports = MediaSource.isTypeSupported.bind(MediaSource);
				MediaSource.isTypeSupported = (type) => !type.includes('av01') && supports(type);
			}
		}, codec);
		let originalRequests = 0;
		page.on('request', (request) => {
			if (/\/parts\/[^/]+\/file(?:\?|$)/.test(request.url())) originalRequests++;
		});
		const room = `automatic-${codec}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		await page.goto(`/${room}/media/${rawId}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(async () => (await status(page))?.encodedCodec).toBe(codec);
		await expect.poll(() => audioTitle(page)).toBe('Japanese');
		expect(originalRequests).toBe(0);
		expect(await page.evaluate(() => localStorage.getItem('sparkle.raw.hdr'))).toBe('auto');
		await page.reload();
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => audioTitle(page)).toBe('Japanese');
		expect((await status(page)).encodedCodec).toBe(codec);
		expect(originalRequests).toBe(0);
		await page.locator('[data-media-player]').press('k');
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		await openVideoSettings(page);
		await page.getByRole('menuitemradio', { name: 'Compatible', exact: true }).click();
		await expect.poll(async () => (await status(page))?.hdrPreference).toBe('compatible');
		await expect.poll(async () => (await status(page))?.changing).toBe(false);
		expect((await status(page)).encodedCodec).toBeUndefined();
		expect(originalRequests).toBeGreaterThan(0);
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		await page.reload();
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => audioTitle(page)).toBe('Japanese');
		expect((await status(page)).hdrPreference).toBe('compatible');
		expect((await status(page)).encodedCodec).toBeUndefined();
		await openVideoSettings(page);
		originalRequests = 0;
		await page.getByRole('menuitemradio', { name: 'Automatic', exact: true }).click();
		await expect.poll(async () => (await status(page))?.encodedCodec).toBe(codec);
		await expect.poll(async () => (await status(page))?.changing).toBe(false);
		expect(originalRequests).toBe(0);
	});
}

for (const failure of ['unsupported browser', 'encoding disabled', 'manifest failure']) {
	test(`Automatic reports ${failure} without falling back to Compatible`, async ({
		page,
		request
	}) => {
		test.skip(!existsSync(`${root}/multilingual.mkv`), 'Prepare multilingual fixtures');
		await fixture(page);
		await page.addInitScript((failure) => {
			localStorage.removeItem('sparkle.raw.hdr');
			if (failure === 'unsupported browser') {
				const supports = MediaSource.isTypeSupported.bind(MediaSource);
				MediaSource.isTypeSupported = (type) => !/av01|hvc1/.test(type) && supports(type);
			}
		}, failure);
		await page.route('**/encoding/capabilities', (route) =>
			route.fulfill({ json: { codecs: failure === 'encoding disabled' ? [] : ['av1', 'hevc'] } })
		);
		if (failure === 'manifest failure')
			await page.route('**/encoded/*/manifest', (route) => route.fulfill({ status: 503 }));
		let originalRequests = 0;
		page.on('request', (request) => {
			if (/\/parts\/[^/]+\/file(?:\?|$)/.test(request.url())) originalRequests++;
		});
		const room = `automatic-failure-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		await page.goto(`/${room}/media/${rawId}`);
		await expect
			.poll(async () => (await status(page))?.reason)
			.toMatch(
				failure === 'manifest failure'
					? /Server encoding is unavailable/
					: /Automatic requires Encoded AV1 or HEVC/
			);
		expect(originalRequests).toBe(0);
		expect((await status(page)).hdrPreference).toBe('auto');
		expect((await status(page)).ready).toBe(false);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect(page.getByRole('textbox', { name: 'Chat', exact: true }).last()).toBeEnabled();
		await openVideoSettings(page);
		await expect(
			page.getByRole('menuitemradio', { name: 'Automatic', exact: true })
		).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('menuitemradio', { name: 'Compatible', exact: true }).click();
		await expect.poll(async () => (await status(page))?.ready).toBe(true);
		expect((await status(page)).hdrPreference).toBe('compatible');
		expect(originalRequests).toBeGreaterThan(0);
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

async function openSubtitles(page: Page) {
	await page.locator('[data-media-player]').hover();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Subtitles/ }).click();
}

async function rawSubtitleIndex(page: Page) {
	const s = await status(page);
	return s?.subtitleTracks.find((t) => t.id === s.subtitle)?.index ?? -1;
}

async function rawToggle(page: Page, index: number, checked: boolean) {
	const label = await page.evaluate((index) => {
		const p = (window as any).trackTestProvider;
		const id = p.status.subtitleTracks.find((t: any) => t.index === index).id;
		return p.subtitleSelectionTracks.find((t: any) => t.id === id).settingsLabel as string;
	}, index);
	await page.getByRole('menuitemcheckbox', { name: label, exact: true }).setChecked(checked);
	await expect.poll(async () => (await status(page))?.changing).toBe(false);
}

for (const mode of ['compatible', 'av1', 'hevc']) {
	test(`Raw ${mode}: subtitle toggles, missing preference, format layers and duplicate identity`, async ({
		page,
		request,
		baseURL
	}) => {
		test.skip(
			!existsSync(`${root}/captions.ass`) ||
				(mode !== 'compatible' && !existsSync(`${root}/${mode}/master.m3u8`)),
			'Prepare multilingual/NVENC fixtures'
		);
		await fixture(page);
		await page.addInitScript((mode) => {
			localStorage.setItem('sparkle.raw.hdr', mode);
			if (!sessionStorage.getItem('seeded-subtitle-preference')) {
				localStorage.setItem(
					'subtitleSelection',
					JSON.stringify({
						language: 'zh-CN',
						format: 'ass',
						label: 'Missing track',
						src: 'missing.ass'
					})
				);
				sessionStorage.setItem('seeded-subtitle-preference', 'true');
			}
		}, mode);
		const room = `subtitle-${mode}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		await page.goto(`${baseURL}/${room}/media/${rawId}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(page)).toBe(8);
		expect(
			await page.evaluate(() => JSON.parse(localStorage.getItem('subtitleSelection')!).label)
		).toBe('Missing track');
		await page.locator('[data-media-player]').press('k');
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		const time = await page
			.locator('.sparkle-raw-surface video')
			.evaluate((v: HTMLVideoElement) => v.currentTime);
		await openSubtitles(page);
		await expect(page.getByRole('radiogroup', { name: 'Subtitle format' })).toBeVisible();
		// Exercise the actual demuxer and NVENC packet paths beyond the former cap.
		for (const index of [5, 6, 7]) await rawToggle(page, index, true);
		await expect.poll(async () => (await status(page)).subtitleLayers?.length).toBe(3);
		await expect
			.poll(
				() =>
					page.evaluate(async () => {
						const provider = (window as any).trackTestProvider;
						const group = (provider.encodedCaptions?.renderers[0] ?? provider.subtitles)
							?.composition;
						if (!group?.renderer || group.flushing) return 0;
						const styles = await group.renderer.renderer.getStyles();
						return styles.filter((style: any) => style.Name.startsWith('sparkle_')).length;
					}),
				{ timeout: 20_000 }
			)
			.toBe(4);
		expect(
			page.workers().filter((worker) => worker.url().endsWith('/jassub/worker.js'))
		).toHaveLength(1);
		for (const index of [5, 6, 7]) await rawToggle(page, index, false);
		await rawToggle(page, 7, true);
		await rawToggle(page, 8, false);
		await expect.poll(() => rawSubtitleIndex(page)).toBe(7);
		await rawToggle(page, 8, true);
		await page.getByRole('radio', { name: 'Native', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(page)).toBe(9);
		await rawToggle(page, 10, true);
		await expect.poll(async () => (await status(page)).subtitleLayers?.length).toBe(1);
		await page.getByRole('radio', { name: 'Styled', exact: true }).click();
		await expect
			.poll(async () => {
				const s = await status(page);
				return s.subtitleTracks.filter((t) => s.subtitleLayers?.includes(t.id)).map((t) => t.index);
			})
			.toEqual([8]);
		await page.getByRole('radio', { name: 'Native', exact: true }).click();
		await expect
			.poll(async () => {
				const s = await status(page);
				return s.subtitleTracks.filter((t) => s.subtitleLayers?.includes(t.id)).map((t) => t.index);
			})
			.toEqual([10]);
		if (mode !== 'compatible')
			await expect(
				page
					.locator('.sparkle-raw-surface [data-raw-subtitle-composition="text"]')
					.filter({ hasText: 'English text' })
			).toHaveText('English text\n中文文本');
		await page.getByRole('radio', { name: 'Styled', exact: true }).click();
		// Remove every other selected track so duplicate #2 is the primary.
		if ((await rawSubtitleIndex(page)) !== 7) {
			await rawToggle(page, 7, true);
			await rawToggle(page, 6, false);
			await rawToggle(page, 8, false);
			await rawToggle(page, 8, true);
		}
		await expect.poll(() => rawSubtitleIndex(page)).toBe(7);
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		expect(
			Math.abs(
				(await page
					.locator('.sparkle-raw-surface video')
					.evaluate((v: HTMLVideoElement) => v.currentTime)) - time
			)
		).toBeLessThan(0.6);
		if (
			mode === 'compatible' &&
			existsSync(`${root}/av1/master.m3u8`) &&
			existsSync(`${root}/hevc/master.m3u8`)
		) {
			await page.keyboard.press('Escape');
			await page.keyboard.press('Escape');
			await openVideoSettings(page);
			for (const codec of ['av1', 'hevc']) {
				await page
					.getByRole('menuitemradio', { name: `Encoded ${codec.toUpperCase()}`, exact: true })
					.click();
				await expect(page.locator('[data-media-player]')).toHaveAttribute(
					'data-raw-encoding',
					codec
				);
				await expect.poll(() => rawSubtitleIndex(page)).toBe(7);
				await expect.poll(async () => (await status(page)).subtitleLayers?.length).toBe(1);
			}
		}
		await page.reload();
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(page)).toBe(7);
		await expect.poll(async () => (await status(page)).subtitleLayers?.length).toBe(1);
		await page.locator('[data-media-player]').hover();
		await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(page)).toBe(-1);
		await expect.poll(async () => (await status(page)).changing).toBe(false);
		await page.reload();
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => audioTitle(page)).toBe('Japanese');
		await expect.poll(() => rawSubtitleIndex(page)).toBe(-1);
		await page.locator('[data-media-player]').hover();
		await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
		await expect.poll(() => rawSubtitleIndex(page)).toBe(6);
		await expect.poll(async () => (await status(page)).subtitleLayers?.length).toBe(1);
	});
}

test('Encoded keeps its subtitle layout and per-format choices; preferences cross source boundaries', async ({
	page,
	request,
	baseURL
}) => {
	test.skip(!existsSync(`${root}/captions.ass`), 'Prepare multilingual fixtures');
	await fixture(page);
	const room = `subtitle-encoded-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: encodedId } });
	await page.goto(`${baseURL}/${room}/media/${encodedId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await openSubtitles(page);
	await expect(
		page.getByRole('menuitemcheckbox', { name: /English styled/ }).first()
	).toBeVisible();
	const chinese = page.getByRole('menuitemcheckbox', { name: /Chinese.*styled/ });
	await chinese.check();
	await page.getByRole('radio', { name: 'Native', exact: true }).click();
	await page.getByRole('menuitemcheckbox', { name: /Chinese/ }).check();
	await page.getByRole('radio', { name: 'Styled', exact: true }).click();
	await expect(chinese).toBeChecked();
	await page
		.getByRole('menuitemcheckbox', { name: /English styled/ })
		.first()
		.uncheck();
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(localStorage.getItem('subtitleSelection')!).language)
		)
		.toBe('zh-CN');
	await request.put(`/be/rooms/${room}`, { data: { mediaId: rawId } });
	await page.goto(`${baseURL}/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => rawSubtitleIndex(page)).toBe(8);
	await page.locator('[data-media-player]').hover();
	await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
	await expect.poll(() => rawSubtitleIndex(page)).toBe(-1);
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(localStorage.getItem('subtitleSelection')!).disabled)
		)
		.toBe(true);
	await request.put(`/be/rooms/${room}`, { data: { mediaId: encodedId } });
	await page.goto(`${baseURL}/${room}/media/${encodedId}`);
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(localStorage.getItem('subtitleSelection')!).disabled)
		)
		.toBe(true);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await openSubtitles(page);
	await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(0);
});

for (const source of ['raw', 'encoded']) {
	test(`${source} subtitle menu fits a narrow mobile viewport`, async ({
		page,
		request,
		baseURL
	}) => {
		test.skip(!existsSync(`${root}/captions.ass`), 'Prepare multilingual fixtures');
		await page.setViewportSize({ width: 375, height: 812 });
		await fixture(page);
		const id = source === 'raw' ? rawId : encodedId,
			room = `subtitle-mobile-${source}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: id } });
		await page.goto(`${baseURL}/${room}/media/${id}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		if (source === 'raw') await expect.poll(() => rawSubtitleIndex(page)).toBe(6);
		await openSubtitles(page);
		const tabs = page.getByRole('radiogroup', { name: 'Subtitle format' });
		await expect(tabs).toBeVisible();
		const box = await tabs.boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(375);
		await page.getByRole('radio', { name: 'Native', exact: true }).click();
		await expect(page.getByRole('radio', { name: 'Native', exact: true })).toBeChecked();
		await expect(page.getByRole('menuitemcheckbox', { name: /English/ })).toBeChecked();
		await page.screenshot({ path: test.info().outputPath(`${source}-mobile-subtitles.png`) });
	});
}
