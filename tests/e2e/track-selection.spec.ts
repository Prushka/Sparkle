import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RawPlaybackStatus } from '../../lib/player/raw-types';

const root = 'cache/track-selection';
// Older manifests have no channel count and must use the safe PCM path.
// Reuse the timeline fixtures to run room/fullscreen checks through that path.
const encodedPCM = process.env.SPARKLE_TEST_ENCODED_PCM === '1';
const rawId = 'track-raw-fixture',
	rawNextId = 'track-raw-next-fixture',
	encodedId = 'track-encoded-fixture';
test.afterEach(async ({ page }, info) => {
	if (info.status === info.expectedStatus) return;
	const diagnostics = await page
		.evaluate(async () => {
			const provider = (window as any).trackTestProvider;
			const captions = provider?.encodedCaptions;
			const group = (captions?.renderers[0] ?? provider?.subtitles)?.composition;
			return {
				playback: provider && {
					status: provider.status,
					initialized: provider.initialized,
					starting: provider.starting,
					pendingSeek: provider.pendingSeek,
					remoteOperations: provider.remoteOperations,
					canPublishPlayback: provider.canPublishPlayback,
					canPlay: provider.ctx.player.state.canPlay,
					paused: provider.ctx.player.state.paused,
					error: provider.ctx.player.state.error
				},
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
	const path = info.outputPath('player-diagnostics.json');
	writeFileSync(path, JSON.stringify(diagnostics, null, 2));
	await info.attach('player-diagnostics', {
		path,
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

async function fixture(page: Page, nextDuration = 48, sizedSubtitles = false, audioMixes = false) {
	const streams = subtitleStreams.map((s) => ({
		...s,
		Title:
			sizedSubtitles && s.Index === 6
				? 'A signs'
				: sizedSubtitles && s.Index === 7
					? 'Z full'
					: s.Title
	}));
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
	if (sizedSubtitles) Object.assign(files, { '6.ass': 100, '7.ass': 1000 });
	const bytes = readFileSync(
		`${root}/${sizedSubtitles ? 'multilingual-sized' : 'multilingual'}.mkv`
	);
	for (const id of [rawId, rawNextId, encodedId]) {
		await page.route(`**/be/media/${id}`, (route) =>
			route.fulfill({
				json: {
					Id: id,
					Title: { title: 'Track fixture', titleId: 'track-fixture', id, modTime: 1 },
					Source: id !== encodedId ? 'plex' : 'processed',
					Input: 'Track fixture.mkv',
					State: 'complete',
					Duration: id === rawNextId ? nextDuration : 48,
					width: 320,
					height: 180,
					Files: files,
					EncodedCodecs: id !== encodedId ? [] : ['h264-8bit'],
					MappedAudio: { 'h264-8bit': audio },
					Streams: streams,
					Chapters: [],
					DominantColors: [],
					JobModTime: 1,
					...(id !== encodedId
						? {
								Raw: {
									container: 'mkv',
									videoCodec: 'h264',
									versions: [],
									parts: [
										{
											id: '1',
											url: `/media/${id}/parts/1/file`,
											size: bytes.length,
											duration: id === rawNextId ? nextDuration : 48,
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
												...streams.map((s) => ({
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
	await page.route('**/be/media/track-raw*/parts/1/file', (route) => serveBytes(route, bytes));
	await page.route('**/be/media/track-raw*/parts/1/encoded/**', (route) => {
		const segments = new URL(route.request().url()).pathname.split('/');
		const duration = segments.includes(rawNextId) ? nextDuration : 48;
		const codec = segments.at(-2)!,
			resource = segments.at(-1)!,
			// These older timeline fixtures multiplex audio/video in one playlist.
			// The real surround qualifier separately uses production split playlists.
			file =
				(encodedPCM || audioMixes) && /^(video|audio)\.m3u8$/.test(resource)
					? 'master.m3u8'
					: resource;
		if (file === 'manifest')
			return route.fulfill({
				json: {
					fingerprint: 'fixture',
					playlist: 'master.m3u8',
					codec,
					output: 'SDR',
					// Toggle lifecycle only; actual enhanced pixels use the AI HDR qualifier.
					...(new URL(route.request().url()).searchParams.get('aiHDR') === '1'
						? { aiHDR: true, aiHDRMode: 'hdr-expansion', output: 'HDR10' }
						: {}),
					duration,
					timestampStart: true,
					width: 320,
					height: 180,
					audio: true,
					audioChannels: audioMixes ? 8 : encodedPCM ? undefined : 2,
					// Metadata exercises display/identity only; real multichannel
					// samples and layouts are checked by the NVENC browser qualifier.
					audioTracks: audioMixes
						? [
								{ sourceChannels: 12, channels: 8, layout: '7.1', conversion: 'downmix' },
								{ sourceChannels: 12, channels: 2, layout: 'stereo', conversion: 'unknown' },
								{ sourceChannels: 2, channels: 2, layout: 'stereo', conversion: 'preserved' }
							]
						: undefined,
					subtitleTracks: streams.map((s, id) => ({
						id,
						title: s.Title,
						size: sizedSubtitles ? files[s.Location] : undefined
					})),
					hasFonts: false,
					segmentSeconds: 6
				}
			});
		if (file.startsWith('subtitles-'))
			return route.fulfill({
				json: {
					tracks: streams.map((s, id) => ({
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
					packets: streams.flatMap((s, id) => {
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
		if (file.endsWith('m3u8') && duration < 48)
			return route.fulfill({
				contentType: 'application/vnd.apple.mpegurl',
				body: readFileSync(`${root}/${codec}/${file}`, 'utf8').replace(
					/#EXTINF:[^\n]+\nsegment-(\d+)\.m4s\r?\n/g,
					(entry, index) => (Number(index) * 6 < duration ? entry : '')
				)
			});
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
			if (mode === 'compatible' || encodedPCM) {
				await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true');
				await page.evaluate(async () => {
					const context = (window as any).trackTestProvider.pcmContext as AudioContext;
					await context.suspend();
					const resume = context.resume.bind(context);
					context.resume = () => {
						if (window.event?.isTrusted) (window as any).pcmResumedInGesture = true;
						return resume();
					};
				});
			}
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			if (mode === 'compatible' || encodedPCM)
				expect(await page.evaluate(() => (window as any).pcmResumedInGesture)).toBe(true);
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
				if (encodedPCM && mode !== 'compatible')
					expect(await page.evaluate(() => !!(window as any).trackTestProvider.audioEngine)).toBe(
						true
					);
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
		// Track metadata is published before the replacement decoder finishes
		// priming. Wait until a user pause can be sent to the room before switching.
		await expect
			.poll(() => page.evaluate(() => (window as any).trackTestProvider.canPublishPlayback))
			.toBe(true);
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

test('Compatible keeps the first PGS track on startup and restores it after Off and a seek', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/pixels.mkv`), 'Prepare the PGS MKV fixture');
	await fixture(page);
	const bytes = readFileSync(`${root}/pixels.mkv`);
	await page.route(`**/be/media/${rawId}`, (route) =>
		route.fulfill({
			json: {
				Id: rawId,
				Title: { title: 'PGS fixture', titleId: rawId, id: rawId, modTime: 1 },
				Source: 'plex',
				Input: 'PGS fixture.mkv',
				State: 'complete',
				EncodedCodecs: [],
				MappedAudio: {},
				JobModTime: 1,
				Duration: 48,
				width: 320,
				height: 180,
				Files: {},
				Streams: [],
				Chapters: [],
				DominantColors: [],
				Raw: {
					container: 'mkv',
					videoCodec: 'h264',
					versions: [],
					parts: [
						{
							id: '1',
							url: `/media/${rawId}/parts/1/file`,
							size: bytes.length,
							duration: 48,
							start: 0,
							streams: [
								{ id: 0, index: 0, streamType: 1, codec: 'h264' },
								{ id: 1, index: 1, streamType: 2, codec: 'aac', languageCode: 'eng' },
								{
									id: 2,
									index: 2,
									streamType: 3,
									codec: 'pgs',
									languageCode: 'eng',
									displayTitle: 'English image'
								}
							]
						}
					]
				}
			}
		})
	);
	await page.route(`**/be/media/${rawId}/parts/1/file`, (route) => serveBytes(route, bytes));
	const room = `pgs-start-${Date.now()}`;
	expect((await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } })).ok()).toBe(
		true
	);
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => rawSubtitleIndex(page)).toBe(2);
	const ink = () =>
		page.evaluate(() => {
			const canvas = (window as any).trackTestProvider?.subtitles?.canvas;
			if (!canvas || canvas.style.visibility === 'hidden') return -1;
			const pixels = canvas.getContext('2d').getImageData(0, 0, 32, 1).data;
			return [...pixels].findIndex((value, index) => index % 4 === 3 && value !== 0) >> 2;
		});
	await expect.poll(ink).toBe(0);
	const player = page.locator('[data-media-player]');
	await player.hover();
	await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
	await expect.poll(() => rawSubtitleIndex(page)).toBe(-1);
	await seekRaw(page, 12);
	await expect.poll(ink).toBe(-1);
	await player.press('k');
	await expect(player).toHaveAttribute('data-paused', '');
	await player.press('k');
	await expect(player).not.toHaveAttribute('data-paused');
	await expect.poll(ink).toBe(-1);
	await player.hover();
	await page.getByRole('button', { name: 'Closed captions', exact: true }).click();
	await expect.poll(() => rawSubtitleIndex(page)).toBe(2);
	await expect.poll(ink).toBeGreaterThanOrEqual(12);
});

for (const mode of ['processed', 'compatible', 'av1', 'hevc']) {
	test(`${mode}: largest subtitle default preserves an explicit smaller choice and Off`, async ({
		page,
		request
	}) => {
		test.skip(!existsSync(`${root}/multilingual-sized.mkv`), 'Prepare multilingual fixtures');
		test.skip(
			['av1', 'hevc'].includes(mode) && !existsSync(`${root}/${mode}/master.m3u8`),
			'Prepare NVENC fixtures'
		);
		await fixture(page, 48, true);
		if (mode !== 'processed')
			await page.addInitScript((mode) => localStorage.setItem('sparkle.raw.hdr', mode), mode);
		const id = mode === 'processed' ? encodedId : rawId;
		const room = `subtitle-size-${mode}-${Date.now()}`;
		expect((await request.post('/be/rooms', { data: { roomId: room, mediaId: id } })).ok()).toBe(
			true
		);
		await page.goto(`/${room}/media/${id}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		if (mode !== 'processed') await expect.poll(() => rawSubtitleIndex(page)).toBe(7);
		await openSubtitles(page);
		const small = page.getByRole('menuitemcheckbox', { name: /A signs/ });
		const large = page.getByRole('menuitemcheckbox', { name: /Z full/ });
		await expect(large).toBeChecked();
		await expect(small).not.toBeChecked();
		expect(await page.evaluate(() => localStorage.getItem('subtitleSelection'))).toBeNull();
		await small.check();
		await large.uncheck();
		await expect(small).toBeChecked();
		await expect
			.poll(() =>
				page.evaluate(() => JSON.parse(localStorage.getItem('subtitleSelection') || '{}').label)
			)
			.toContain('A signs');
		await page.reload();
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await openSubtitles(page);
		await expect(small).toBeChecked();
		await expect(large).not.toBeChecked();
		await small.uncheck();
		await expect
			.poll(() =>
				page.evaluate(() => JSON.parse(localStorage.getItem('subtitleSelection') || '{}').disabled)
			)
			.toBe(true);
		await page.reload();
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await openSubtitles(page);
		await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(0);
	});
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

for (const codec of ['av1', 'hevc']) {
	test(`encoded ${codec} shows audio conversions on mobile and holds video during a slow PCM seek`, async ({
		page,
		request,
		baseURL
	}) => {
		test.skip(!existsSync(`${root}/${codec}/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
		await page.setViewportSize({ width: 375, height: 812 });
		await fixture(page, 48, false, true);
		await page.addInitScript((codec) => localStorage.setItem('sparkle.raw.hdr', codec), codec);
		const room = `audio-mix-${codec}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		await page.goto(`${baseURL}/${room}/media/${rawId}`);
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true');
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => audioTitle(page)).toBe('Japanese');
		await openVideoSettings(page);
		const mixed = page.getByRole('menuitemradio', { name: 'English · 7.1 mix', exact: true });
		const unknown = page.getByRole('menuitemradio', {
			name: 'Chinese · Stereo mix (unknown layout)',
			exact: true
		});
		await expect(mixed).toBeVisible();
		await expect(unknown).toBeVisible();
		const box = await unknown.boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(375);
		await page.screenshot({ path: test.info().outputPath(`${codec}-mobile-audio-mix.png`) });
		await mixed.click();
		await expect.poll(() => audioTitle(page)).toBe('English');
		expect(
			await page.evaluate(() => JSON.parse(localStorage.getItem('audioSelection') || '{}').title)
		).toBe('English');
		await page.keyboard.press('Escape');
		const result = await page.evaluate(async () => {
			const provider = (window as any).trackTestProvider;
			const audio = provider.audioEngine;
			const seek = audio.seek.bind(audio);
			let duringHold = 0;
			audio.seek = async (...args: unknown[]) => {
				// Native video has already landed while audio is deliberately late.
				await new Promise((resolve) => setTimeout(resolve, 300));
				const before = provider.engine.currentTime;
				await new Promise((resolve) => setTimeout(resolve, 700));
				duringHold = Number(provider.engine.currentTime - before);
				return seek(...args);
			};
			provider.setCurrentTime(18);
			await provider.commands;
			audio.seek = seek;
			await new Promise((resolve) => setTimeout(resolve, 900));
			return {
				duringHold,
				time: provider.timeline,
				drift: Number(audio.currentTime - provider.engine.currentTime)
			};
		});
		expect(Math.abs(result.duringHold)).toBeLessThan(100);
		expect(result.time).toBeGreaterThan(18.3);
		expect(Math.abs(result.drift)).toBeLessThan(500);
	});
}

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

for (const codec of ['av1', 'hevc']) {
	test(`encoded ${codec} recovers a native video suspended by mobile app switching`, async ({
		page,
		request
	}) => {
		test.skip(!existsSync(`${root}/${codec}/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
		await fixture(page);
		await page.addInitScript((mode) => localStorage.setItem('sparkle.raw.hdr', mode), codec);
		const room = `resume-${codec}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		await page.goto(`/${room}/media/${rawId}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		const video = page.locator('.sparkle-raw-surface video');
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30000 })
			.toBeGreaterThan(2);
		const stopped = await page.evaluate(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, value: true });
			document.dispatchEvent(new Event('visibilitychange'));
			const video = document.querySelector('.sparkle-raw-surface video') as HTMLVideoElement;
			video.pause(); // Safari may suspend its native media clock without a room pause.
			return video.currentTime;
		});
		await page.evaluate(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, value: false });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15000 })
			.toBeGreaterThan(stopped + 1);
		await page.locator('[data-media-player]').press('k');
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused');
	});
}

test('same-room Plex media switch escapes an unfinished seek', async ({ page, request }) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
	const room = `stuck-seek-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
	await page.evaluate(() => {
		const provider = (window as any).trackTestProvider;
		(window as any).retiredProvider = provider;
		provider.engine.seek = () => new Promise(() => {});
		provider.setCurrentTime(20);
	});
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-seeking');
	await request.put(`/be/rooms/${room}`, { data: { mediaId: rawNextId } });
	await expect(page).toHaveURL(new RegExp(`/media/${rawNextId}$`), { timeout: 20000 });
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
		timeout: 15000
	});
	await page.locator('[data-media-player]').press('k');
	await expect
		.poll(
			() =>
				page.locator('.sparkle-raw-surface video').evaluate((v: HTMLVideoElement) => v.currentTime),
			{ timeout: 15000 }
		)
		.toBeGreaterThan(1);
	await expect
		.poll(() => page.evaluate(() => !!(window as any).retiredProvider.engine))
		.toBe(false);
});

test('AI HDR and normalization reset per title and ignore legacy saved preferences', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => {
		localStorage.setItem('sparkle.raw.hdr', 'hevc');
		localStorage.setItem('sparkle.raw.aiHDR', 'true');
		localStorage.setItem('sparkle.audio.normalize', 'true');
	});
	await page.route('**/encoding/capabilities', (route) =>
		route.fulfill({ json: { codecs: ['hevc'], aiHDREnabled: true, aiHDRCodecs: ['hevc'] } })
	);
	const room = `temporary-toggles-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	const player = page.locator('[data-media-player]');
	const hdr = page.getByRole('button', { name: 'AI HDR', exact: true });
	const normalize = page.getByRole('button', { name: 'Normalize audio', exact: true });
	const assertOff = async () => {
		await expect(player).toHaveAttribute('data-raw-ready', 'true');
		await player.hover();
		await expect(hdr).toHaveAttribute('aria-pressed', 'false');
		await expect(normalize).toHaveAttribute('aria-pressed', 'false');
	};
	const enable = async () => {
		await player.hover();
		await hdr.click();
		await expect(player).toHaveAttribute('data-raw-ready', 'true');
		await normalize.click();
		await expect(hdr).toHaveAttribute('aria-pressed', 'true');
		await expect(normalize).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => (await status(page)).changing).toBe(false);
		await expect.poll(async () => (await status(page)).audioTracks.length).toBeGreaterThan(0);
	};
	await assertOff();
	await enable();
	await page.evaluate(async () => {
		const provider = (window as any).trackTestProvider;
		await provider.selectTrack('audio', provider.status.audioTracks[0].id);
		await provider.recoverPlayback();
	});
	await player.hover();
	await expect(hdr).toHaveAttribute('aria-pressed', 'true');
	await expect(normalize).toHaveAttribute('aria-pressed', 'true');
	await expect(player).toHaveAttribute('data-normalization-state', 'active');
	await request.put(`/be/rooms/${room}`, { data: { mediaId: rawNextId } });
	// A presence snapshot can still be pending, selecting the five-second room
	// countdown instead of the solo-room shortcut. Allow the countdown to finish.
	await expect(page).toHaveURL(new RegExp(`/media/${rawNextId}$`), { timeout: 20000 });
	await assertOff();
	await enable();
	await page.reload();
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await assertOff();
	await enable();
	await request.put(`/be/rooms/${room}`, { data: { mediaId: encodedId } });
	await expect(page).toHaveURL(new RegExp(`/media/${encodedId}$`), { timeout: 20000 });
	await expect(normalize).toHaveAttribute('aria-pressed', 'false');
	await expect(hdr).toHaveCount(0);
	await player.hover();
	await normalize.click();
	await expect(normalize).toHaveAttribute('aria-pressed', 'true');
	await request.put(`/be/rooms/${room}`, { data: { mediaId: rawId } });
	await expect(page).toHaveURL(new RegExp(`/media/${rawId}$`), { timeout: 20000 });
	await assertOff();
});

test('unavailable AI HDR reports failure and disabling it restores playback controls', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
	await page.route('**/encoding/capabilities', (route) =>
		route.fulfill({ json: { codecs: ['hevc'], aiHDREnabled: true, aiHDRCodecs: ['hevc'] } })
	);
	await page.route('**/encoded/hevc/manifest?aiHDR=1', (route) => route.fulfill({ status: 422 }));
	const sent: any[] = [];
	page.on('websocket', (socket) => {
		if (!socket.url().includes('/sync/') || socket.url().includes('/media_')) return;
		socket.on('framesent', ({ payload }) => sent.push(JSON.parse(String(payload))));
	});
	const room = `ai-hdr-rejected-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
	const player = page.locator('[data-media-player]');
	// Default track publication occurs during silent decoder priming. Wait for
	// actual playback before using the play/pause keyboard toggle.
	await expect(player).not.toHaveAttribute('data-paused');
	await expect
		.poll(() => page.evaluate(() => (window as any).trackTestProvider.canPublishPlayback))
		.toBe(true);
	await player.press('k');
	await expect(player).toHaveAttribute('data-paused');
	await seekRaw(page, 12);
	await expect
		.poll(() => sent.some((message) => message.type === 'time' && message.time === 12))
		.toBe(true);
	await player.hover();
	await page.getByRole('button', { name: 'AI HDR', exact: true }).click();
	await expect(page.getByText('Playback interrupted', { exact: true })).toBeVisible();
	await expect(page.getByText(/AI HDR is unavailable for this media/)).toBeVisible();
	await page.getByRole('button', { name: 'AI HDR', exact: true }).click();
	await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 30000 });
	await expect
		.poll(() => page.evaluate(() => (window as any).trackTestProvider.canPublishPlayback))
		.toBe(true);
	await expect(player).toHaveAttribute('data-paused');
	await expect
		.poll(() => page.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
		.toBe(12);
	await seekRaw(page, 18);
	await player.press('k');
	await expect(player).not.toHaveAttribute('data-paused');
});

test('online recovery restores two-client pause and seek after a decoder network failure', async ({
	browser,
	request,
	baseURL
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	const context = await browser.newContext({ ...devices['iPhone 13'] });
	const mobile = await context.newPage(),
		peer = await browser.newPage();
	const room = `online-controls-${Date.now()}`;
	const messages: unknown[] = [];
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	try {
		for (const page of [mobile, peer]) {
			page.on('websocket', (socket) => {
				if (!socket.url().includes(`/sync/${room}/`) || socket.url().includes('/media_')) return;
				for (const event of ['framesent', 'framereceived'] as const)
					socket.on(event, ({ payload }) => {
						const message = JSON.parse(String(payload));
						if (['time', 'pause', 'playback', 'new player', 'state'].includes(message.type))
							messages.push({ page: page === mobile ? 'mobile' : 'peer', event, message });
					});
			});
			await fixture(page);
			await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
			await page.goto(`${baseURL}/${room}/media/${rawId}`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
		}
		await context.setOffline(true);
		await mobile.evaluate(() => {
			const p = (window as any).trackTestProvider;
			// Simulate the libmedia error delivered while Safari's connection is offline.
			p.fail(new Error('Playback decoding failed.'));
		});
		await expect(mobile.locator('[data-media-player]')).toHaveAttribute('data-raw-blocked', 'true');
		await context.setOffline(false);
		await expect(mobile.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
			timeout: 30000
		});
		await expect
			.poll(() => mobile.evaluate(() => (window as any).trackTestProvider.canPublishPlayback))
			.toBe(true);
		await mobile.locator('[data-media-player]').press('k');
		await expect(mobile.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await seekRaw(mobile, 18);
		await expect
			.poll(() => peer.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
			.toBe(18);
		await mobile.locator('[data-media-player]').press('k');
		await expect(peer.locator('[data-media-player]')).not.toHaveAttribute('data-paused');
	} finally {
		const states = await Promise.all(
			[mobile, peer].map((page) =>
				page.evaluate(() => {
					const p = (window as any).trackTestProvider;
					return {
						status: p?.status,
						timeline: p?.timeline,
						canPublish: p?.canPublishPlayback,
						remoteOperations: p?.remoteOperations,
						pendingSeek: p?.pendingSeek,
						starting: p?.starting,
						buffering: p?.buffering,
						initialized: p?.initialized,
						paused: p?.ctx.player.state.paused,
						canPlay: p?.ctx.player.state.canPlay
					};
				})
			)
		);
		const path = test.info().outputPath('recovery-controls-diagnostics.json');
		writeFileSync(path, JSON.stringify({ messages, states }, null, 2));
		await test
			.info()
			.attach('recovery-controls-diagnostics', { path, contentType: 'application/json' });
		await context.close();
		await peer.close();
	}
});

test('encoded playback recovers a stuck seek and restores working controls', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
	const room = `seek-recovery-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
	const player = page.locator('[data-media-player]');
	await expect(player).not.toHaveAttribute('data-paused');
	await expect
		.poll(() => page.evaluate(() => (window as any).trackTestProvider.canPublishPlayback))
		.toBe(true);
	await player.press('k');
	await expect(player).toHaveAttribute('data-paused');
	await page.evaluate(() => {
		const p = (window as any).trackTestProvider;
		(window as any).stuckEngine = p.engine;
		p.engine.seek = () => new Promise(() => {});
		p.setCurrentTime(20);
	});
	await expect(player).toHaveAttribute('data-seeking');
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const p = (window as any).trackTestProvider;
					return p.engine !== (window as any).stuckEngine && p.canPublishPlayback;
				}),
			{ timeout: 60000 }
		)
		.toBe(true);
	await expect(player).not.toHaveAttribute('data-seeking');
	await expect(player).toHaveAttribute('data-paused');
	await page.evaluate(() => (window as any).trackTestProvider.setCurrentTime(12));
	await expect
		.poll(() => page.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
		.toBe(12);
	await player.press('k');
	await expect(player).not.toHaveAttribute('data-paused');
	await expect
		.poll(() =>
			page.locator('.sparkle-raw-surface video').evaluate((v: HTMLVideoElement) => v.currentTime)
		)
		.toBeGreaterThan(13);
});

test('returning mobile viewer replaces a half-open room connection and adopts peer controls', async ({
	browser,
	request,
	baseURL
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	const room = `socket-recovery-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	const mobile = await browser.newContext({ ...devices['Pixel 7'] });
	const page = await mobile.newPage();
	const peer = await browser.newPage();
	let drop = false;
	let connections = 0;
	try {
		for (const client of [page, peer]) {
			await fixture(client);
			await client.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
		}
		await page.routeWebSocket(`**/sync/${room}/*`, (socket) => {
			const server = socket.connectToServer();
			if (socket.url().split('/').at(-1)!.startsWith('media_')) return;
			const number = ++connections;
			server.onMessage((message) => {
				if (!drop || number > 1) socket.send(message);
			});
			socket.onMessage((message) => {
				if (!drop || number > 1) server.send(message);
			});
		});
		for (const client of [page, peer]) {
			await client.goto(`${baseURL}/${room}/media/${rawId}`);
			await client.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect.poll(() => audioTitle(client), { timeout: 30000 }).toBe('Japanese');
		}
		drop = true; // Socket still reports OPEN, but the suspended connection carries no data.
		await page.evaluate(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, value: true });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await peer.locator('[data-media-player]').press('k');
		await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await peer.evaluate(() => (window as any).trackTestProvider.setCurrentTime(18));
		await expect
			.poll(() => peer.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
			.toBe(18);
		await page.evaluate(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, value: false });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await expect.poll(() => connections, { timeout: 20000 }).toBeGreaterThan(1);
		await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await expect
			.poll(() => page.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
			.toBe(18);
		await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await page.locator('[data-media-player]').press('k');
		await expect(peer.locator('[data-media-player]')).not.toHaveAttribute('data-paused');
	} finally {
		await mobile.close();
		await peer.close();
	}
});

test('encoded failure offers retry without falling back to original playback', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
	let failing = true;
	await page.route('**/encoded/hevc/manifest', (route) =>
		failing ? route.fulfill({ status: 503 }) : route.fallback()
	);
	const originals: string[] = [];
	page.on('request', (request) => {
		if (/\/parts\/[^/]+\/file$/.test(request.url())) originals.push(request.url());
	});
	const room = `retry-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Retry playback', exact: true })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => !!(window as any).trackTestProvider.recovering))
		.toBe(false);
	failing = false;
	await page.getByRole('button', { name: 'Retry playback', exact: true }).click();
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
		timeout: 30000
	});
	await expect.poll(() => audioTitle(page)).toBe('Japanese');
	await expect(page.getByRole('button', { name: 'Retry playback', exact: true })).toHaveCount(0);
	expect(originals).toEqual([]);
});

test('foreground recovery preserves room progress after a background native clock reset', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
	const sent: any[] = [];
	page.on('websocket', (socket) =>
		socket.on('framesent', ({ payload }) => {
			try {
				sent.push(JSON.parse(String(payload)));
			} catch {}
		})
	);
	const room = `background-clock-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
	await page.locator('[data-media-player]').press('k');
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused');
	await seekRaw(page, 18);
	await expect
		.poll(() => sent.some((message) => message.type === 'time' && message.time === 18))
		.toBe(true);
	const hiddenStart = sent.length;
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: true });
		document.dispatchEvent(new Event('visibilitychange'));
		// A discarded native media clock must not become the room's next snapshot.
		(document.querySelector('.sparkle-raw-surface video') as HTMLVideoElement).currentTime = 0;
	});
	await page.waitForTimeout(2200); // Allow background provider and room reporting timers to run.
	expect(
		sent.slice(hiddenStart).filter((message) => ['time', 'pause'].includes(message.type))
	).toEqual([]);
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: false });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect
		.poll(() => page.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
		.toBe(18);
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused');
});

test('delayed Plex viewer restores the paused room position before first play', async ({
	browser,
	request,
	baseURL
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	const pages = [await browser.newPage(), await browser.newPage()];
	const room = `paused-join-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	try {
		for (const page of pages) {
			await fixture(page);
			await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
		}
		const [first, peer] = pages;
		await first.goto(`${baseURL}/${room}/media/${rawId}`);
		await first.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => audioTitle(first), { timeout: 30000 }).toBe('Japanese');
		// The default track is published during silent priming, before autoplay.
		await expect(first.locator('[data-media-player]')).not.toHaveAttribute('data-paused');
		await expect
			.poll(() => first.evaluate(() => (window as any).trackTestProvider.canPublishPlayback))
			.toBe(true);
		await first.locator('[data-media-player]').press('k');
		await expect(first.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await seekRaw(first, 18);
		await first.waitForTimeout(1500);
		await peer.route('**/encoded/hevc/manifest', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1200));
			await route.fallback();
		});
		await peer.goto(`${baseURL}/${room}/media/${rawId}`);
		await peer.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
			timeout: 30000
		});
		await expect
			.poll(() => peer.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
			.toBe(18);
		await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused');
		await peer.locator('[data-media-player]').press('k');
		await expect
			.poll(() => peer.evaluate(() => (window as any).trackTestProvider.timeline))
			.toBeGreaterThan(18);
		await expect(first.locator('[data-media-player]')).not.toHaveAttribute('data-paused');
	} finally {
		await Promise.all(pages.map((page) => page.close()));
	}
});

for (const paused of [true, false]) {
	test(`same-room media replacement starts with its own duration and progress (old paused=${paused})`, async ({
		page,
		request
	}) => {
		test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
		await fixture(page, 24);
		await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
		const room = `fresh-media-${paused}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		await page.goto(`/${room}/media/${rawId}`);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
		if (paused) {
			await page.locator('[data-media-player]').press('k');
			await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused');
		}
		await seekRaw(page, 30);
		await page.waitForTimeout(1200);
		await request.put(`/be/rooms/${room}`, { data: { mediaId: rawNextId } });
		await expect(page).toHaveURL(new RegExp(`/media/${rawNextId}$`), { timeout: 20000 });
		const player = page.locator('[data-media-player]');
		await expect(player).toHaveAttribute('data-raw-ready', 'true', { timeout: 30000 });
		await expect
			.poll(() => page.evaluate(() => (window as any).trackTestProvider.duration))
			.toBe(24);
		await page.waitForTimeout(1200); // Let the replacement connection finish its join snapshot.
		await expect(player).toHaveAttribute('data-paused');
		await expect
			.poll(() => page.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
			.toBe(0);
		await player.press('k');
		await expect
			.poll(() => page.evaluate(() => (window as any).trackTestProvider.timeline))
			.toBeGreaterThan(1);
		await expect
			.poll(() => page.evaluate(() => (window as any).trackTestProvider.timeline))
			.toBeLessThan(10);
		await expect
			.poll(() => page.evaluate(() => (window as any).trackTestProvider.ctx.player.state.duration))
			.toBe(24);
	});
}

test('latest room seek wins while an earlier decoder seek is unfinished', async ({
	page,
	request
}) => {
	test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
	await fixture(page);
	await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
	const room = `seek-order-${Date.now()}`;
	await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
	await page.goto(`/${room}/media/${rawId}`);
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
	await page.locator('[data-media-player]').press('k');
	await seekRaw(page, 0);
	await page.evaluate(async () => {
		const p = (window as any).trackTestProvider;
		const seek = p.engine.seek.bind(p.engine);
		let release!: () => void, entered!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		p.engine.seek = async (time: bigint) => {
			if (time === 18000n) {
				entered();
				await blocked;
			}
			return seek(time);
		};
		const old = p.applyRoomState({ time: 18, paused: true });
		await started;
		const latest = p.applyRoomState({ time: 0, paused: true });
		release();
		await Promise.all([old, latest]);
	});
	await expect
		.poll(() => page.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
		.toBe(0);
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused');
});

for (const device of ['iPhone 13', 'Pixel 7']) {
	test(`returning ${device} adopts a replacement media timeline after delayed loading`, async ({
		browser,
		request,
		baseURL
	}) => {
		test.skip(!existsSync(`${root}/hevc/master.m3u8`), 'Prepare multilingual/NVENC fixtures');
		const context = await browser.newContext({ ...devices[device] });
		const mobile = await context.newPage(),
			peer = await browser.newPage();
		const room = `resume-replacement-${device.replace(/ /g, '-')}-${Date.now()}`;
		await request.post('/be/rooms', { data: { roomId: room, mediaId: rawId } });
		let suspended = false;
		const diagnostics: Record<string, unknown> = { messages: [] };
		try {
			for (const page of [mobile, peer]) {
				page.on('websocket', (socket) => {
					if (!socket.url().includes(`/sync/${room}/`) || socket.url().includes('/media_')) return;
					for (const event of ['framesent', 'framereceived'] as const)
						socket.on(event, ({ payload }) => {
							const message = JSON.parse(String(payload));
							if (['time', 'pause', 'new player', 'playback', 'state'].includes(message.type))
								(diagnostics.messages as unknown[]).push({
									page: page === mobile ? 'mobile' : 'peer',
									event,
									message
								});
						});
				});
				await fixture(page, 24);
				await page.addInitScript(() => localStorage.setItem('sparkle.raw.hdr', 'hevc'));
			}
			await mobile.routeWebSocket(`**/sync/${room}/*`, (socket) => {
				const server = socket.connectToServer();
				server.onMessage((message) => {
					if (!suspended) socket.send(message);
				});
			});
			for (const page of [mobile, peer]) {
				await page.goto(`${baseURL}/${room}/media/${rawId}`);
				await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
				await expect.poll(() => audioTitle(page), { timeout: 30000 }).toBe('Japanese');
			}
			await peer.locator('[data-media-player]').press('k');
			await seekRaw(peer, 30);
			await expect
				.poll(() => mobile.evaluate(() => Math.round((window as any).trackTestProvider.timeline)))
				.toBe(30);
			suspended = true;
			await mobile.evaluate(() => {
				Object.defineProperty(document, 'hidden', { configurable: true, value: true });
				document.dispatchEvent(new Event('visibilitychange'));
				(document.querySelector('.sparkle-raw-surface video') as HTMLVideoElement).currentTime = 0;
			});
			await request.put(`/be/rooms/${room}`, { data: { mediaId: rawNextId } });
			await expect(peer).toHaveURL(new RegExp(`/media/${rawNextId}$`), { timeout: 20000 });
			await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-raw-ready', 'true', {
				timeout: 30000
			});
			await peer.locator('[data-media-player]').press('k');
			await expect.poll(() => audioTitle(peer)).toBe('Japanese');
			await peer.locator('[data-media-player]').press('k');
			await expect(peer.locator('[data-media-player]')).toHaveAttribute('data-paused');
			await seekRaw(peer, 12);
			await peer.waitForTimeout(1500);
			await mobile.route('**/encoded/hevc/manifest', async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 1200));
				await route.fallback();
			});
			suspended = false;
			await mobile.evaluate(() => {
				Object.defineProperty(document, 'hidden', { configurable: true, value: false });
				document.dispatchEvent(new Event('visibilitychange'));
			});
			await expect(mobile).toHaveURL(new RegExp(`/media/${rawNextId}$`), { timeout: 20000 });
			await expect
				.poll(
					() => mobile.evaluate(() => Math.round((window as any).trackTestProvider?.timeline)),
					{ timeout: 30000 }
				)
				.toBe(12);
			await expect
				.poll(() =>
					mobile.evaluate(() => (window as any).trackTestProvider.ctx.player.state.duration)
				)
				.toBe(24);
			await expect(mobile.locator('[data-media-player]')).toHaveAttribute('data-paused');
			await mobile.locator('[data-media-player]').press('k');
			await expect(peer.locator('[data-media-player]')).not.toHaveAttribute('data-paused');
			await peer.locator('[data-media-player]').press('k');
			await expect(mobile.locator('[data-media-player]')).toHaveAttribute('data-paused');
		} finally {
			for (const page of [mobile, peer])
				diagnostics[page === mobile ? 'mobile' : 'peer'] = await page
					.evaluate(() => {
						const p = (window as any).trackTestProvider;
						return (
							p && {
								media: p.mediaId,
								time: p.timeline,
								desired: p.desiredTime,
								initialized: p.initialized,
								paused: p.paused,
								status: p.status,
								pending: p.pendingSeek,
								remote: p.remoteOperations
							}
						);
					})
					.catch(() => null);
			writeFileSync(
				test.info().outputPath('room-playback.json'),
				JSON.stringify(diagnostics, null, 2)
			);
			await context.close();
			await peer.close();
		}
	});
}
