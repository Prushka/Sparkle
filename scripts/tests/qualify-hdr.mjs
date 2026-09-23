// Native pipeline evidence, not a physical HDR/display certification.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SPARKLE_TEST_URL || 'http://127.0.0.1:3002';
const id = process.env.SPARKLE_HDR_TEST_ID;
if (!id) throw new Error('Set SPARKLE_HDR_TEST_ID to an HDR item ID');
const browser = await chromium.launch({
	channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
function captureMSE() {
	if (typeof SourceBuffer === 'undefined') return;
	globalThis.hdrBoxes = {};
	const append = SourceBuffer.prototype.appendBuffer;
	SourceBuffer.prototype.appendBuffer = function (buffer) {
		const bytes = ArrayBuffer.isView(buffer)
			? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
			: new Uint8Array(buffer);
		{
			// Some MP4 samples append the initialization segment together with a
			// large first fragment. Inspect a bounded prefix of every append.
			const text = new TextDecoder('latin1').decode(bytes.subarray(0, 1024 * 1024)),
				view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			for (const name of ['colr', 'mdcv', 'clli', 'dvcC', 'dvvC']) {
				const at = text.indexOf(name);
				if (at < 4) continue;
				const size = view.getUint32(at - 4);
				if (size >= 8 && size < 256 && at - 4 + size <= bytes.length)
					globalThis.hdrBoxes[name] = Array.from(bytes.slice(at + 4, at - 4 + size));
			}
		}
		return append.call(this, buffer);
	};
}
await page.addInitScript(captureMSE);
page.on('worker', (worker) => void worker.evaluate(captureMSE).catch(() => {}));
const room = `hdr-check-${Date.now()}`;
await page.request.post(`${base}/be/rooms`, { data: { roomId: room, mediaId: id } });
await page.goto(`${base}/${room}/media/${id}`);
await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
await page.waitForFunction(
	() => {
		const player = document.querySelector('[data-media-player]');
		return (
			player?.getAttribute('data-raw-ready') === 'true' ||
			player?.getAttribute('data-raw-blocked') === 'true'
		);
	},
	undefined,
	{ timeout: 45000 }
);
await page.locator('[data-media-player]').hover();
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.getByRole('menuitem', { name: /^Video Settings/ }).click();
const fallback = page.getByRole('menuitem', { name: /Try compatible/ });
if ((await page.locator('[data-media-player]').getAttribute('data-raw-blocked')) === 'true') {
	await fallback.waitFor({ state: 'visible', timeout: 15000 });
	await fallback.click();
}
await page.waitForFunction(
	() => document.querySelector('[data-media-player]')?.getAttribute('data-raw-ready') === 'true',
	undefined,
	{ timeout: 45000 }
);
await page.waitForTimeout(14000);
const result = await page.evaluate(() => ({
	userAgent: navigator.userAgent,
	displayReportsHDR: matchMedia('(dynamic-range: high)').matches,
	isolated: crossOriginIsolated,
	boxes: window.hdrBoxes,
	videos: [...document.querySelectorAll('.sparkle-raw-surface video')].map((v) => ({
		time: v.currentTime,
		width: v.videoWidth,
		height: v.videoHeight,
		ready: v.readyState,
		error: v.error?.message
	})),
	label: document.querySelector('[data-raw-hdr-status]')?.textContent,
	reason: [...document.querySelectorAll('[role=status]')].map((s) => s.textContent)
}));
for (const worker of page.workers()) {
	Object.assign(
		result.boxes,
		await worker.evaluate(() => globalThis.hdrBoxes || {}).catch(() => ({}))
	);
}
result.source = await page.evaluate(async (id) => {
	const job = await (await fetch(`/be/media/${id}`)).json();
	const { default: AVPlayer } = await import('/vendor/libmedia/1.3.1/avplayer.js');
	const container = document.createElement('div');
	document.body.append(container);
	const player = new AVPlayer({
		container,
		wasmBaseUrl: '/vendor/libmedia/1.3.1',
		enableWorker: true
	});
	await player.load(new URL(`/be${job.Raw.parts[0].url}`, location.origin).href, {
		ext: job.Raw.container,
		maxProbeDuration: 3,
		ioLoaderOptions: { preload: 4194304 }
	});
	const stream = player.getStreams().find((s) => s.mediaType === 'Video');
	const data = {
		color: stream.metadata.sparkleColor,
		dolby: stream.metadata.sparkleDovi
			? {
					type: stream.metadata.sparkleDovi.type,
					data: Array.from(stream.metadata.sparkleDovi.data)
				}
			: null,
		primaries: stream.codecparProxy.colorPrimaries,
		transfer: stream.codecparProxy.colorTrc,
		matrix: stream.codecparProxy.colorSpace,
		range: stream.codecparProxy.colorRange,
		boxes: Object.fromEntries(
			Object.entries(stream.metadata.sparkleHDRBoxes || {}).map(([key, data]) => [
				key,
				Array.from(data)
			])
		)
	};
	await player.destroy();
	container.remove();
	return data;
}, id);
const expected = [];
const mastering = result.source.color?.masteringMeta;
if (mastering) {
	for (const key of ['gx', 'gy', 'bx', 'by', 'rx', 'ry', 'whiteX', 'whiteY']) {
		const n = Math.round(mastering[key] * 50000);
		expected.push(n >> 8, n & 255);
	}
	for (const key of ['maxLuminance', 'minLuminance']) {
		const n = Math.round(mastering[key] * 10000);
		expected.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
	}
}
result.masteringPreserved = expected.length
	? JSON.stringify(expected) === JSON.stringify(result.boxes.mdcv)
	: result.source.boxes.mdcv
		? JSON.stringify(result.source.boxes.mdcv) === JSON.stringify(result.boxes.mdcv)
		: 'No container mastering metadata; encoded video SEI remains unchanged';
result.browser = browser.version();
result.id = id;
result.errors = errors;
await mkdir('cache', { recursive: true });
await writeFile('cache/hdr-qualification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
if (errors.length || !result.videos.some((v) => v.time > 2 && v.width > 0) || !result.boxes.colr)
	process.exitCode = 1;
