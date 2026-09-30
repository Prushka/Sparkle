// Synthetic media only: real codecs, RawProvider and the shipped libmedia.
// The browser's physical capacity is reported; smaller layouts are constrained
// in this test context without changing Windows or user browser preferences.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

const encodedRoot = process.env.SPARKLE_ENCODE_AUDIO_FIXTURE_DIR;
// Inspect pre-destination PCM buses without claiming physical surround output.
const virtual = process.env.SPARKLE_AUDIO_VIRTUAL_OUTPUT === '1';
const root = resolve(encodedRoot || 'cache/surround-audio');
const layoutMetadata =
	encodedRoot && existsSync(join(root, 'layout-fixtures.json'))
		? JSON.parse(readFileSync(join(root, 'layout-fixtures.json'), 'utf8'))
		: undefined;
const capacities = process.env.SPARKLE_AUDIO_OUTPUTS
	? process.env.SPARKLE_AUDIO_OUTPUTS.split(',').map(Number)
	: [1, 2, 3, 4, 5, 6, 7, 8];
assert.ok(capacities.length && capacities.every((n) => Number.isInteger(n) && n >= 1 && n <= 8));
await mkdir(root, { recursive: true });
const tones = [440, 550, 660, 60, 770, 880, 990, 1100];
const fixtures = encodedRoot
	? [
			...['av1', 'hevc'].flatMap((codec) => [
				{ name: `${codec} Opus 5.1`, codec, channels: 6, track: 2, layout: '5.1' },
				{ name: `${codec} Opus 7.1`, codec, channels: 8, track: 3, layout: '7.1' },
				{ name: `${codec} Opus 5.1(side)`, codec, channels: 6, track: 4, layout: '5.1(side)' },
				...(layoutMetadata?.fixtures ?? []).map((fixture) => ({
					...fixture,
					codec,
					name: `${codec} Opus ${fixture.layout}`
				}))
			])
		]
	: [
			{ name: 'AAC 5.1', codec: 'aac', channels: 6, encoder: ['aac', '-b:a', '512k'] },
			{ name: 'AC-3 5.1', codec: 'ac3', channels: 6, encoder: ['ac3', '-b:a', '640k'] },
			{ name: 'E-AC-3 5.1', codec: 'eac3', channels: 6, encoder: ['eac3', '-b:a', '640k'] },
			{ name: 'DTS 5.1', codec: 'dca', channels: 6, encoder: ['dca', '-strict', '-2'] },
			{ name: 'FLAC 5.1', codec: 'flac', channels: 6, encoder: ['flac'] },
			{ name: 'FLAC 7.1', codec: 'flac', channels: 8, encoder: ['flac'] },
			{ name: 'TrueHD 7.1', codec: 'truehd', channels: 8, encoder: ['truehd', '-strict', '-2'] },
			{ name: 'AAC 7.1', codec: 'aac', channels: 8, encoder: ['aac', '-b:a', '768k'] }
		];
for (const fixture of fixtures) {
	if (encodedRoot) {
		assert.ok(
			existsSync(join(root, fixture.codec, 'audio-init.mp4')),
			'Generate the opt-in Go NVENC fixtures first'
		);
		continue;
	}
	fixture.file = `${fixture.codec}-${fixture.channels}.mkv`;
	const file = join(root, fixture.file);
	if (!existsSync(file))
		execFileSync(
			process.env.FFMPEG || 'ffmpeg',
			[
				'-hide_banner',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				'testsrc2=s=320x180:r=24',
				'-f',
				'lavfi',
				'-i',
				`aevalsrc=${tones
					.slice(0, fixture.channels)
					.map((hz) => `0.025*sin(2*PI*${hz}*t)`)
					.join('|')}:s=48000:c=${fixture.channels === 8 ? '7.1' : '5.1'}`,
				'-t',
				'18',
				'-c:v',
				'libx264',
				'-preset',
				'ultrafast',
				'-pix_fmt',
				'yuv420p',
				'-c:a',
				...fixture.encoder,
				file
			],
			{ stdio: 'pipe' }
		);
	fixture.layout = JSON.parse(
		execFileSync(
			process.env.FFPROBE || 'ffprobe',
			[
				'-v',
				'error',
				'-select_streams',
				'a:0',
				'-show_entries',
				'stream=channel_layout',
				'-of',
				'json',
				file
			],
			{ encoding: 'utf8' }
		)
	).streams[0].channel_layout;
}
const bundle = async (entry) =>
	(
		await build({
			entryPoints: [entry],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'browser',
			plugins: [
				{
					name: 'shared-normalization-controller',
					setup(build) {
						build.onResolve({ filter: /^\.\/audio-normalization$/ }, () => ({
							path: '/controller.js',
							external: true
						}));
					}
				}
			],
			define: { 'process.env.NODE_ENV': '"production"' }
		})
	).outputFiles[0].text;
