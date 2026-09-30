// Real Chrome/native MSE and provider lifecycle, using opt-in synthetic Go fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

assert.ok(process.env.SPARKLE_AI_HDR_FIXTURE_DIR, 'Generate TestAIHDRGPU fixtures first');
const root = resolve(process.env.SPARKLE_AI_HDR_FIXTURE_DIR);
const { duration: fixtureDuration, segmentSeconds } = JSON.parse(
	await readFile(join(root, 'fixture.json'), 'utf8')
);
assert.equal(segmentSeconds, 12, 'Regenerate the twelve-second Go fixtures');
const durations = Array.from({ length: Math.ceil(fixtureDuration / segmentSeconds) }, (_, n) =>
	Math.min(segmentSeconds, fixtureDuration - n * segmentSeconds)
);
const ui = await build({
	stdin: {
		contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MediaPlayer,MediaProvider} from '@vidstack/react';
import {DefaultVideoLayout,defaultLayoutIcons} from '@vidstack/react/player/layouts/default';
import {RawProviderLoader,RAW_MEDIA_TYPE} from './lib/player/raw-provider';
import {RawAIHDRButton,RawPlaybackObserver} from './components/player/RawControls';
import {AudioNormalizationButton} from './components/player/AudioNormalization';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
localStorage.setItem('sparkle.raw.hdr','compatible');
const controls=()=> <><RawAIHDRButton/><AudioNormalizationButton/></>;
createRoot(document.querySelector('#root')).render(<MediaPlayer ref={p=>window.testPlayer=p} title="AI HDR qualification" src={{src:location.origin+'/media/smpte2084',type:RAW_MEDIA_TYPE}} load="eager" muted playsInline viewType="video" style={{width:'100%',aspectRatio:'16/9'}}><MediaProvider loaders={[RawProviderLoader]}/><RawPlaybackObserver onTracks={(s)=>window.uiStatus=s}/><DefaultVideoLayout icons={defaultLayoutIcons} slots={{largeLayout:{beforeCaptionButton:controls()},smallLayout:{beforeCaptionButton:controls()}}}/></MediaPlayer>);
`,
		resolveDir: process.cwd(),
		loader: 'tsx'
	},
	bundle: true,
	write: false,
	outdir: 'cache/ai-hdr-fixture/ui',
	format: 'esm',
	platform: 'browser',
	jsx: 'automatic',
	define: { 'process.env.NODE_ENV': '"production"' }
});
const bundle = (
	await build({
		entryPoints: ['lib/player/raw-provider.ts'],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		define: { 'process.env.NODE_ENV': '"production"' }
	})
).outputFiles[0].text;
let allowed = true,
	delay = 0,
	capabilitiesUnavailable = false,
	nativeAudio = false;
const requests = [];
const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url, 'http://localhost'),
			path = url.pathname;
		if (path === '/ui')
			return res
				.writeHead(200, { 'Content-Type': 'text/html' })
				.end(
					'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body style="margin:0;background:#111;color:white"><div id="root"></div><script type="module" src="/ui.js"></script></body></html>'
				);
		if (path === '/ui.js' || path === '/ui.css')
			return res
				.writeHead(200, { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' })
				.end(ui.outputFiles.find((f) => f.path.endsWith(extname(path))).text);
		const json = (value) =>
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
		if (path === '/')
			return res
				.writeHead(200, { 'Content-Type': 'text/html' })
				.end(
					'<html><body><div id="player" style="position:relative;width:640px;height:360px"></div></body></html>'
				);
		if (path === '/provider.js')
			return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle);
		if (path === '/encoding/capabilities' && capabilitiesUnavailable)
			return res.writeHead(503).end();
		if (path === '/encoding/capabilities')
			return json({
				codecs: ['av1', 'hevc'],
				aiHDREnabled: allowed,
				aiHDRCodecs: allowed ? ['av1', 'hevc'] : []
			});
		const item = /^\/media\/(bt709|smpte2084|arib-std-b67)(.*)$/.exec(path);
		if (item && !item[2])
			return json({
				Id: item[1],
				Duration: fixtureDuration,
				width: 320,
				height: 180,
				Raw: {
					versions: [],
					parts: [
						{
							id: '1',
							url: `${path}/parts/1/file`,
							duration: fixtureDuration,
							start: 0,
							streams: [
								{
									id: 0,
									index: 0,
									streamType: 1,
									codec: 'hevc',
									bitDepth: item[1] === 'bt709' ? 8 : 10,
									colorTrc: item[1],
									colorPrimaries: item[1] === 'bt709' ? 'bt709' : 'bt2020',
									colorSpace: item[1] === 'bt709' ? 'bt709' : 'bt2020nc'
								},
								{ id: 1, index: 1, streamType: 2, codec: 'pcm_s16le', channels: 1 }
							]
						}
					]
				}
			});
		const encoded = item && /^\/parts\/1\/encoded\/(av1|hevc)\/([\w.-]+)$/.exec(item[2]);
		let file;
		if (encoded) {
			const [, codec, resource] = encoded,
				aiHDR = url.searchParams.get('aiHDR') === '1';
			requests.push({ resource, aiHDR });
			if (aiHDR && !allowed) return res.writeHead(422).end();
			if (delay) await new Promise((r) => setTimeout(r, delay));
			if (resource === 'manifest')
				return json({
					fingerprint: aiHDR ? 'enhanced' : 'ordinary',
					aiHDR,
					aiHDRMode: item[1] === 'bt709' ? 'sdr-expansion' : 'hdr-expansion',
					playlist: 'master.m3u8',
					codec,
					output: 'HDR10',
					duration: fixtureDuration,
					width: 320,
					height: 180,
					audio: true,
					audioChannels: nativeAudio ? 1 : undefined,
					timestampStart: true,
					subtitleTracks: [],
					hasFonts: false,
					segmentSeconds
				});
			const query = `?v=${aiHDR ? 'enhanced' : 'ordinary'}${aiHDR ? '&aiHDR=1' : ''}`;
			const startSegment = Number(url.searchParams.get('startSegment') || 0);
			const initialQuery = query + (startSegment ? `&startSegment=${startSegment}` : '');
			if (resource === 'master.m3u8')
				return res
					.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
					.end(
						`#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8${initialQuery}"\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,AUDIO="audio"\nvideo.m3u8${initialQuery}\n`
					);
			if (resource === 'audio.m3u8' || resource === 'video.m3u8') {
				const kind = resource.split('.')[0];
				return res
					.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
					.end(
						`#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:${segmentSeconds}\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="${kind}-init.mp4${initialQuery}"\n${durations.map((duration, i) => `#EXTINF:${duration},\n${kind}-${i}.m4s${query}\n`).join('')}#EXT-X-ENDLIST\n`
					);
			}
			file = join(root, item[1], codec, resource);
		}
		if (item?.[2] === '/parts/1/file') file = join(root, item[1], 'original.mkv');
		if (/^\/vendor\/libmedia\/[\w./-]+$/.test(path) && !path.includes('..'))
			file = resolve('public', '.' + path);
		if (!file) return res.writeHead(404).end();
		const size = (await stat(file)).size,
			range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
		const start = range ? Number(range[1]) : 0,
			end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
		res.writeHead(range ? 206 : 200, {
			'Content-Type':
				{
					'.js': 'text/javascript',
					'.wasm': 'application/wasm',
					'.mp4': 'video/mp4',
					'.m4s': 'video/mp4',
					'.mkv': 'video/x-matroska'
				}[extname(file)] || 'application/octet-stream',
			'Content-Length': end - start + 1,
			'Accept-Ranges': 'bytes',
			...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
		});
		if (req.method === 'HEAD') res.end();
		else createReadStream(file, { start, end }).pipe(res);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
	channel: 'chrome',
	args: ['--autoplay-policy=no-user-gesture-required']
});
const report = [];
async function client(transfer, mode = 'compatible', saved = false) {
	const page = await browser.newPage();
	const messages = [];
	page.on('console', (message) => {
		messages.push(message.text());
		if (messages.length > 100) messages.shift();
	});
	page.diagnostics = messages;
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page.evaluate(
		async ({ transfer, mode, saved, noRecovery }) => {
			const { RawProvider, RAW_MEDIA_TYPE } = await import('/provider.js');
			localStorage.setItem('sparkle.raw.hdr', mode);
			localStorage.setItem('sparkle.raw.aiHDR', String(saved));
			const el = document.querySelector('#player'),
				media = document.createElement('video');
			el.append(media);
			window.published = [];
			const ctx = {
				player: { el, play: () => window.provider.play(), pause: () => window.provider.pause() },
				$state: { canPictureInPicture: { set() {} }, canFullscreen: { set() {} } },
				delegate: { async ready() {} },
				notify(type) {
					if (window.provider?.canPublishPlayback && ['play', 'pause', 'seeked'].includes(type))
						window.published.push(type);
				}
			};
			window.provider = new RawProvider(media, ctx, {});
			if (noRecovery) provider.recoveryAttempts = 2;
			provider.setup();
			await provider.loadSource({
				src: location.origin + '/media/' + transfer,
				type: RAW_MEDIA_TYPE
			});
			if (!provider.status.ready) throw Error(provider.status.reason);
			await provider.applyRoomState({ time: 3, paused: true });
		},
		{ transfer, mode, saved, noRecovery: capabilitiesUnavailable }
	);
	return page;
}
async function timestampStartup(page, time, paused, recover = false) {
	await page.evaluate(({ time, paused }) => provider.applyRoomState({ time, paused }), {
		time,
		paused
	});
	const fetched = [];
	const record = (request) => {
		const url = new URL(request.url());
		if (url.pathname.includes('/encoded/'))
			fetched.push(url.pathname.split('/').at(-1) + url.search);
	};
	page.on('request', record);
	const state = await page.evaluate(async (recover) => {
		published.length = 0;
		if (recover) await provider.recoverPlayback();
		else await provider.chooseAIHDR(!provider.aiHDR);
		return {
			time: provider.timeline,
			paused: provider.paused,
			ready: provider.status.ready,
			published
		};
	}, recover);
	page.off('request', record);
	assert.ok(
		state.ready && Math.abs(state.time - time) < 0.5,
		JSON.stringify({ state, time, fetched })
	);
	assert.equal(state.paused, paused);
	assert.deepEqual(state.published, []);
	const segment = Math.floor(time / segmentSeconds);
	for (const kind of ['video', 'audio']) {
		assert.ok(
			fetched.some(
				(url) => url.startsWith(`${kind}-init.mp4?`) && url.includes(`startSegment=${segment}`)
			),
			JSON.stringify(fetched)
		);
		assert.ok(
			fetched.some((url) => url.startsWith(`${kind}-${segment}.m4s?`)),
			JSON.stringify(fetched)
		);
	}
	assert.ok(
		!fetched.some(
			(url) =>
				/^(video|audio)-(\d+)\.m4s/.test(url) && Number(url.match(/-(\d+)\.m4s/)[1]) < segment
		),
		JSON.stringify(fetched)
	);
	// The target fragment's PTS must not become a new timeline origin.
	await page.evaluate(() => provider.applyRoomState({ time: 3, paused: true }));
	const backward = await page.evaluate(() => {
		const video = provider.container.querySelector('video');
		return {
			time: provider.timeline,
			video: Number(provider.engine.currentTime),
			audio: Number(provider.audioEngine?.currentTime),
			status: provider.status,
			paused: provider.paused,
			buffered:
				video &&
				Array.from({ length: video.buffered.length }, (_, n) => [
					video.buffered.start(n),
					video.buffered.end(n)
				])
		};
	});
	assert.ok(
		Math.abs(backward.time - 3) < 0.3,
		JSON.stringify({ time, backward, messages: page.diagnostics })
	);
}
try {
	for (const transfer of process.argv.includes('--ui-only') ||
	process.argv.includes('--startup-only')
		? []
		: ['bt709', 'smpte2084', 'arib-std-b67']) {
		const first = await client(transfer),
			second = await client(transfer, 'hevc');
		for (const codec of ['av1', 'hevc']) {
			await first.evaluate(async (codec) => {
				await provider.chooseHDR(codec);
				published.length = 0;
				await provider.chooseAIHDR(true);
			}, codec);
			let state = await first.evaluate(() => ({
				status: provider.status,
				time: provider.timeline,
				paused: provider.paused,
				published
			}));
			assert.ok(state.status.ready && state.status.aiHDR);
			assert.equal(state.status.encodedCodec, codec);
			assert.equal(state.status.renderer, 'native');
			assert.ok(state.paused);
			assert.ok(Math.abs(state.time - 3) < 0.3);
			assert.deepEqual(state.published, []);
			assert.equal(
				await second.evaluate(() => provider.status.aiHDR),
				false,
				'local toggle must not affect peer'
			);
			const transition = await first.evaluate(async () => {
				await provider.applyRoomState({ time: 8, paused: false });
				const load = provider.loadPart.bind(provider);
				const observations = [];
				provider.loadPart = async (...args) => {
					await load(...args);
					const audio = provider.audioEngine ?? provider.engine;
					const volume = audio.setVolume.bind(audio);
					let gain = 1;
					audio.setVolume = (value, force) => {
						gain = value;
						volume(value, force);
					};
					const play = audio.play.bind(audio);
					audio.play = async (...args) => {
						observations.push({ phase: 'play', gain, time: Number(audio.currentTime) });
						return play(...args);
					};
					const seek = audio.seek.bind(audio);
					audio.seek = async (...args) => {
						await new Promise((r) => setTimeout(r, 150));
						const before = Number(provider.engine.currentTime);
						await new Promise((r) => setTimeout(r, 500));
						observations.push({
							phase: 'seek',
							gain,
							advance: Number(provider.engine.currentTime) - before
						});
						return seek(...args);
					};
				};
				published.length = 0;
				provider.setVolume(0.37);
				try {
					await provider.chooseAIHDR(false);
					await provider.chooseAIHDR(true);
					await provider.recoverPlayback();
					return { observations, volume: provider.volume, muted: provider.muted, published };
				} finally {
					provider.loadPart = load;
				}
			});
			assert.ok(transition.observations.some((o) => o.phase === 'play' && o.time < 1000));
			assert.ok(
				transition.observations.every((o) => o.gain === 0),
				JSON.stringify(transition)
			);
			assert.ok(
				transition.observations
					.filter((o) => o.phase === 'seek')
					.every((o) => Math.abs(o.advance) < 100),
				JSON.stringify(transition)
			);
			assert.equal(transition.volume, 0.37);
			assert.equal(transition.muted, false);
			assert.deepEqual(transition.published, []);
			const continuity = await first.evaluate(async () => {
				const samples = [];
				await provider.applyRoomState({ time: 9, paused: false });
				for (let n = 0; n < 35; n++) {
					await new Promise((r) => setTimeout(r, 200));
					samples.push({
						at: performance.now(),
						video: Number(provider.engine.currentTime),
						audio: Number(provider.audioEngine.currentTime),
						rate: provider.audioRate
					});
				}
				return samples;
			});
			const maxDrift = Math.max(...continuity.map((s) => Math.abs(s.audio - s.video)));
			const elapsed = continuity.at(-1).at - continuity[0].at;
			const advanced = continuity.at(-1).video - continuity[0].video;
			assert.ok(maxDrift < 250, JSON.stringify({ maxDrift, continuity }));
			assert.ok(Math.abs(elapsed - advanced) < 300, JSON.stringify({ elapsed, advanced }));
			await Promise.all(
				[first, second].map((p) =>
					p.evaluate((time) => provider.applyRoomState({ time, paused: false }), segmentSeconds + 1)
				)
			);
			await first.waitForFunction((time) => provider.timeline > time, segmentSeconds + 2);
			await Promise.all(
				[first, second].map((p) =>
					p.evaluate((time) => provider.applyRoomState({ time, paused: true }), segmentSeconds + 4)
				)
			);
			for (const p of [first, second])
				assert.ok(
					Math.abs((await p.evaluate(() => provider.timeline)) - (segmentSeconds + 4)) < 0.3,
					JSON.stringify(
						await p.evaluate(() => ({
							time: provider.timeline,
							status: provider.status,
							paused: provider.paused,
							pending: provider.pendingSeek
						}))
					)
				);
			await timestampStartup(first, 12, true);
			await timestampStartup(first, 13, false);
			await timestampStartup(first, 24, true, true);
			await first.evaluate(async () => {
				published.length = 0;
				await provider.chooseAIHDR(false);
				await provider.chooseHDR('compatible');
				await provider.applyRoomState({ time: 3, paused: true });
			});
			report.push({
				transfer,
				codec,
				native: true,
				togglePosition: true,
				local: true,
				twoClientSeekPausePlay: true,
				silentPrimingAndSlowSeek: true,
				timestampStartupWithoutOpeningSegments: true,
				maxDriftMs: maxDrift,
				boundaryStallMs: Math.round(elapsed - advanced)
			});
		}
		delay = 150;
		await first.evaluate(async () => {
			await provider.chooseAIHDR(true);
			await provider.chooseAIHDR(false);
			await provider.chooseAIHDR(true);
			await provider.recoverPlayback();
		});
		delay = 0;
		assert.ok(await first.evaluate(() => provider.status.aiHDR && provider.status.ready));
		await Promise.all([first.close(), second.close()]);
	}
	if (!process.argv.includes('--ui-only')) {
		for (const useNative of process.argv.includes('--startup-only') ? [false, true] : [true]) {
			nativeAudio = useNative;
			for (const codec of ['av1', 'hevc']) {
				const page = await client('smpte2084', codec);
				assert.equal(await page.evaluate(() => !!provider.audioEngine), !useNative);
				await timestampStartup(page, 12, true);
				await timestampStartup(page, 13, false);
				await timestampStartup(page, 24, true, true);
				await page.close();
				report.push({
					codec,
					nativeAudio: useNative,
					timestampStartupWithoutOpeningSegments: true
				});
			}
		}
		nativeAudio = false;
	}
	allowed = false;
	const start = requests.length;
	const disabled = await client('bt709', 'compatible', true);
	assert.equal(await disabled.evaluate(() => provider.status.aiHDRAllowed), false);
	assert.equal(await disabled.evaluate(() => provider.status.aiHDR), false);
	assert.ok(!requests.slice(start).some((r) => r.aiHDR));
	await disabled.close();
	capabilitiesUnavailable = true;
	const legacy = await client('bt709', 'compatible', true);
	assert.equal(await legacy.evaluate(() => provider.status.aiHDR), false);
	await legacy.close();
	capabilitiesUnavailable = false;
	if (!process.argv.includes('--startup-only')) {
		const controls = await browser.newPage();
		await controls.goto(`http://127.0.0.1:${server.address().port}/ui`);
		await controls.waitForFunction(
			() => document.querySelector('[data-media-player]')?.getAttribute('data-raw-ready') === 'true'
		);
		assert.equal(await controls.getByRole('button', { name: 'AI HDR', exact: true }).count(), 0);
		allowed = true;
		await controls.reload();
		const toggle = controls.getByRole('button', { name: 'AI HDR', exact: true });
		await toggle.waitFor();
		for (const width of [1100, 390]) {
			await controls.setViewportSize({ width, height: 800 });
			await controls.evaluate(async () => {
				await window.testPlayer.play();
				await window.testPlayer.pause();
			});
			await controls.locator('[data-media-player]').hover();
			await controls.evaluate(() => window.testPlayer.controls.show());
			await toggle.click();
			await controls.waitForFunction(
				() =>
					document.querySelector('[data-media-player]')?.getAttribute('data-raw-ai-hdr') ===
						'true' &&
					document.querySelector('[data-media-player]')?.getAttribute('data-raw-ready') === 'true'
			);
			await controls.locator('[data-media-player]').hover();
			await controls.evaluate(() => window.testPlayer.controls.show());
			const hdr = await toggle.boundingBox(),
				audio = await controls
					.getByRole('button', { name: 'Normalize audio', exact: true })
					.boundingBox();
			assert.ok(hdr && audio && hdr.x < audio.x && hdr.x >= 0 && audio.x + audio.width <= width);
			await controls.screenshot({ path: join(root, `controls-${width}.png`) });
			await toggle.click();
			await controls.waitForFunction(
				() =>
					document.querySelector('[data-media-player]')?.getAttribute('data-raw-ai-hdr') ===
						'false' &&
					document.querySelector('[data-media-player]')?.getAttribute('data-raw-ready') === 'true'
			);
		}
		await controls.close();
	}
	const result = {
		playback: report,
		controls: process.argv.includes('--startup-only')
			? undefined
			: { widths: [1100, 390], flagOff: true },
		unavailableCapabilities: true
	};
	await writeFile(
		join(
			root,
			process.argv.includes('--startup-only')
				? 'startup-report.json'
				: process.argv.includes('--ui-only')
					? 'ui-report.json'
					: 'browser-report.json'
		),
		JSON.stringify(result, null, 2)
	);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser.close();
	server.close();
	server.closeAllConnections();
}
