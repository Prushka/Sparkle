import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import sharp from 'sharp';
import { pgsPacket } from './fixtures/pgs';
import { existsSync, readFileSync } from 'node:fs';

let bundle: string;
test.beforeAll(async () => {
	const result = await build({
		stdin: {
			contents:
				"export { RawSubtitles } from './lib/player/raw-subtitles'; export { EncodedSubtitles } from './lib/player/encoded-subtitles'; export { EMPTY_ASS_TRACK } from './lib/player/subtitle-rendering';",
			resolveDir: process.cwd()
		},
		bundle: true,
		write: false,
		format: 'iife',
		globalName: 'SubtitleFixture',
		platform: 'browser'
	});
	bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 960, height: 540 });
	await page.route('**/subtitle-rendering-fixture', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<style>body{margin:0;background:#111}#stage{position:relative;width:960px;height:540px}</style><div id="stage"></div>'
		})
	);
	await page.goto('/subtitle-rendering-fixture');
	await page.addScriptTag({ content: bundle });
});

test('Encoded PGS keeps every current cue when extraction repeats a long seek preroll', async ({
	page
}) => {
	await page.route('**/subtitles-*.json*', (route) => {
		const segment = Number(/subtitles-(\d+)/.exec(route.request().url())![1]);
		return route.fulfill({
			json: {
				tracks: [{ id: 0, codec: 0x17006, header: null }],
				packets: Array.from({ length: (segment + 1) * 12 }, (_, cue) => ({
					key: `pgs-${cue}`,
					id: 0,
					pts: cue * 1000,
					duration: 0,
					data: pgsPacket(cue)
				}))
			}
		});
	});
	await page.evaluate(() => {
		const captions = new (window as any).SubtitleFixture.EncodedSubtitles(
			document.getElementById('stage'),
			{
				base: '/pgs-fixture',
				fingerprint: 'test',
				duration: 600,
				segmentSeconds: 12,
				subtitleTracks: [{ id: 0 }],
				hasFonts: false
			}
		);
		(window as any).subtitleFixture = { captions };
		captions.update(300000);
		captions.select([0]);
	});
	for (const cue of [300, 301, 312, 324, 336, 280, 281, 420]) {
		await page.evaluate((cue) => (window as any).subtitleFixture.captions.update(cue * 1000), cue);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const captions = (window as any).subtitleFixture.captions;
					return captions.pending.size;
				})
			)
			.toBe(0);
		const pixels = await page.evaluate(() => {
			const canvas = (window as any).subtitleFixture.captions.renderers[0].canvas;
			return [...canvas.getContext('2d').getImageData(0, 0, 32, 1).data].filter(
				(_, i) => i % 4 === 3
			);
		});
		expect(pixels, `cue at ${cue} seconds`).toEqual(
			Array.from({ length: 32 }, (_, x) => (x === cue % 32 ? 255 : 0))
		);
	}
	await page.evaluate(() => (window as any).subtitleFixture.captions.destroy());
});

