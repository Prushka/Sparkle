// Opt-in Dolby reference-file qualification. Files stay in the ignored test
// cache, never in a Plex mapping. This test-only server serves original ranges.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
const file = resolve(process.env.SPARKLE_DOLBY_FIXTURE || 'cache/hdr-fixtures/dolby-profile5.mp4');
const size = (await stat(file)).size;
const name = process.env.SPARKLE_REFERENCE_NAME || basename(file, '.mp4');
let bytes = 0,
	ranges = 0;
const server = createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
	res.setHeader('Accept-Ranges', 'bytes');
	if (req.method === 'OPTIONS') {
		res.setHeader('Access-Control-Allow-Headers', 'Range');
		res.end();
		return;
	}
	const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
	const start = Number(match?.[1] || 0),
		end = Math.min(Number(match?.[2] || size - 1), size - 1);
	if (start > end) {
		res.writeHead(416);
		res.end();
		return;
	}
	res.setHeader('Content-Length', end - start + 1);
	res.setHeader('Content-Type', 'video/mp4');
	if (match) {
		res.statusCode = 206;
		res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
		ranges++;
	}
	if (req.method === 'HEAD') {
		res.end();
		return;
	}
	const stream = createReadStream(file, { start, end });
	stream.on('data', (chunk) => (bytes += chunk.length));
	stream.pipe(res);
	res.on('close', () => stream.destroy());
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url =
	process.env.SPARKLE_REFERENCE_URL || `http://127.0.0.1:${server.address().port}/fixture.mp4`;
const browser = await chromium.launch({
	channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required']
});
try {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.stack));
	if (process.env.SPARKLE_TEST_DEBUG)
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') console.log(m.text().slice(0, 500));
		});
	await page.goto(
		`${process.env.SPARKLE_TEST_URL || 'http://localhost:3001'}/vendor/libmedia/1.3.1/avplayer.js`
	);
	const result = await page.evaluate(
		async ({ url, omitConfiguration }) => {
			document.body.innerHTML =
				'<div id="surface" style="position:relative;width:960px;height:540px;background:black"></div>';
			const { default: Player } = await import('/vendor/libmedia/1.3.1/avplayer.js');
			const player = (window.hdrFixturePlayer = new Player({
				container: document.querySelector('#surface'),
				enableWorker: true,
				enableWebGPU: false,
				wasmBaseUrl: '/vendor/libmedia/1.3.1',
				preLoadTime: 2
			}));
			await player.load(url, {
				ext: 'mp4',
				maxProbeDuration: 3,
				ioLoaderOptions: { preload: 4194304 }
			});
			const stream = player.getStreams().find((s) => s.mediaType === 'Video');
			const info = {
				mime: player.getVideoMimeType(),
				dovi: Array.from(stream.metadata.sparkleDovi?.data || []),
				color: stream.codecparProxy.colorTrc
			};
			if (omitConfiguration) delete stream.metadata.sparkleDovi;
			player.setHDRPlayback('software', player.getVideoMimeType(), info.dovi[2] >> 1 === 5);
			await player.play({ video: true, audio: false, subtitle: false });
			await player.seek(30000n);
			return info;
		},
		{ url, omitConfiguration: process.env.SPARKLE_DOLBY_NO_CONFIG === '1' }
	);
	await page.waitForFunction(() => Number(window.hdrFixturePlayer.currentTime) > 32000, undefined, {
		timeout: 60000
	});
	await page
		.locator('#surface')
		.screenshot({ path: `cache/hdr-${name}-${process.env.SPARKLE_TEST_CHANNEL || 'chrome'}.png` });
	result.time = await page.evaluate(() => Number(window.hdrFixturePlayer.currentTime));
	result.errors = errors;
	result.bytes = bytes;
	result.ranges = ranges;
	result.browser = browser.version();
	console.log(JSON.stringify(result));
	await writeFile(
		`cache/hdr-${name}-${process.env.SPARKLE_TEST_CHANNEL || 'chrome'}.json`,
		JSON.stringify(result, null, 2)
	);
	await page.evaluate(() => window.hdrFixturePlayer.destroy());
	if (errors.length) process.exitCode = 1;
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
