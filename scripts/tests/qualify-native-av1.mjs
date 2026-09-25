// Opt-in Chrome regression for a short timecode-bearing NVENC reference clip.
// Supply two local, video-only MP4 fixtures encoded with -s12m_tc 1 and 0.
// This loopback server exposes only those clips and the locally pinned player.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';

const fixtures = {
	'/broken.mp4': process.env.SPARKLE_AV1_BROKEN_FIXTURE,
	'/fixed.mp4': process.env.SPARKLE_AV1_FIXED_FIXTURE
};
assert.ok(Object.values(fixtures).every(Boolean), 'Supply both short NVENC fixtures');
const server = createServer((req, res) => {
	const path = new URL(req.url, 'http://localhost').pathname;
	if (path === '/') return res.end('<div id="video" style="width:960px;height:540px"></div>');
	const file = fixtures[path] || (path.startsWith('/vendor/') && resolve('public', '.' + path));
	if (!file || path.includes('..')) return res.writeHead(404).end();
	let size;
	try {
		size = statSync(file).size;
	} catch {
		return res.writeHead(404).end();
	}
	const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
	const start = Number(range?.[1] || 0);
	const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
	if (start > end) return res.writeHead(416).end();
	res.writeHead(range ? 206 : 200, {
		'Content-Type':
			extname(file) === '.js'
				? 'text/javascript'
				: extname(file) === '.wasm'
					? 'application/wasm'
					: 'video/mp4',
		'Content-Length': end - start + 1,
		'Accept-Ranges': 'bytes',
		...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
	});
	const stream = createReadStream(file, { start, end });
	res.on('close', () => stream.destroy());
	stream.pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome' });
try {
	for (const fixture of ['broken', 'fixed'])
		for (const mode of ['native', 'libmedia']) {
			const page = await browser.newPage();
			await page.goto(`http://127.0.0.1:${server.address().port}`);
			const result = await page.evaluate(
				async ({ fixture, mode }) => {
					const container = document.querySelector('#video');
					let video, engine;
					const errors = [];
					if (mode === 'native') {
						video = document.createElement('video');
						video.muted = true;
						container.append(video);
						video.src = `/${fixture}.mp4`;
						await video.play();
					} else {
						const { default: Player } = await import('/vendor/libmedia/1.3.1/avplayer.js');
						engine = new Player({
							container,
							enableWorker: true,
							enableHardware: true,
							checkUseMSE: () => true
						});
						engine.on('error', (error) => errors.push(error.message));
						await engine.load(`${location.origin}/${fixture}.mp4`);
						await engine.play();
						video = container.querySelector('video');
					}
					await new Promise((r) => setTimeout(r, 2200));
					const result = {
						time: video.currentTime,
						code: video.error?.code || 0,
						errors,
						mime: engine?.getVideoMimeType()
					};
					if (engine) await engine.destroy();
					return result;
				},
				{ fixture, mode }
			);
			if (fixture === 'broken') {
				assert.equal(result.code, 3, 'Reference must reproduce native decode failure');
				if (mode === 'libmedia') assert.deepEqual(result.errors, ['Native media decoding failed']);
			} else {
				assert.equal(result.code, 0);
				assert.ok(result.time > 2, 'Fixed reference must advance normally');
				assert.deepEqual(result.errors, []);
			}
			console.log(`${fixture}/${mode}:`, result);
			await page.close();
		}
} finally {
	await browser.close();
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
}