test('Compatible PGS retains prefetched and active images on resume, but clears a seek or track reset', async ({
	page
}) => {
	await page.evaluate(
		(packets) => {
			const root = new (window as any).SubtitleFixture.RawSubtitles(
				document.getElementById('stage')
			);
			(window as any).subtitleFixture = { root };
			root.sink.reset(0x17006, new Uint8Array());
			packets.forEach((data, i) =>
				root.sink.packet(
					Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
					i * 1000,
					0
				)
			);
			root.sink.time(1000);
			root.sink.clear();
			root.time(2000); // Provider ticks must not unhide a stopped subtitle sink.
		},
		[pgsPacket(0), pgsPacket(1), pgsPacket(2), pgsPacket(3)]
	);
	const image = () =>
		page.evaluate(() => {
			const c = (window as any).subtitleFixture.root.canvas;
			return {
				hidden: c.style.visibility === 'hidden',
				ink:
					[...c.getContext('2d').getImageData(0, 0, 32, 1).data].findIndex(
						(a, i) => i % 4 === 3 && a !== 0
					) >> 2
			};
		});
	expect(await image()).toEqual({ hidden: true, ink: 1 });
	await page.evaluate(() => (window as any).subtitleFixture.root.sink.time(1500));
	expect(await image()).toEqual({ hidden: false, ink: 1 });
	await page.evaluate(() => (window as any).subtitleFixture.root.sink.time(2500));
	expect(await image()).toEqual({ hidden: false, ink: 2 });
	await page.evaluate(() => {
		const root = (window as any).subtitleFixture.root;
		root.clear();
		root.sink.clear();
		root.sink.time(500);
	});
	expect(await image()).toEqual({ hidden: false, ink: -1 });
	await page.evaluate((packet) => {
		const root = (window as any).subtitleFixture.root;
		root.sink.packet(
			Uint8Array.from(atob(packet), (c) => c.charCodeAt(0)),
			0,
			0
		);
		root.sink.time(500);
		root.sink.reset(0x17011, new Uint8Array());
		root.sink.packet(new TextEncoder().encode('Replacement text'), 0, 1000);
		root.sink.time(500);
	}, pgsPacket(0));
	expect(await image()).toEqual({ hidden: false, ink: -1 });
	await expect(page.locator('[data-raw-subtitle-composition="text"]')).toHaveText(
		'Replacement text'
	);
	await page.evaluate(() => (window as any).subtitleFixture.root.destroy());
});

test('Compatible demuxes embedded PGS through pause, resume and indexed seeks', async ({
	page
}) => {
	const path = 'cache/track-selection/pixels.mkv';
	test.skip(!existsSync(path), 'Run node scripts/tests/prepare-pgs-fixture.mjs');
	const file = readFileSync(path);
	await page.route('**/pgs-original.mkv', (route) => {
		const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
		const start = Number(range?.[1] || 0),
			end = Math.min(Number(range?.[2] || file.length - 1), file.length - 1);
		return route.fulfill({
			status: range ? 206 : 200,
			contentType: 'video/x-matroska',
			headers: {
				'Accept-Ranges': 'bytes',
				...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {})
			},
			body: file.subarray(start, end + 1)
		});
	});
	await page.evaluate(async () => {
		const { default: AVPlayer } = await import(
			/* webpackIgnore: true */ '/vendor/libmedia/1.3.1/avplayer.js'
		);
		const container = document.getElementById('stage');
		const root = new (window as any).SubtitleFixture.RawSubtitles(container);
		const player = new AVPlayer({
			container,
			wasmBaseUrl: '/vendor/libmedia/1.3.1',
			enableWorker: true,
			enableWebGPU: false,
			subtitleSink: root.sink,
			preLoadTime: 4
		});
		await player.load(new URL('/pgs-original.mkv', location.href).href, {
			ext: 'mkv',
			maxProbeDuration: 3,
			ioLoaderOptions: { preload: 4194304 }
		});
		(window as any).subtitleFixture = { root, player };
		await player.selectSubtitle(
			player.getStreams().find((s: any) => s.codecparProxy.codecId === 0x17006).id
		);
		await player.play();
	});
	const state = () =>
		page.evaluate(() => {
			const { root, player } = (window as any).subtitleFixture;
			return {
				time: Number(player.currentTime),
				ink:
					[...root.canvas.getContext('2d').getImageData(0, 0, 32, 1).data].findIndex(
						(a, i) => i % 4 === 3 && a !== 0
					) >> 2
			};
		});
	await expect.poll(async () => (await state()).time).toBeGreaterThan(1100);
	await page.evaluate(() => (window as any).subtitleFixture.player.pause());
	const paused = await state();
	expect(paused.ink).toBe(Math.floor(paused.time / 1000) % 32);
	await page.evaluate(() => (window as any).subtitleFixture.player.play());
	await expect.poll(async () => (await state()).ink).toBe((paused.ink + 1) % 32);
	for (const time of [12000, 3000]) {
		await page.evaluate(async (time) => {
			const { root, player } = (window as any).subtitleFixture;
			await player.pause();
			root.clear();
			await player.seek(BigInt(time));
		}, time);
		await expect.poll(async () => (await state()).ink).toBe((time / 1000) % 32);
	}
	await page.evaluate(async () => {
		const { root, player } = (window as any).subtitleFixture;
		await player.destroy();
		root.destroy();
	});
});

