// Synthetic originals only: real codecs, RawProvider and the shipped libmedia.
// The browser's physical capacity is reported; smaller layouts are constrained
// in this test context without changing Windows or user browser preferences.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve('cache/surround-audio');
const capacities = process.env.SPARKLE_AUDIO_OUTPUTS
	? process.env.SPARKLE_AUDIO_OUTPUTS.split(',').map(Number)
	: [1, 2, 3, 4, 5, 6, 7, 8];
assert.ok(capacities.length && capacities.every((n) => Number.isInteger(n) && n >= 1 && n <= 8));
await mkdir(root, { recursive: true });
const tones = [440, 550, 660, 60, 770, 880, 990, 1100];
const fixtures = [
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
	if (path === '/encoding/capabilities') return send('application/json', '{"codecs":[]}');
	if (path === '/media/test')
		return send(
			'application/json',
			JSON.stringify({
				Id: 'test',
				Source: 'plex',
				Duration: 18,
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
							duration: 18,
							streams: [
								{ id: 0, index: 0, streamType: 1, codec: 'h264', bitDepth: 8 },
								{ id: 1, index: 1, streamType: 2, codec: fixture.codec, channels: fixture.channels }
							]
						}
					]
				}
			})
		);
	let file;
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
				{ '.js': 'text/javascript', '.wasm': 'application/wasm' }[extname(file)] ||
				'application/octet-stream',
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
const browser = await chromium.launch({
	channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
	args: ['--autoplay-policy=no-user-gesture-required']
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
				async ({ channels, tones }) => {
					const NativeContext = window.AudioContext;
					let physical;
					window.AudioContext = class extends NativeContext {
						constructor(...args) {
							super(...args);
							physical = this.destination.maxChannelCount;
							Object.defineProperty(this.destination, 'maxChannelCount', {
								value: Math.min(channels, physical)
							});
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
					localStorage.setItem('sparkle.raw.hdr', 'compatible');
					localStorage.setItem('sparkle.audio.normalize', 'false');
					provider = new RawProvider(placeholder, ctx, {});
					provider.setup();
					await provider.loadSource({ src: location.origin + '/media/test', type: RAW_MEDIA_TYPE });
					if (!provider.status.ready) throw new Error(provider.status.reason);
					await provider.play();
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
					const clock = provider.timeline;
					const native = provider.engine.isMSE();
					normalizer.destination.disconnect(splitter);
					splitter.disconnect();
					provider.destroy();
					for (let i = 0; i < 100 && context.destination.channelCount !== 2; i++) await sleep(50);
					return {
						physical,
						output,
						off,
						afterSeek,
						clock,
						native,
						restored: context.destination.channelCount
					};
				},
				{ channels, tones }
			);
			assert.ok(result.native, 'native video retained');
			assert.equal(
				result.output,
				[8, 6, 4, 2, 1].find((count) => count <= Math.min(channels, result.physical)) || 2
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
			const maps =
				result.output === 1
					? [[0], [0], [0], [], [0], [0], [0], [0]]
					: result.output === 2
						? [[0], [1], [0, 1], [], [0], [1], [0], [1]]
						: result.output === 4
							? [[0], [1], [0, 1], [], [2], [3], [2], [3]]
							: result.output === 6
								? [[0], [1], [2], [3], [4], [5], [4], [5]]
								: [[0], [1], [2], [3], [sideSurrounds ? 6 : 4], [sideSurrounds ? 7 : 5], [6], [7]];
			for (const spectra of [result.off, result.afterSeek]) {
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
				`${fixture.name}: ${channels} available → ${result.output} output channels, speaker routing and seek passed (physical capacity ${result.physical})`
			);
			await page.close();
		}
	}
} finally {
	await writeFile(
		join(
			root,
			process.env.SPARKLE_AUDIO_CASE || process.env.SPARKLE_AUDIO_OUTPUTS
				? 'partial-report.json'
				: 'report.json'
		),
		JSON.stringify({ browser: browser.version(), results }, null, 2)
	);
	await browser.close();
	server.close();
}