const rawBundle = await bundle('lib/player/raw-provider.ts');
const controller = await bundle('lib/player/audio-normalization.ts');
let fixture;
const server = createServer(async (req, res) => {
	const path = new URL(req.url, 'http://localhost').pathname;
	const send = (type, body) => res.writeHead(200, { 'Content-Type': type }).end(body);
	if (path === '/')
		return send('text/html', '<div id="video" style="width:640px;height:360px"></div>');
	if (path === '/raw.js') return send('text/javascript', rawBundle);
	if (path === '/controller.js') return send('text/javascript', controller);
	if (path === '/encoding/capabilities')
		return send('application/json', JSON.stringify({ codecs: encodedRoot ? ['av1', 'hevc'] : [] }));
	if (path === '/media/test')
		return send(
			'application/json',
			JSON.stringify({
				Id: 'test',
				Source: 'plex',
				Duration: encodedRoot ? 30 : 18,
				width: 320,
				height: 180,
				Raw: {
					container: 'mkv',
					videoCodec: 'h264',
					versions: [],
					parts: [
						{
							id: '1',
							url: '/media/test/parts/1/file',
							start: 0,
							duration: encodedRoot ? 30 : 18,
							streams: [
								{ id: 0, index: 0, streamType: 1, codec: 'h264', bitDepth: 8 },
								...(encodedRoot
									? (layoutMetadata?.sourceChannels ?? [1, 1, 6, 8, 6])
									: [fixture.channels]
								).map((channels, i) => ({
									id: i + 1,
									index: i + 1,
									streamType: 2,
									codec: encodedRoot ? 'pcm_s16le' : fixture.codec,
									channels
								}))
							]
						}
					]
				}
			})
		);
	const encoded = /^\/media\/test\/parts\/1\/encoded\/(av1|hevc)\/([\w.-]+)$/.exec(path);
	if (encodedRoot && encoded?.[2] === 'manifest')
		return send(
			'application/json',
			JSON.stringify({
				fingerprint: 'fixture',
				playlist: 'master.m3u8',
				codec: encoded[1],
				output: 'SDR',
				duration: 30,
				width: 320,
				height: 180,
				audio: true,
				audioChannels: 8,
				audioTracks: layoutMetadata?.audioTracks,
				subtitleTracks: [],
				hasFonts: false,
				timestampStart: true,
				segmentSeconds: 12
			})
		);
	if (encodedRoot && encoded?.[2].startsWith('subtitles-'))
		return send('application/json', '{"tracks":[],"packets":[]}');
	let file;
	if (encodedRoot && encoded) file = join(root, encoded[1], encoded[2]);
	if (path === '/media/test/parts/1/file') file = join(root, fixture.file);
	if (/^\/vendor\/libmedia\/[\w./-]+$/.test(path) && !path.includes('..'))
		file = resolve('public', '.' + path);
	try {
		if (!file) throw new Error('unmapped');
		const size = (await stat(file)).size;
		const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
		const start = Number(range?.[1] || 0),
			end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
		res.writeHead(range ? 206 : 200, {
			'Content-Type':
				{
					'.js': 'text/javascript',
					'.wasm': 'application/wasm',
					'.m3u8': 'application/vnd.apple.mpegurl',
					'.mp4': 'video/mp4',
					'.m4s': 'video/mp4'
				}[extname(file)] || 'application/octet-stream',
			'Accept-Ranges': 'bytes',
			'Content-Length': end - start + 1,
			...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
		});
		if (req.method === 'HEAD') res.end();
		else createReadStream(file, { start, end }).pipe(res);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await (process.env.SPARKLE_TEST_CHANNEL === 'webkit' ? webkit : chromium).launch({
	channel:
		process.env.SPARKLE_TEST_CHANNEL === 'webkit'
			? undefined
			: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
	args:
		process.env.SPARKLE_TEST_CHANNEL === 'webkit'
			? []
			: ['--autoplay-policy=no-user-gesture-required']
});
const results = [];
try {
	for (const channels of capacities) {
		for (fixture of fixtures) {
			if (process.env.SPARKLE_AUDIO_CASE && !fixture.name.includes(process.env.SPARKLE_AUDIO_CASE))
				continue;
			const page = await browser.newPage();
			await page.goto(`http://127.0.0.1:${server.address().port}`);
			const result = await page.evaluate(
				async ({ channels, tones, encoded, codec, track, virtual, extendedChecks }) => {
					const NativeContext = window.AudioContext;
					if (!NativeContext)
						throw new Error(
							'This browser build has no Web Audio support; physical Safari is required'
						);
					let physical;
					window.AudioContext = class extends NativeContext {
						constructor(...args) {
							super(...args);
							physical = this.destination.maxChannelCount;
							Object.defineProperty(this.destination, 'maxChannelCount', {
								value: virtual ? channels : Math.min(channels, physical)
							});
							if (virtual) {
								let width = 2;
								Object.defineProperty(this.destination, 'channelCount', {
									get: () => width,
									set: (value) => {
										width = value;
									}
								});
							}
						}
					};
					const { RawProvider, RAW_MEDIA_TYPE } = await import('/raw.js');
					const container = document.querySelector('#video'),
						placeholder = document.createElement('video');
					container.append(placeholder);
					let provider;
					const ctx = {
						player: { el: container, play: () => provider.play(), pause: () => provider.pause() },
						$state: { canPictureInPicture: { set() {} }, canFullscreen: { set() {} } },
						notify() {},
						delegate: { async ready() {} }
					};
					localStorage.setItem('sparkle.raw.hdr', encoded ? codec : 'compatible');
					provider = new RawProvider(placeholder, ctx, {});
					provider.setup();
					await provider.loadSource({ src: location.origin + '/media/test', type: RAW_MEDIA_TYPE });
					if (!provider.status.ready) throw new Error(provider.status.reason);
					await provider.play();
					if (encoded) {
						await provider.selectTrack('audio', provider.status.audioTracks[track].id);
						await provider.applyRoomState({ time: 14, paused: true });
						await provider.recoverPlayback();
						if (
							!provider.paused ||
							Math.abs(provider.timeline - 14) > 0.3 ||
							provider.status.audio !== provider.status.audioTracks[track].id
						)
							throw new Error('timestamp recovery lost the paused position or local audio track');
						await provider.play();
					}
					const normalizer = [...provider.normalizers][0];
					const context = normalizer.source.context;
					const output = context.destination.channelCount;
					const splitter = context.createChannelSplitter(output);
					normalizer.destination.connect(splitter);
					const analysers = Array.from({ length: output }, (_, ch) => {
						const analyser = context.createAnalyser();
						analyser.fftSize = 32768;
						analyser.smoothingTimeConstant = 0;
						splitter.connect(analyser, ch);
						return analyser;
					});
					const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
					await sleep(2600);
					const spectra = () =>
						analysers.map((analyser) => {
							const bins = new Float32Array(analyser.frequencyBinCount);
							analyser.getFloatFrequencyData(bins);
							return tones.map((hz) => {
								const bin = Math.round((hz * analyser.fftSize) / context.sampleRate);
								return Math.max(...bins.slice(bin - 2, bin + 3));
							});
						});
					const off = spectra();
					await provider.pause();
					provider.setCurrentTime(6);
					await provider.commands;
					await provider.play();
					await sleep(1000);
					const afterSeek = spectra();
					let afterNormalization;
					if (encoded && virtual && channels === 8 && (track === 3 || extendedChecks)) {
						const { setNormalization } = await import('/controller.js');
						setNormalization(true);
						for (let i = 0; i < 100 && normalizer.status.state !== 'active'; i++) await sleep(20);
						if (normalizer.status.state !== 'active')
							throw new Error('normalization did not start');
						await sleep(800);
						setNormalization(false);
						await sleep(800);
						afterNormalization = spectra();
					}
					const boundaries = [];
					// Exercise actual PCM across both independently encoded boundaries.
					if (encoded && (track === 3 || extendedChecks) && channels === 2 && !virtual) {
						const module = URL.createObjectURL(
							new Blob(
								[
									`class Continuity extends AudioWorkletProcessor {
 constructor(){super();this.active=false;this.zeros=0;this.count=0;this.port.onmessage=({data})=>{if(data==='arm'){this.active=true;this.zeros=this.count=0;}else{this.active=false;this.port.postMessage({zeros:this.zeros,count:this.count});}};}
 process(inputs){if(this.active&&inputs[0]?.length){this.count++;let energy=0;for(const channel of inputs[0])for(const x of channel)energy+=x*x;if(energy<1e-12)this.zeros++;}return true;}
}registerProcessor('continuity',Continuity);`
								],
								{ type: 'text/javascript' }
							)
						);
						await context.audioWorklet.addModule(module);
						URL.revokeObjectURL(module);
						const capture = new AudioWorkletNode(context, 'continuity');
						normalizer.destination.connect(capture).connect(context.destination);
						const samples = new Float32Array(2048);
						const meter = context.createAnalyser();
						meter.fftSize = 2048;
						normalizer.destination.connect(meter);
						for (const boundary of [12, 24]) {
							provider.setCurrentTime(boundary - 2);
							await provider.commands;
							const values = [],
								dropouts = [];
							let armed = false;
							const deadline = performance.now() + 12000;
							while (provider.timeline < boundary + 1 && performance.now() < deadline) {
								if (provider.timeline > boundary - 0.5) {
									if (!armed) {
										capture.port.postMessage('arm');
										armed = true;
									}
									meter.getFloatTimeDomainData(samples);
									values.push(
										Math.sqrt(
											samples.reduce((sum, value) => sum + value * value, 0) / samples.length
										)
									);
									if (values.at(-1) < 0.002)
										dropouts.push({
											time: provider.timeline,
											audio: Number(provider.audioEngine.currentTime) / 1000,
											rate: provider.audioRate,
											stutters: provider.audioEngine.getStats().audioStutter,
											rms: values.at(-1)
										});
								}
								await sleep(10);
							}
							const rendered = await new Promise((resolve) => {
								capture.port.onmessage = ({ data }) => resolve(data);
								capture.port.postMessage('report');
							});
							boundaries.push({
								rendered,
								boundary,
								end: provider.timeline,
								count: values.length,
								min: Math.min(...values),
								dropouts
							});
						}
						normalizer.destination.disconnect(capture);
						capture.disconnect();
						normalizer.destination.disconnect(meter);
					}
					const clock = provider.timeline;
					const separateAudio = !!provider.audioEngine;
					const inputChannels = provider.audioEngine
						?.getStreams()
						.filter((s) => s.mediaType.toLowerCase() === 'audio')
						.map((s) => s.codecparProxy.chLayout.nbChannels);
					const drift = provider.audioEngine
						? Number(provider.audioEngine.currentTime - provider.engine.currentTime)
						: 0;
					const native = provider.engine.isMSE();
					const audioDescription = provider.status.audioTracks[track]?.outputDescription;
					normalizer.destination.disconnect(splitter);
					splitter.disconnect();
					provider.destroy();
					for (let i = 0; i < 100 && context.destination.channelCount !== 2; i++) await sleep(50);
					return {
						audioDescription,
						boundaries,
						separateAudio,
						inputChannels,
						drift,
						physical,
						output,
						off,
						afterSeek,
						afterNormalization,
						clock,
						native,
						restored: context.destination.channelCount
					};
				},
				{
					channels,
					tones: fixture.tones ?? tones,
					encoded: !!encodedRoot,
					codec: fixture.codec,
					track: fixture.track,
					virtual,
					extendedChecks: fixture.layout === '7.1.4' || fixture.layout === 'unknown'
				}
			);
			assert.ok(result.native, 'native video retained');
			if (encodedRoot) {
				assert.equal(result.separateAudio, true, 'multichannel titles must use client PCM');
				assert.deepEqual(
					result.inputChannels,
					layoutMetadata?.encodedChannels ?? [1, 1, 6, 8, 8],
					'encoded track channel counts retained'
				);
				assert.ok(Math.abs(result.drift) < 500, `audio/video drift: ${result.drift} ms`);
				if (fixture.layout === 'unknown')
					assert.equal(result.audioDescription, 'Stereo mix (unknown layout)');
				else if (
					['7.1.4', '22.2', '7.1(wide)', '7.1(wide-side)', '6.1(back)'].includes(fixture.layout)
				)
					assert.equal(result.audioDescription, '7.1 mix');
				for (const b of result.boundaries) {
					assert.ok(b.end >= b.boundary + 1 && b.count > 40, 'boundary playback stalled');
					assert.ok(b.rendered.count > 400, 'audio-thread capture did not span the boundary');
					assert.equal(b.rendered.zeros, 0, `rendered PCM dropout: ${JSON.stringify(b)}`);
					assert.ok(b.min > 0.002, `PCM dropout: ${JSON.stringify(b)}`);
				}
			}
			assert.equal(
				result.output,
				[8, 6, 4, 2, 1].find(
					(count) => count <= (virtual ? channels : Math.min(channels, result.physical))
				) || 2
			);
			assert.ok(result.clock > 6, 'playback resumes after seek');
			assert.equal(result.restored, 2, 'original context configuration restored on teardown');
			// Decoder output goes directly into a destination of exactly this width:
			// these are the channels sent to Chrome, without a second implicit mix.
			// The pinned FFmpeg 7 FLAC decoder declares 5.1(side), whereas newer
			// ffprobe versions label the same FLAC assignment 5.1(back). Assert
			// the decoded speaker layout, including its side/back distinction.
			const sideSurrounds =
				fixture.layout === '5.1(side)' || (fixture.codec === 'flac' && fixture.channels === 6);
			let maps =
				result.output === 1
					? [[0], [0], [0], [], [0], [0], [0], [0]]
					: result.output === 2
						? [[0], [1], [0, 1], [], [0], [1], [0], [1]]
						: result.output === 4
							? [[0], [1], [0, 1], [], [2], [3], [2], [3]]
							: result.output === 6
								? [[0], [1], [2], [3], [4], [5], [4], [5]]
								: [[0], [1], [2], [3], [sideSurrounds ? 6 : 4], [sideSurrounds ? 7 : 5], [6], [7]];
			if (fixture.targets) {
				const speakers = ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'];
				maps = fixture.targets.map((speaker) => {
					if (speaker === 'BC')
						return result.output <= 2
							? Array.from({ length: result.output }, (_, i) => i)
							: result.output === 4
								? [2, 3]
								: [4, 5];
					const i = speakers.indexOf(speaker);
					assert.ok(i >= 0, `unknown expected speaker ${speaker}`);
					return result.output === 8 ? [i] : maps[i];
				});
			}
			for (const spectra of [result.off, result.afterSeek, result.afterNormalization].filter(
				Boolean
			)) {
				for (let source = 0; source < fixture.channels; source++) {
					for (const target of maps[source])
						assert.ok(
							spectra[target][source] > -65,
							`${fixture.name} ${result.output}ch: source ${source} missing from output ${target}: ${spectra[target][source]} dB`
						);
					for (let target = 0; target < result.output; target++) {
						if (maps[source].includes(target)) continue;
						assert.ok(
							spectra[target][source] < -65,
							`${fixture.name} ${result.output}ch: source ${source} leaked into output ${target}: ${spectra[target][source]} dB`
						);
					}
				}
			}
			results.push({ name: fixture.name, layout: fixture.layout, requested: channels, ...result });
			console.log(
				`${fixture.name}: ${channels} available → ${result.output} ${virtual ? 'virtual PCM' : 'output'} channels, speaker routing and seek passed (physical capacity ${result.physical})`
			);
			await page.close();
		}
	}
} finally {
	await writeFile(
		join(
			root,
			virtual
				? process.env.SPARKLE_AUDIO_CASE
					? 'virtual-partial-report.json'
					: 'virtual-report.json'
				: process.env.SPARKLE_AUDIO_CASE || process.env.SPARKLE_AUDIO_OUTPUTS
					? 'partial-report.json'
					: 'report.json'
		),
		JSON.stringify({ browser: browser.version(), results }, null, 2)
	);
	await browser.close();
	server.close();
}