// Optional bounded, privately extracted packets; no source media or credentials
// belong in this fixture. Each entry supplies {path, start, end, tracks}.
for (const fixture of JSON.parse(process.env.SPARKLE_SUBTITLE_PACKET_FIXTURES || '[]')) {
	test(`real subtitle packets ${fixture.path}`, async ({ page }) => {
		const source = JSON.parse(readFileSync(fixture.path, 'utf8'));
		const codecs: Record<string, number> = {
			ass: 0x17016,
			ssa: 0x17004,
			hdmv_pgs_subtitle: 0x17006,
			subrip: 0x17011,
			webvtt: 0x17012,
			mov_text: 0x17005
		};
		const tracks = source.tracks
			.filter((t: any) => fixture.tracks.includes(t.id))
			.map((t: any) => ({ ...t, codec: codecs[t.codec] }));
		const packets = source.packets.filter((p: any) => fixture.tracks.includes(p.id));
		await page.route('**/subtitles-*.json*', (route) => {
			const n = Number(/subtitles-(\d+)/.exec(route.request().url())![1]);
			return route.fulfill({
				json: { tracks, packets: packets.filter((p: any) => p.pts < (n + 1) * 12000) }
			});
		});
		await page.evaluate(
			({ tracks, packets, start, end }) => {
				const api = (window as any).SubtitleFixture;
				const root = document.getElementById('stage')!;
				const captions = new api.EncodedSubtitles(root, {
					base: '/real-fixture',
					fingerprint: 'test',
					duration: end + 24,
					segmentSeconds: 12,
					subtitleTracks: tracks,
					hasFonts: false
				});
				const references = tracks.map((track: any) => {
					const renderer = new api.RawSubtitles(root);
					renderer.sink.reset(
						track.codec,
						track.header
							? Uint8Array.from(atob(track.header), (c) => c.charCodeAt(0))
							: new Uint8Array()
					);
					return {
						renderer,
						id: track.id,
						next: 0,
						packets: packets
							.filter((p: any) => p.id === track.id)
							.sort((a: any, b: any) => a.pts - b.pts)
					};
				});
				(window as any).subtitleFixture = { captions, references };
				captions.update(start * 1000);
				captions.select(tracks.map((t: any) => t.id));
			},
			{ tracks, packets, start: fixture.start, end: fixture.end }
		);
		const visible = new Map<number, number>();
		for (let seconds = fixture.start; seconds < fixture.end; seconds += 1) {
			await page.evaluate(
				(seconds) => (window as any).subtitleFixture.captions.update(seconds * 1000),
				seconds
			);
			await expect
				.poll(() => page.evaluate(() => (window as any).subtitleFixture.captions.pending.size))
				.toBe(0);
			const results = await page.evaluate((seconds) => {
				const { captions, references } = (window as any).subtitleFixture;
				const snapshot = (r: any) => {
					if (r.layer.format === 'text') return r.layer.text;
					if (r.layer.format === 'ass')
						return r.layer.content
							.split('\n')
							.filter((line: string) => line.startsWith('Dialogue:'))
							.sort()
							.join('\n');
					const sample = document.createElement('canvas');
					sample.width = 192;
					sample.height = 108;
					const ctx = sample.getContext('2d')!;
					ctx.drawImage(r.canvas, 0, 0, 192, 108);
					const pixels = ctx.getImageData(0, 0, 192, 108).data;
					return [...pixels].filter((_, i) => i % 4 === 3).join(',');
				};
				return references.map((ref: any, i: number) => {
					while (
						ref.next < ref.packets.length &&
						ref.packets[ref.next].pts <= seconds * 1000 + 1000
					) {
						const p = ref.packets[ref.next++];
						ref.renderer.sink.packet(
							Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0)),
							p.pts,
							p.duration
						);
						ref.renderer.sink.time(seconds * 1000);
					}
					ref.renderer.sink.time(seconds * 1000);
					const expected = snapshot(ref.renderer),
						actual = snapshot(captions.renderers[i]);
					return {
						id: ref.id,
						match: expected === actual,
						visible: ref.renderer.layer.format === 'bitmap' ? /[1-9]/.test(actual) : !!actual
					};
				});
			}, seconds);
			for (const result of results)
				expect(result.match, `track ${result.id} at ${seconds}s`).toBe(true);
			for (const result of results)
				if (result.visible) visible.set(result.id, (visible.get(result.id) || 0) + 1);
		}
		for (const track of tracks)
			expect(visible.get(track.id), `track ${track.id} rendered`).toBeGreaterThan(0);
		await page.screenshot({ path: test.info().outputPath('real-subtitles.png') });
		await page.evaluate(() => {
			const { captions, references } = (window as any).subtitleFixture;
			captions.destroy();
			references.forEach((r: any) => r.renderer.destroy());
		});
	});
}

