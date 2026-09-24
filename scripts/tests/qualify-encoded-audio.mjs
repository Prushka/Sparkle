import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';

assert.ok(
	process.env.SPARKLE_ENCODE_AUDIO_FIXTURE_DIR,
	'Generate the opt-in Go audio fixtures first'
);
const root = resolve(process.env.SPARKLE_ENCODE_AUDIO_FIXTURE_DIR);
const server = createServer(async (req, res) => {
	const path = new URL(req.url, 'http://localhost').pathname;
	if (!/^\/(av1|hevc)\/(master\.m3u8|(audio|video)(\.m3u8|-init\.mp4|-\d\.m4s))$/.test(path)) {
		res.writeHead(404).end();
		return;
	}
	try {
		const data = await readFile(join(root, path));
		res.writeHead(200, {
			'Access-Control-Allow-Origin': '*',
			'Content-Length': data.length,
			'Content-Type': path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
		});
		res.end(data);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
	channel: 'chrome',
	args: ['--autoplay-policy=no-user-gesture-required']
});
try {
	for (const codec of ['av1', 'hevc']) {
		const page = await browser.newPage();
		await page.goto(
			`${process.env.SPARKLE_TEST_URL || 'http://127.0.0.1:3004'}/vendor/libmedia/1.3.1/avplayer.js`
		);
		const result = await page.evaluate(async (url) => {
			const { default: Player } = await import('/vendor/libmedia/1.3.1/avplayer.js');
			document.body.innerHTML = '<div id="fixture" style="width:640px;height:360px"></div>';
			const player = new Player({
				container: document.querySelector('#fixture'),
				wasmBaseUrl: '/vendor/libmedia/1.3.1',
				enableWorker: true,
				preLoadTime: 12
			});
			await player.load(url, { ext: 'm3u8' });
			player.setHDRPlayback('native', player.getVideoMimeType());
			await player.play({ video: true, audio: true, subtitle: false });
			const video = document.querySelector('video');
			const context = new AudioContext(),
				analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			// Measure the current track, without averaging in the previous tone.
			analyser.smoothingTimeConstant = 0;
			context.createMediaElementSource(video).connect(analyser).connect(context.destination);
			await context.resume();
			const samples = new Float32Array(analyser.fftSize),
				spectrum = new Float32Array(analyser.frequencyBinCount);
			const read = () => {
				analyser.getFloatTimeDomainData(samples);
				analyser.getFloatFrequencyData(spectrum);
				let peak = 0;
				for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
				return {
					rms: Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length),
					hz: (peak * context.sampleRate) / analyser.fftSize
				};
			};
			const values = [];
			const deadline = performance.now() + 45000;
			while (video.currentTime < 25 && performance.now() < deadline) {
				if (video.currentTime > 2) values.push({ time: video.currentTime, ...read() });
				await new Promise((r) => setTimeout(r, 10));
			}
			const before = read();
			const audio = player.getStreams().filter((s) => s.mediaType.toLowerCase() === 'audio');
			await player.pause();
			await player.selectAudio(audio[1].id, false, true);
			await player.seek(8000n);
			await player.play({ video: true, audio: true, subtitle: false });
			await new Promise((r) => setTimeout(r, 1500));
			const after = read(),
				bitrate = await player.getPlaybackBitrate();
			const selected = player.getSelectedAudioStreamId();
			await player.destroy();
			await context.close();
			return {
				count: values.length,
				end: values.at(-1)?.time,
				minRMS: Math.min(...values.map((v) => v.rms)),
				low: values.filter((v) => v.rms < 0.01).slice(0, 20),
				before,
				selected,
				after,
				bitrate
			};
		}, `http://127.0.0.1:${server.address().port}/${codec}/master.m3u8`);
		console.log(JSON.stringify({ codec, ...result }));
		assert.ok(result.end > 24, 'playback did not cross four segment boundaries');
		assert.ok(result.count > 1000, 'insufficient PCM sampling');
		assert.deepEqual(result.low, [], 'encoded audio dropped out at a fragment boundary');
		assert.ok(Math.abs(result.before.hz - 440) < 30, 'first audio track is incorrect');
		assert.ok(
			Math.abs(result.after.hz - 880) < 30,
			'embedded audio switch did not reach native output'
		);
		await page.close();
	}
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
