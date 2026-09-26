// Runs real browser decoders against disposable synthetic media. No Plex token,
// real library files, server restart or production room is needed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve('cache/audio-normalization');
await mkdir(root, { recursive: true });
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const fixtures = [
	[
		'stereo.mp4',
		['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2']
	],
	[
		'surround.mp4',
		['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '6']
	],
	[
		'hdr-flac.mkv',
		[
			'-c:v',
			'hevc_nvenc',
			'-preset',
			'p3',
			'-pix_fmt',
			'p010le',
			'-color_primaries',
			'bt2020',
			'-color_trc',
			'smpte2084',
			'-colorspace',
			'bt2020nc',
			'-c:a',
			'flac',
			'-ac',
			'6'
		]
	],
	[
		'truehd.mkv',
		[
			'-c:v',
			'libx264',
			'-preset',
			'ultrafast',
			'-pix_fmt',
			'yuv420p',
			'-c:a',
			'truehd',
			'-strict',
			'-2',
			'-ac',
			'6'
		]
	]
];
const hdrVideo = [
	'-c:v',
	'hevc_nvenc',
	'-preset',
	'p3',
	'-pix_fmt',
	'p010le',
	'-color_primaries',
	'bt2020',
	'-color_trc',
	'smpte2084',
	'-colorspace',
	'bt2020nc'
];
fixtures.push(
	['ac3-51.mkv', [...hdrVideo, '-c:a', 'ac3', '-b:a', '640k', '-ac', '6']],
	['eac3-51.mkv', [...hdrVideo, '-c:a', 'eac3', '-b:a', '640k', '-ac', '6']],
	['dts-51.mkv', [...hdrVideo, '-c:a', 'dca', '-strict', '-2', '-b:a', '1536k', '-ac', '6']],
	['flac-71.mkv', [...hdrVideo, '-c:a', 'flac', '-ac', '8']]
);
for (const [file, encoding] of fixtures) {
	if (await stat(join(root, file)).catch(() => null)) continue;
	execFileSync(
		ffmpeg,
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-y',
			'-f',
			'lavfi',
			'-i',
			'testsrc2=s=320x180:r=24',
			'-f',
			'lavfi',
			'-i',
			'aevalsrc=0.035*sin(2*PI*440*t)|0.035*sin(2*PI*550*t)|0.035*sin(2*PI*660*t)|0.015*sin(2*PI*60*t)|0.025*sin(2*PI*770*t)|0.025*sin(2*PI*880*t)' +
				(file.includes('-71')
					? '|0.025*sin(2*PI*990*t)|0.025*sin(2*PI*1100*t):s=48000:c=7.1'
					: ':s=48000:c=5.1'),
			'-t',
			'48',
			...encoding,
			join(root, file)
		],
		{ stdio: 'pipe' }
	);
}
const controller = (
	await build({
		entryPoints: ['lib/player/audio-normalization.ts'],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser'
	})
).outputFiles[0].text;
const rawBundle = (
	await build({
		entryPoints: ['lib/player/raw-provider.ts'],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		define: { 'process.env.NODE_ENV': '"production"' }
	})
).outputFiles[0].text;
let currentFixture, lifecycleScenario;
const collector = `class Capture extends AudioWorkletProcessor {
 constructor(){ super(); this.samples=0; this.zeros=0; this.max=0; this.energy=0; this.channels=0; this.active=false;this.difference=0;
 this.port.onmessage=({data})=>{if(data==='arm'){this.samples=this.zeros=this.max=this.energy=this.difference=0;this.active=true;}
 else if(data==='report'){this.active=false;this.port.postMessage({samples:this.samples,zeros:this.zeros,max:this.max,rms:Math.sqrt(this.energy/Math.max(1,this.samples)),channels:this.channels,difference:this.difference});}}; }
 process(inputs,outputs){const a=inputs[0];if(this.active&&a?.length){this.channels=a.length;let energy=0;
 for(let c=0;c<a.length;c++)for(let i=0;i<a[c].length;i++){const x=a[c][i];energy+=x*x;this.max=Math.max(this.max,Math.abs(x));if(inputs[1]?.[c])this.difference=Math.max(this.difference,Math.abs(x-inputs[1][c][i]));}this.samples+=a[0].length*a.length;this.energy+=energy;if(energy===0)this.zeros++;}return true;}
} registerProcessor('capture',Capture);`;
const server = createServer(async (req, res) => {
	const path = new URL(req.url, 'http://localhost').pathname;
	if (path.endsWith('/normalize-v2.js')) {
		if (lifecycleScenario === 'missing-worklet') return res.writeHead(503).end();
		if (lifecycleScenario === 'cancel-loading') await new Promise((r) => setTimeout(r, 150));
	}
	if (path === '/')
		return res
			.writeHead(200, { 'Content-Type': 'text/html' })
			.end(
				'<html><body><div id="video" style="width:640px;height:360px"></div><div id="audio" hidden></div></body></html>'
			);
	if (path === '/controller.js')
		return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(controller);
	if (path === '/raw-provider.js')
		return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(rawBundle);
	const json = (data) =>
		res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
	if (path === '/encoding/capabilities') return json({ codecs: ['av1', 'hevc'] });
	if (path === '/media/test')
		return json({
			Id: 'test',
			Duration: currentFixture.mode === 'native' ? 30 : 48,
			width: 320,
			height: 180,
			Raw: {
				container: 'mkv',
				videoCodec: 'hevc',
				versions: [],
				parts: [
					{
						id: '1',
						url: '/media/test/parts/1/file',
						start: 0,
						size: 1000000,
						duration: 48,
						streams: [
							{
								id: 0,
								index: 0,
								streamType: 1,
								codec: currentFixture.mode === 'wasm' ? 'h264' : 'hevc',
								bitDepth: 10,
								...(currentFixture.mode !== 'wasm'
									? { colorTrc: 'smpte2084', colorPrimaries: 'bt2020', colorSpace: 'bt2020nc' }
									: {})
							},
							{
								id: 1,
								index: 1,
								streamType: 2,
								codec:
									currentFixture.audioCodec || (currentFixture.mode === 'wasm' ? 'truehd' : 'flac'),
								displayTitle: 'Multichannel test',
								channels: currentFixture.channels || 6
							}
						]
					}
				]
			}
		});
	const encoded = /^\/media\/test\/parts\/1\/encoded\/(av1|hevc)\/(.+)$/.exec(path);
	if (encoded?.[2] === 'manifest')
		return json({
			fingerprint: 'test',
			playlist: 'master.m3u8',
			codec: encoded[1],
			output: 'SDR',
			duration: 30,
			width: 320,
			height: 180,
			audio: true,
			subtitleTracks: [],
			hasFonts: false,
			segmentSeconds: 6
		});
	if (path === '/capture.js')
		return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(collector);
	let file;
	if (path === '/media/test/parts/1/file') file = join(root, currentFixture.file.split('/').at(-1));
	if (encoded && /^[\w.-]+$/.test(encoded[2]))
		file = resolve('cache/encoded-audio-fixture', encoded[1], encoded[2]);
	if (/^\/vendor\/libmedia\/[\w./-]+$/.test(path) && !path.includes('..'))
		file = resolve('public', '.' + path);
	if (/^\/fixture\/[\w.-]+$/.test(path)) file = join(root, path.split('/').at(-1));
	if (/^\/(av1|hevc)\/[\w.-]+$/.test(path))
		file = resolve('cache/encoded-audio-fixture', '.' + path);
	try {
		if (!file) throw new Error('unmapped');
		const size = (await stat(file)).size;
		const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
		const start = range ? Number(range[1]) : 0,
			end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
		res.writeHead(range ? 206 : 200, {
			'Content-Type':
				{
					'.js': 'text/javascript',
					'.wasm': 'application/wasm',
					'.m3u8': 'application/vnd.apple.mpegurl',
					'.mp4': 'video/mp4',
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
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
	channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
	args: ['--autoplay-policy=no-user-gesture-required']
});
const results = [];
try {
	// A full 7.1 graph, independent of the physical sound card's output count.
	// Tests actual AudioWorklet routing, rapid toggles and sample-exact dry bypass.
	{
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		const graph = await page.evaluate(async () => {
			const { AudioNormalization, saveNormalization } = await import('/controller.js');
			const ctx = new AudioContext({ sampleRate: 48000 });
			await ctx.audioWorklet.addModule('/capture.js');
			const buffer = ctx.createBuffer(8, 48000, 48000);
			const tones = [440, 550, 660, 60, 770, 880, 990, 1100];
			for (let c = 0; c < 8; c++)
				for (let i = 0; i < 48000; i++)
					buffer.getChannelData(c)[i] = 0.035 * Math.sin((2 * Math.PI * tones[c] * i) / 48000);
			const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
			const destination = ctx.createGain();
			destination.connect(ctx.destination);
			const normalizer = new AudioNormalization();
			saveNormalization(true);
			await ctx.resume();
			await normalizer.bindPCM(source, destination);
			const capture = new AudioWorkletNode(ctx, 'capture', {
				numberOfInputs: 2,
				outputChannelCount: [1],
				channelCountMode: 'max',
				channelInterpretation: 'discrete'
			});
			destination.connect(capture, 0, 0);
			source.connect(capture, 0, 1);
			capture.connect(ctx.destination);
			const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
			const measure = async () => {
				capture.port.postMessage('arm');
				await sleep(300);
				const result = new Promise((r) => (capture.port.onmessage = ({ data }) => r(data)));
				capture.port.postMessage('report');
				return result;
			};
			source.start();
			await sleep(4000);
			const on = await measure(),
				status = { ...normalizer.status };
			const split = ctx.createChannelSplitter(2),
				analysers = [ctx.createAnalyser(), ctx.createAnalyser()];
			normalizer.node.connect(split);
			analysers.forEach((analyser, i) => {
				analyser.fftSize = 32768;
				analyser.smoothingTimeConstant = 0;
				split.connect(analyser, i);
			});
			await sleep(750);
			const spectra = analysers.map((analyser) => {
				const bins = new Float32Array(analyser.frequencyBinCount);
				analyser.getFloatFrequencyData(bins);
				return tones.map((hz) => bins[Math.round((hz * analyser.fftSize) / ctx.sampleRate)]);
			});
			split.disconnect();
			normalizer.node.disconnect(split);
			for (let i = 0; i < 8; i++) {
				saveNormalization(i % 2 === 0);
				await sleep(2);
			}
			saveNormalization(false);
			await sleep(150);
			const off = await measure();
			saveNormalization(true);
			await sleep(500);
			const restored = await measure();
			source.stop();
			normalizer.dispose();
			await ctx.close();
			return { on, status, spectra, off, restored };
		});
		assert.equal(graph.status.inputChannels, 8);
		assert.equal(graph.on.channels, 2);
		assert.equal(graph.on.zeros, 0);
		assert.equal(graph.off.channels, 8);
		assert.equal(graph.off.difference, 0, 'disabled graph restores every original 7.1 sample');
		assert.equal(graph.restored.channels, 2);
		assert.equal(graph.restored.zeros, 0);
		const [left, right] = graph.spectra;
		for (const speaker of [0, 4, 6])
			assert.ok(left[speaker] - right[speaker] > 35, 'left speaker stays left');
		for (const speaker of [1, 5, 7])
			assert.ok(right[speaker] - left[speaker] > 35, 'right speaker stays right');
		assert.ok(Math.abs(left[2] - right[2]) < 0.2, 'center dialogue reaches both sides equally');
		assert.ok(left[3] < -80 && right[3] < -80, 'LFE is omitted from the stereo mix');
		results.push({ name: '7.1 stereo routing and exact bypass', ...graph });
		console.log(
			'7.1 graph: stereo matrix, dialogue, surrounds, rapid toggles and exact bypass passed'
		);
		await page.close();
	}
	const cases = [
		{ name: 'Encoded MP4 AAC stereo', file: '/fixture/stereo.mp4', mode: 'element' },
		{ name: 'Encoded MP4 AAC 5.1', file: '/fixture/surround.mp4', mode: 'element' },
		{ name: 'Compatible HDR HEVC + FLAC 5.1', file: '/fixture/hdr-flac.mkv', mode: 'compatible' },
		{
			name: 'Legacy tone mapping preference migrates to native HEVC + FLAC 5.1',
			file: '/fixture/hdr-flac.mkv',
			mode: 'sdr'
		},
		{ name: 'Raw H264 + TrueHD 5.1', file: '/fixture/truehd.mkv', mode: 'wasm' },
		{ name: 'Raw AC-3 5.1', file: '/fixture/ac3-51.mkv', mode: 'compatible', audioCodec: 'ac3' },
		{
			name: 'Raw E-AC-3 5.1',
			file: '/fixture/eac3-51.mkv',
			mode: 'compatible',
			audioCodec: 'eac3'
		},
		{ name: 'Raw DTS 5.1', file: '/fixture/dts-51.mkv', mode: 'compatible', audioCodec: 'dts' },
		{
			name: 'Raw FLAC 7.1',
			file: '/fixture/flac-71.mkv',
			mode: 'compatible',
			audioCodec: 'flac',
			channels: 8
		},
		{ name: 'Encoded AV1 + Opus', file: '/av1/master.m3u8', mode: 'native' },
		{ name: 'Encoded HEVC + Opus', file: '/hevc/master.m3u8', mode: 'native' }
	].filter(
		(c) => !process.env.SPARKLE_AUDIO_CASE || c.name.includes(process.env.SPARKLE_AUDIO_CASE)
	);
	for (const fixture of cases) {
		currentFixture = fixture;
		const page = await browser.newPage();
		page.on('pageerror', (e) => console.error('Browser:', e.message));
		page.on('response', (r) => {
			if (!r.ok()) console.error('HTTP:', r.status(), new URL(r.url()).pathname);
		});
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		console.log(`Testing ${fixture.name}`);
		const result = await page.evaluate(async (fixture) => {
			fixture.file = new URL(fixture.file, location.href).href;
			const { AudioNormalization, saveNormalization, readNormalization } =
				await import('/controller.js');
			let status, normalizer;
			const hook = async (source, destination) => {
				normalizer = new AudioNormalization((value) => (status = value));
				return destination
					? normalizer.bindPCM(source, destination)
					: normalizer.bindNative(source);
			};
			const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
			saveNormalization(true);
			let element, engine, audioEngine, provider;
			if (fixture.mode === 'element') {
				element = document.createElement('video');
				document.querySelector('#video').append(element);
				element.src = fixture.file;
				await hook(element);
				await element.play();
			} else {
				const { RawProvider, RAW_MEDIA_TYPE } = await import('/raw-provider.js');
				const placeholder = document.createElement('video');
				const container = document.querySelector('#video');
				container.append(placeholder);
				const ctx = {
					player: { el: container, play: () => provider.play(), pause: () => provider.pause() },
					$state: { canPictureInPicture: { set() {} } },
					notify() {},
					delegate: { async ready() {} }
				};
				localStorage.setItem(
					'sparkle.raw.hdr',
					fixture.mode === 'native'
						? fixture.file.includes('/av1/')
							? 'av1'
							: 'hevc'
						: fixture.mode === 'sdr'
							? 'sdr'
							: 'compatible'
				);
				provider = new RawProvider(placeholder, ctx, {});
				provider.setup();
				await provider.loadSource({ src: location.origin + '/media/test', type: RAW_MEDIA_TYPE });
				if (!provider.status.ready) throw new Error(provider.status.reason);
				await provider.play();
				engine = provider.engine;
				if (!engine.isMSE() || provider.status.renderer !== 'native')
					throw new Error('Raw and encoded playback must use native video');
				if (fixture.mode === 'sdr' && localStorage.getItem('sparkle.raw.hdr') !== 'compatible')
					throw new Error('Legacy tone mapping preference was not migrated');
				audioEngine = provider.audioEngine;
				normalizer = [...provider.normalizers][0];
				element = container.querySelector('.sparkle-raw-surface video');
			}
			const ctx = normalizer.source.context;
			const corrections = [],
				driftSamples = [];
			if (audioEngine) {
				for (const name of ['seek', 'setPlaybackRate', 'pause']) {
					const original = audioEngine[name].bind(audioEngine);
					audioEngine[name] = (...args) => {
						corrections.push({ name, at: performance.now(), value: String(args[0]) });
						return original(...args);
					};
				}
			}
			await ctx.audioWorklet.addModule('/capture.js');
			const capture = new AudioWorkletNode(ctx, 'capture', {
				channelCountMode: 'max',
				channelInterpretation: 'discrete'
			});
			normalizer.destination.connect(capture).connect(ctx.destination);
			const measure = async (milliseconds) => {
				capture.port.postMessage('arm');
				await sleep(milliseconds);
				const result = new Promise((r) => (capture.port.onmessage = ({ data }) => r(data)));
				capture.port.postMessage('report');
				return result;
			};
			const clock = () =>
				provider
					? provider.timeline
					: engine
						? Number(engine.currentTime) / 1000
						: element.currentTime;
			await sleep(4500);
			const start = clock();
			const correctionsStart = corrections.length;
			const driftTimer = setInterval(() => {
				if (audioEngine) driftSamples.push(Number(audioEngine.currentTime - engine.currentTime));
			}, 200);
			// Occupy the UI thread repeatedly. Audio must keep rendering throughout.
			const busy = setInterval(() => {
				const until = performance.now() + 80;
				while (performance.now() < until) {}
			}, 400);
			const steady = await measure(fixture.mode === 'native' ? 20000 : 12000);
			clearInterval(busy);
			clearInterval(driftTimer);
			const on = { ...normalizer.status },
				end = clock();
			const steadyCorrections = corrections.slice(correctionsStart);
			// The NVENC fixture is 30 seconds. Seek back after sampling four
			// fragment boundaries so the remaining volume/track tests cannot end it.
			if (fixture.mode === 'native') {
				provider.setCurrentTime(6);
				await provider.commands;
				await sleep(1000);
			}
			const outputRMS = steady.rms;
			const volume = (value) => {
				if (provider) provider.setVolume(value);
				else if (engine) (audioEngine ?? engine).setVolume(value);
				else element.volume = value;
			};
			volume(0.5);
			await sleep(1800);
			const half = await measure(500);
			volume(0);
			await sleep(1200);
			const muted = await measure(300);
			volume(1);
			await sleep(1800);
			saveNormalization(false);
			await sleep(200);
			const off = await measure(500);
			const offStatus = { ...normalizer.status };
			let reusedOffRatio;
			if (fixture.mode === 'element') {
				// React effect replay/source reuse must keep sound when disabled,
				// despite the browser's permanent MediaElementSource association.
				normalizer.dispose();
				await hook(element);
				normalizer.source.connect(capture);
				reusedOffRatio = (await measure(300)).rms / off.rms;
				normalizer.source.disconnect(capture);
			}
			const pause = async () => {
				if (provider) await provider.pause();
				else if (engine) {
					await engine.pause();
					await audioEngine?.pause();
				} else element.pause();
			};
			const play = async () => {
				if (provider) await provider.play();
				else if (engine) {
					await engine.play();
					await audioEngine?.play({ audio: true, video: false });
				} else await element.play();
			};
			await pause();
			await sleep(500);
			const paused = clock();
			saveNormalization(true);
			await sleep(300);
			if (fixture.mode === 'element') normalizer.node.connect(capture);
			const pausedAfterToggle = clock();
			if (provider) {
				provider.setCurrentTime(8);
				await provider.commands;
			} else if (engine) {
				normalizer.reset();
				await Promise.all([engine.seek(8000n), audioEngine?.seek(8000n)]);
			} else element.currentTime = 8;
			await play();
			await sleep(1500);
			const resumed = await measure(600);
			const resumedTime = clock();
			const persisted = readNormalization();
			const stats = engine?.getStats();
			const drift = audioEngine
				? Number(engine.currentTime - audioEngine.currentTime) / 1000
				: stats
					? Number(stats.videoCurrentTime - stats.audioCurrentTime) / 1000
					: 0;
			let trackHz, switched;
			if (provider && fixture.mode === 'native') {
				await provider.selectTrack('audio', provider.status.audioTracks[1].id);
				await sleep(1000);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 4096;
				analyser.smoothingTimeConstant = 0;
				normalizer.node.connect(analyser);
				await sleep(100);
				const bins = new Float32Array(analyser.frequencyBinCount);
				analyser.getFloatFrequencyData(bins);
				trackHz = (bins.indexOf(Math.max(...bins)) * ctx.sampleRate) / analyser.fftSize;
				normalizer.node.disconnect(analyser);
				const prior = provider.timeline;
				await provider.pause();
				await provider.chooseHDR(provider.status.encodedCodec === 'av1' ? 'hevc' : 'av1');
				normalizer = [...provider.normalizers][0];
				const remainedPaused = provider.paused;
				await provider.play();
				await sleep(1200);
				switched = {
					state: normalizer.status.state,
					channels: normalizer.status.channels,
					bindings: provider.normalizers.size,
					stayedNear: Math.abs(provider.timeline - prior) < 3,
					remainedPaused,
					preference: readNormalization()
				};
			}
			await pause();
			capture.disconnect();
			normalizer.dispose();
			if (provider) {
				provider.destroy();
				await provider.commands;
			} else {
				await engine?.destroy();
				await audioEngine?.destroy();
			}
			return {
				on,
				steady,
				start,
				end,
				halfRatio: half.rms / outputRMS,
				muted,
				off,
				offStatus,
				paused,
				pausedAfterToggle,
				resumed,
				resumedTime,
				persisted,
				drift,
				isolated: crossOriginIsolated,
				corrections,
				driftSamples,
				steadyCorrections,
				trackHz,
				switched,
				reusedOffRatio
			};
		}, fixture);
		console.log(JSON.stringify({ name: fixture.name, ...result }));
		results.push({ name: fixture.name, ...result });
		assert.equal(result.isolated, false);
		assert.equal(result.on.state, 'active');
		assert.equal(result.on.channels, 2, 'normalized bus is stereo');
		assert.equal(
			result.steady.channels,
			2,
			'capture receives two channels, not silent surround lanes'
		);
		if (fixture.file.endsWith('/surround.mp4')) {
			assert.equal(result.on.inputChannels, 6, 'native AAC really supplies 5.1 before the mix');
			assert.equal(
				result.off.channels,
				6,
				'disabled normalization restores the original channel count'
			);
		}
		assert.ok(result.steady.rms > 0.01);
		assert.equal(result.steady.zeros, 0, 'steady playback has no silent render quanta');
		assert.ok(result.end - result.start > 11.5, 'clock advances normally under UI load');
		assert.ok(
			Math.abs(result.halfRatio - 0.5) < 0.09,
			'normalization must not fight the volume slider'
		);
		assert.ok(result.muted.rms < 1e-7, 'mute still works');
		assert.equal(result.offStatus.state, 'off');
		assert.ok(Math.abs(result.offStatus.gainDB) < 0.0001, 'off restores unity gain');
		assert.ok(
			Math.abs(result.pausedAfterToggle - result.paused) < 0.1,
			'toggle must not resume paused playback'
		);
		assert.ok(
			result.resumed.rms > 0.001 && result.resumedTime >= 9,
			'seek and resume retain audio'
		);
		assert.equal(result.resumed.zeros, 0);
		if (fixture.mode === 'element')
			assert.ok(
				Math.abs(result.reusedOffRatio - 1) < 0.02,
				'reusing a disabled element preserves original audio'
			);
		assert.equal(
			result.steadyCorrections.filter((c) => c.name === 'seek').length,
			0,
			'no recovery seeks during steady playback'
		);
		if (result.driftSamples.length) {
			const settled = result.driftSamples.slice(15);
			assert.ok(
				Math.max(...settled.map(Math.abs)) < 180,
				'separate audio clock stays within 180 ms under UI load'
			);
		}
		if (fixture.mode === 'native') {
			assert.ok(Math.abs(result.trackHz - 880) < 30, 'second embedded track reaches output');
			assert.deepEqual(result.switched, {
				state: 'active',
				channels: 2,
				bindings: 1,
				stayedNear: true,
				remainedPaused: true,
				preference: true
			});
		}
		assert.equal(result.persisted, true);
		await page.close();
	}
	for (const scenario of ['missing-worklet', 'cancel-loading']) {
		lifecycleScenario = scenario;
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		const result = await page.evaluate(async (scenario) => {
			const { AudioNormalization, saveNormalization } = await import('/controller.js');
			const video = document.createElement('video');
			video.src = '/fixture/stereo.mp4';
			document.body.append(video);
			let state;
			const normalizer = new AudioNormalization((s) => {
				state = s.state;
			});
			saveNormalization(true);
			const pending = normalizer.bindNative(video);
			if (scenario === 'cancel-loading') saveNormalization(false);
			await pending;
			// Creation succeeds only if failure/cancellation left native playback
			// untouched; browsers permit just one source for an element.
			const context = new AudioContext(),
				analyser = context.createAnalyser();
			context.createMediaElementSource(video).connect(analyser).connect(context.destination);
			await context.resume();
			await video.play();
			await new Promise((r) => setTimeout(r, 400));
			const samples = new Float32Array(analyser.fftSize);
			analyser.getFloatTimeDomainData(samples);
			video.pause();
			normalizer.dispose();
			await context.close();
			return { state, rms: Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length) };
		}, scenario);
		assert.equal(result.state, scenario === 'missing-worklet' ? 'unavailable' : 'off');
		assert.ok(result.rms > 0.01, `${scenario} preserves original audio`);
		results.push({ name: scenario, ...result });
		console.log(`${scenario}: original audio preserved`);
		await page.close();
	}
	lifecycleScenario = undefined;
	{
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		const result = await page.evaluate(async () => {
			const { AudioNormalization, saveNormalization } = await import('/controller.js');
			const video = document.createElement('video');
			video.src = '/fixture/stereo.mp4';
			document.body.append(video);
			const normalizer = new AudioNormalization();
			saveNormalization(false);
			await normalizer.bindNative(video);
			normalizer.setNativeGain(2);
			await video.play();
			const ctx = normalizer.source.context,
				analyser = ctx.createAnalyser();
			analyser.fftSize = 32768;
			normalizer.destination.connect(analyser);
			const measure = async (delay = 800) => {
				await new Promise((r) => setTimeout(r, delay));
				const samples = new Float32Array(analyser.fftSize);
				analyser.getFloatTimeDomainData(samples);
				return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
			};
			const boostFirst = await measure();
			normalizer.setNativeGain(1);
			const original = await measure();
			saveNormalization(true);
			const normalized = await measure(6500);
			normalizer.setNativeGain(2);
			const both = await measure();
			saveNormalization(false);
			const disabled = await measure();
			normalizer.setNativeGain(1);
			const cleared = await measure();
			video.pause();
			normalizer.dispose();
			return { original, boostFirst, normalized, both, disabled, cleared };
		});
		assert.ok(result.normalized > result.original * 2, 'normalization works after Boost');
		assert.ok(Math.abs(result.boostFirst / result.original - 2) < 0.03);
		assert.ok(
			Math.abs(result.both / result.normalized - 2) < 0.12,
			'Boost remains independent of the meter'
		);
		assert.ok(
			Math.abs(result.disabled / result.original - 2) < 0.03,
			'disabled normalization retains Boost'
		);
		assert.ok(
			Math.abs(result.cleared / result.original - 1) < 0.02,
			'clearing both restores original level'
		);
		results.push({ name: 'native-boost', ...result });
		console.log('native-boost: before/after normalization, bypass and independent gain passed');
		await page.close();
	}
	await writeFile(
		join(root, process.env.SPARKLE_AUDIO_CASE ? 'partial-report.json' : 'report.json'),
		JSON.stringify({ browser: browser.version(), results }, null, 2)
	);
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