test('Raw styled subtitles load Chinese glyphs and compose four shrinking, collision-aware layers', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.evaluate(() => {
		const api = (window as any).SubtitleFixture;
		const root = new api.RawSubtitles(document.getElementById('stage'));
		const header = api.EMPTY_ASS_TRACK.replace(
			'ScriptType: v4.00+',
			'ScriptType: v4.00+\nPlayResX: 960\nPlayResY: 540'
		).replace('Arial,20,', 'Microsoft YaHei,48,');
		(window as any).subtitleFixture = { root, header, layers: [] };
		root.setLanguage('zh-CN');
		root.sink.reset(0x17016, new TextEncoder().encode(header));
		root.sink.packet(new TextEncoder().encode('0,0,Default,,0,0,0,,中文測試字幕'), 0, 10000);
		root.time(1000);
	});
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const group = (window as any).subtitleFixture.root.composition;
					return group.renderer && !group.flushing
						? (await group.renderer.renderer.getEvents()).length
						: 0;
				}),
			{ timeout: 20_000 }
		)
		.toBe(1);
	const png = await page.screenshot({ path: test.info().outputPath('chinese-styled.png') });
	const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const columns: number[] = [];
	for (let x = 0; x < info.width; x++) {
		let ink = false;
		for (let y = 380; y < info.height; y++) {
			if (data[(y * info.width + x) * 3] > 160) {
				ink = true;
				break;
			}
		}
		if (ink) columns.push(x);
	}
	// Tofu boxes repeat the same glyph. Real ideographs have distinct ink masks.
	const spans: number[][] = [];
	for (const x of columns) {
		const last = spans.at(-1);
		if (!last || x > last[1] + 1) spans.push([x, x]);
		else last[1] = x;
	}
	expect(spans.length).toBeGreaterThanOrEqual(6);
	const glyphs = spans.map(([left, right]) => {
		let mask = '';
		for (let y = 380; y < info.height; y++)
			for (let x = left; x <= right; x++) mask += data[(y * info.width + x) * 3] > 160 ? '1' : '0';
		return mask;
	});
	expect(new Set(glyphs).size).toBeGreaterThanOrEqual(4);
	await page.evaluate(() => {
		const { root } = (window as any).subtitleFixture;
		root.sink.clear();
		root.time(1500);
	});
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const group = (window as any).subtitleFixture.root.composition;
				return group.flushing ? -1 : (await group.renderer.renderer.getEvents()).length;
			})
		)
		.toBe(0);
	await page.evaluate(() => (window as any).subtitleFixture.root.sink.time(1500));
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const group = (window as any).subtitleFixture.root.composition;
				return group.flushing ? -1 : (await group.renderer.renderer.getEvents()).length;
			})
		)
		.toBe(1);
	await page.evaluate(() => {
		const { root, header, layers } = (window as any).subtitleFixture;
		for (const text of ['English subtitles', '日本語の字幕', '第四字幕']) {
			const layer = root.createLayer();
			layers.push(layer);
			const smallerScript = header
				.replace('PlayResX: 960', 'PlayResX: 320')
				.replace('PlayResY: 540', 'PlayResY: 180')
				.replace('Microsoft YaHei,48,', 'Microsoft YaHei,16,');
			layer.sink.reset(0x17016, new TextEncoder().encode(smallerScript));
			layer.sink.packet(new TextEncoder().encode(`0,0,Default,,0,0,0,,${text}`), 0, 10000);
			layer.time(1000);
		}
	});
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const group = (window as any).subtitleFixture.root.composition;
				if (group.flushing) return [];
				return (await group.renderer.renderer.getStyles())
					.filter((style: any) => style.Name.startsWith('sparkle_'))
					.map((style: any) => style.FontSize);
			})
		)
		.toEqual([33.6, 33.6, 33.6, 33.6]);
	await expect(page.locator('[data-raw-subtitle-composition="ass"]')).toHaveCount(1);
	await page.screenshot({ path: test.info().outputPath('four-styled-layers.png') });
	await page.evaluate(() =>
		(window as any).subtitleFixture.layers.forEach((layer: any) => layer.destroy())
	);
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const group = (window as any).subtitleFixture.root.composition;
				if (group.flushing) return 0;
				const events = await group.renderer.renderer.getEvents();
				const styles = await group.renderer.renderer.getStyles();
				return styles[events[0]?.Style]?.FontSize;
			})
		)
		.toBe(48);
	await page.evaluate(() => (window as any).subtitleFixture.root.destroy());
	await expect(page.locator('canvas')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('Raw text layers share Encoded sizing, line stacking, seek clearing and teardown', async ({
	page
}) => {
	await page.evaluate(() => {
		const root = new (window as any).SubtitleFixture.RawSubtitles(document.getElementById('stage'));
		const layers = [root, ...Array.from({ length: 4 }, () => root.createLayer())];
		(window as any).subtitleFixture = { root, layers };
		layers.forEach((layer: any, index: number) => {
			layer.sink.reset(0x17012, new Uint8Array());
			layer.sink.packet(new TextEncoder().encode(`Subtitle ${index + 1}`), 0, 10000);
			layer.time(1000);
		});
	});
	const text = page.locator('[data-raw-subtitle-composition="text"]');
	await expect(text).toHaveText('Subtitle 1\nSubtitle 2\nSubtitle 3\nSubtitle 4\nSubtitle 5');
	const small = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	await page.evaluate(() => {
		const { root } = (window as any).subtitleFixture;
		const video = document.createElement('video');
		(window as any).subtitleFixture.video = video;
		root.attachVideo(video);
		root.setNativeFullscreen(true);
	});
	await expect
		.poll(() =>
			page.evaluate(() => {
				const track = (window as any).subtitleFixture.video.textTracks[0];
				return { mode: track.mode, cues: [...track.cues].map((cue: VTTCue) => cue.text) };
			})
		)
		.toEqual({
			mode: 'showing',
			cues: ['Subtitle 1\nSubtitle 2\nSubtitle 3\nSubtitle 4\nSubtitle 5']
		});
	await expect(text).toBeHidden();
	await page.evaluate(() => {
		const { root, layers } = (window as any).subtitleFixture;
		root.setNativeFullscreen(false);
		layers.forEach((layer: any) => layer.sink.clear());
		// The provider keeps ticking while captions are off; only the sink may resume them.
		layers.forEach((layer: any) => layer.time(2000));
	});
	await expect(text).toBeEmpty();
	await expect
		.poll(() =>
			page.evaluate(() => (window as any).subtitleFixture.video.textTracks[0].cues.length)
		)
		.toBe(0);
	await page.evaluate(() =>
		(window as any).subtitleFixture.layers.forEach((layer: any) => layer.sink.time(2000))
	);
	await expect(text).toHaveText('Subtitle 1\nSubtitle 2\nSubtitle 3\nSubtitle 4\nSubtitle 5');
	await expect(text).toBeVisible();
	await page.evaluate(() =>
		(window as any).subtitleFixture.layers.splice(1).forEach((layer: any) => layer.destroy())
	);
	await expect(text).toHaveText('Subtitle 1');
	await expect
		.poll(() => text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
		.toBeGreaterThan(small);
	await page.evaluate(() => (window as any).subtitleFixture.root.clear());
	await expect(text).toBeEmpty();
	await page.evaluate(() => (window as any).subtitleFixture.root.destroy());
	await expect(page.locator('#stage')).toBeEmpty();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const track = (window as any).subtitleFixture.video.textTracks[0];
				return { mode: track.mode, cues: track.cues?.length ?? 0 };
			})
		)
		.toEqual({ mode: 'disabled', cues: 0 });
});
