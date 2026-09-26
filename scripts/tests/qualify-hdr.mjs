// Native pipeline evidence, not a physical HDR/display certification.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SPARKLE_TEST_URL || 'http://127.0.0.1:3002';
const backend = new URL(process.env.SPARKLE_TEST_BACKEND_URL || '/be', base).href.replace(
	/\/$/,
	''
);
const id = process.env.SPARKLE_HDR_TEST_ID;
if (process.env.SPARKLE_HDR_MODE === 'sdr')
	throw new Error(
		'Software tone mapping is temporarily disabled; qualify native playback instead.'
	);
if (!id) throw new Error('Set SPARKLE_HDR_TEST_ID to an HDR item ID');
const browser = await chromium.launch({
	channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
const errors = [];
const positions = [];
if (process.env.SPARKLE_TEST_DEBUG)
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') console.log(m.text().slice(0, 800));
	});
page.on('websocket', (socket) =>
	socket.on('framesent', (frame) => {
		try {
			const message = JSON.parse(String(frame.payload));
			if (message.type === 'time') positions.push(message.time);
		} catch {}
	})
);
page.on('pageerror', (e) => errors.push(e.stack || e.message));
function captureMSE() {
	if (typeof SourceBuffer === 'undefined') return;
	globalThis.hdrBoxes = {};
	globalThis.hdrStaticSEI = {};
	globalThis.hdrPackets = { rpu: 0, hdr10plus: 0, maxAppend: 0 };
	const append = SourceBuffer.prototype.appendBuffer;
	SourceBuffer.prototype.appendBuffer = function (buffer) {
		const bytes = ArrayBuffer.isView(buffer)
			? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
			: new Uint8Array(buffer);
		globalThis.hdrPackets.maxAppend = Math.max(globalThis.hdrPackets.maxAppend, bytes.length);
		{
			// Some MP4 samples append the initialization segment together with a
			// large first fragment. Inspect a bounded prefix of every append.
			const text = new TextDecoder('latin1').decode(bytes.subarray(0, 1024 * 1024)),
				view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const hvcc = text.indexOf('hvcC');
			if (hvcc >= 4 && hvcc + 26 < bytes.length)
				globalThis.hdrNALLength = (bytes[hvcc + 25] & 3) + 1;
			if (globalThis.hdrNALLength) {
				// Inspect already-buffered MP4 packets; never fetch additional media.
				for (let box = 0, boxes = 0; box + 8 <= bytes.length && boxes++ < 128;) {
					const size = view.getUint32(box),
						type = String.fromCharCode(...bytes.subarray(box + 4, box + 8));
					if (size < 8 || box + size > bytes.length) break;
					if (type === 'mdat')
						for (
							let pos = box + 8, nals = 0;
							pos + globalThis.hdrNALLength + 2 <= box + size && nals++ < 4096;
						) {
							let n = 0;
							for (let k = 0; k < globalThis.hdrNALLength; k++) n = n * 256 + bytes[pos++];
							if (n < 2 || pos + n > box + size) break;
							const type = (bytes[pos] >> 1) & 63;
							if (type === 62) globalThis.hdrPackets.rpu++;
							if ((type === 39 || type === 40) && n < 65536) {
								const rbsp = [];
								for (let k = pos + 2; k < pos + n; k++) {
									if (k >= pos + 4 && bytes[k] === 3 && bytes[k - 1] === 0 && bytes[k - 2] === 0)
										continue;
									rbsp.push(bytes[k]);
								}
								for (let p = 0; p + 2 < rbsp.length;) {
									let payload = 0,
										length = 0;
									while (p < rbsp.length && rbsp[p] === 255) {
										payload += 255;
										p++;
									}
									payload += rbsp[p++] || 0;
									while (p < rbsp.length && rbsp[p] === 255) {
										length += 255;
										p++;
									}
									length += rbsp[p++] || 0;
									if (p + length > rbsp.length) break;
									if ((payload === 137 && length === 24) || (payload === 144 && length === 4))
										globalThis.hdrStaticSEI[payload === 137 ? 'mdcv' : 'clli'] = rbsp.slice(
											p,
											p + length
										);
									if (
										payload === 4 &&
										length >= 7 &&
										rbsp[p] === 0xb5 &&
										rbsp[p + 1] === 0 &&
										rbsp[p + 2] === 0x3c &&
										rbsp[p + 3] === 0 &&
										rbsp[p + 4] === 1 &&
										rbsp[p + 5] === 4
									)
										globalThis.hdrPackets.hdr10plus++;
									p += length;
								}
							}
							pos += n;
						}
					box += size;
				}
			}
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
try {
	await page.addInitScript(captureMSE);
	page.on('worker', (worker) => void worker.evaluate(captureMSE).catch(() => {}));
	const room = `hdr-check-${Date.now()}`;
	const created = await page.request.post(`${backend}/rooms`, {
		data: { roomId: room, mediaId: id }
	});
	if (!created.ok()) throw new Error(`Room creation failed: ${created.status()}`);
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
	if (process.env.SPARKLE_HDR_MODE === 'sdr') {
		await page.getByRole('menuitemradio', { name: 'Tone mapping' }).click();
	}
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
	if (await page.locator('[data-media-player]').evaluate((el) => el.hasAttribute('data-paused'))) {
		await page.locator('[data-media-player]').focus();
		await page.keyboard.press('k');
	}
	await page.waitForTimeout(14000);
	await page
		.locator('.sparkle-raw-surface')
		.screenshot({ path: `cache/hdr-${id}-${process.env.SPARKLE_HDR_MODE || 'auto'}.png` });
	const result = await page.evaluate(() => ({
		userAgent: navigator.userAgent,
		displayReportsHDR: matchMedia('(dynamic-range: high)').matches,
		isolated: crossOriginIsolated,
		renderer: document.querySelector('[data-media-player]')?.getAttribute('data-raw-renderer'),
		canvas: [...document.querySelectorAll('.sparkle-raw-surface canvas')].map((c) => ({
			width: c.width,
			height: c.height
		})),
		time: document.querySelector('[data-media-player]')?.currentTime,
		boxes: window.hdrBoxes,
		staticSEI: window.hdrStaticSEI,
		packets: window.hdrPackets,
		videos: [...document.querySelectorAll('.sparkle-raw-surface video')].map((v) => ({
			time: v.currentTime,
			width: v.videoWidth,
			height: v.videoHeight,
			ready: v.readyState,
			error: v.error?.message
		})),
		label: document.querySelector('[data-raw-hdr-status]')?.textContent,
		reason: [...document.querySelectorAll('[role=status]')].map((s) => s.textContent),
		paused: document.querySelector('[data-media-player]')?.hasAttribute('data-paused'),
		timeLabel: [...document.querySelectorAll('.vds-time')].map((el) => el.textContent)
	}));
	for (const worker of page.workers()) {
		Object.assign(
			result.staticSEI,
			await worker.evaluate(() => globalThis.hdrStaticSEI || {}).catch(() => ({}))
		);
		Object.assign(
			result.boxes,
			await worker.evaluate(() => globalThis.hdrBoxes || {}).catch(() => ({}))
		);
		const packets = await worker.evaluate(() => globalThis.hdrPackets).catch(() => null);
		if (packets) {
			result.packets.rpu += packets.rpu;
			result.packets.hdr10plus += packets.hdr10plus;
			result.packets.maxAppend = Math.max(result.packets.maxAppend, packets.maxAppend);
		}
	}
	result.source = await page.evaluate(
		async ({ id, backend }) => {
			const job = await (await fetch(`${backend}/media/${id}`)).json();
			const { default: AVPlayer } = await import('/vendor/libmedia/1.3.1/avplayer.js');
			const container = document.createElement('div');
			document.body.append(container);
			const player = new AVPlayer({
				container,
				wasmBaseUrl: '/vendor/libmedia/1.3.1',
				enableWorker: true
			});
			await player.load(`${backend}${job.Raw.parts[0].url}`, {
				ext: { mpegts: 'ts', matroska: 'mkv' }[job.Raw.container] || job.Raw.container,
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
		},
		{ id, backend }
	);
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
			: result.staticSEI.mdcv
				? JSON.stringify(result.staticSEI.mdcv) === JSON.stringify(result.boxes.mdcv)
				: 'No mastering metadata present';
	result.staticSEIPreserved = Object.entries(result.staticSEI).every(
		([name, bytes]) => JSON.stringify(bytes) === JSON.stringify(result.boxes[name])
	);
	result.browser = browser.version();
	result.id = id;
	result.time = positions.at(-1) || 0;
	result.errors = errors;
	await mkdir('cache', { recursive: true });
	await writeFile(
		`cache/hdr-${id}-${process.env.SPARKLE_HDR_MODE || 'auto'}-${process.env.SPARKLE_TEST_CHANNEL || 'chrome'}.json`,
		JSON.stringify(result, null, 2)
	);
	console.log(JSON.stringify(result));
	if (
		errors.length ||
		(result.renderer === 'native' && !result.staticSEIPreserved) ||
		(result.renderer === 'software'
			? !(result.time > 2 && result.canvas.some((c) => c.width > 0))
			: !result.videos.some((v) => v.time > 2 && v.width > 0) || !result.boxes.colr)
	)
		process.exitCode = 1;
} catch (error) {
	console.error(String(error));
	console.error(
		await page
			.locator('[data-media-player]')
			.evaluate((el) => ({
				ready: el.getAttribute('data-raw-ready'),
				renderer: el.getAttribute('data-raw-renderer'),
				output: el.getAttribute('data-raw-output'),
				text: el.querySelector('[role=status]')?.textContent
			}))
			.catch(() => ({ status: 'player not mounted' }))
	);
	process.exitCode = 1;
} finally {
	await browser.close();
}
