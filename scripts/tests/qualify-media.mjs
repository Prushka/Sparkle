// Opt-in real-file qualification. IDs come from your app API; never supply paths
// or Plex tokens. Keeps reads in the browser and saves only test evidence.
import { chromium, firefox } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SPARKLE_TEST_URL || 'http://127.0.0.1:3002';
const backend = new URL(process.env.SPARKLE_TEST_BACKEND_URL || '/be', base).href.replace(
	/\/$/,
	''
);
const fixtures = JSON.parse(process.env.SPARKLE_MEDIA_FIXTURES || '[]');
if (!fixtures.length)
	throw new Error('Set SPARKLE_MEDIA_FIXTURES to [{id, seekSeconds, subtitleCodec}]');
const bundle = await build({
	entryPoints: ['lib/player/raw-subtitles.ts'],
	bundle: true,
	write: false,
	format: 'iife',
	globalName: 'RawSubtitleModule',
	platform: 'browser'
});
const browser =
	process.env.SPARKLE_TEST_CHANNEL === 'firefox'
		? await firefox.launch({ headless: true, firefoxUserPrefs: { 'media.autoplay.default': 0 } })
		: await chromium.launch({
				channel: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
				headless: true,
				args: ['--autoplay-policy=no-user-gesture-required']
			});
const results = [];
for (const fixture of fixtures) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	let rawBytes = 0,
		unboundedReads = 0;
	page.on('pageerror', (e) => errors.push(e.stack));
	if (process.env.SPARKLE_TEST_DEBUG)
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') console.log(m.text().slice(0, 600));
		});
	page.on('response', (r) => {
		if (r.url().includes('/parts/') && r.request().method() === 'GET') {
			rawBytes += Number(r.headers()['content-length'] || 0);
			if (r.request().method() === 'GET' && !r.request().headers()['range']) unboundedReads++;
		}
	});
	try {
		await page.goto(`${base}/vendor/libmedia/1.3.1/avplayer.js`);
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		const metadata = await (await page.request.get(`${backend}/media/${fixture.id}`)).json();
		const part = metadata.Raw.parts[0];
		const result = await page.evaluate(
			async ({ url, fixture }) => {
				document.body.innerHTML =
					'<div id="media" style="position:relative;width:960px;height:540px;background:black"></div>';
				const element = document.querySelector('#media');
				const { default: AVPlayer } = await import('/vendor/libmedia/1.3.1/avplayer.js');
				const renderer = new RawSubtitleModule.RawSubtitles(element);
				let pgsPixels = 0;
				const subtitleErrors = [];
				const renderPGS = renderer.renderPGS.bind(renderer);
				renderer.renderPGS = (packet) => {
					try {
						renderPGS(packet);
						const pixels = renderer.canvas
							.getContext('2d')
							.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
						let visible = 0;
						for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
						pgsPixels = Math.max(pgsPixels, visible);
					} catch (e) {
						subtitleErrors.push(e.message);
						throw e;
					}
				};
				let packets = 0;
				const sink = {
					...renderer.sink,
					packet(...args) {
						packets++;
						renderer.sink.packet(...args);
					}
				};
				const player = (window.fixturePlayer = new AVPlayer({
					container: element,
					wasmBaseUrl: '/vendor/libmedia/1.3.1',
					enableWorker: true,
					enableWebGPU: false,
					enableHardware: true,
					enableWebCodecs: true,
					enableAudioWorklet: true,
					subtitleSink: sink,
					preLoadTime: 4
				}));
				await player.load(url, {
					ext: 'mkv',
					maxProbeDuration: 3,
					ioLoaderOptions: { preload: 4194304 }
				});
				const fonts = player.getEmbeddedFonts();
				renderer.setFonts(fonts);
				const streams = player.getStreams().map((s) => ({
					id: s.id,
					type: s.mediaType,
					codec: s.codecparProxy.codecId,
					transfer: s.codecparProxy.colorTrc
				}));
				if (streams.some((s) => s.type === 'Video' && [16, 18].includes(s.transfer)))
					throw new Error('HDR fixture requires the native-path qualification test');
				await player.play();
				if (fixture.subtitleCodec) {
					const sub = streams.find((s) => s.codec === fixture.subtitleCodec);
					if (!sub) throw new Error('Requested subtitle codec absent');
					await player.selectSubtitle(sub.id);
				}
				if (fixture.audioCodec) {
					const audio = streams.find((s) => s.codec === fixture.audioCodec);
					if (!audio) throw new Error('Requested audio codec absent');
					await player.selectAudio(audio.id);
				}
				const layers = [];
				if (fixture.subtitleLayers) {
					await player.setSubtitleLayers(
						fixture.subtitleLayers.map((id, index) => {
							const layer = new RawSubtitleModule.RawSubtitles(element, index + 1);
							layer.setFonts(fonts);
							const entry = { id, renderer: layer, packets: 0 };
							layers.push(entry);
							return {
								id,
								sink: {
									...layer.sink,
									packet(...args) {
										entry.packets++;
										layer.sink.packet(...args);
									}
								}
							};
						})
					);
				}
				if (fixture.subtitleId !== undefined) await player.selectSubtitle(fixture.subtitleId);
				if (fixture.seekSeconds) await player.seek(BigInt(fixture.seekSeconds * 1000));
				const initial = Number(player.currentTime);
				await new Promise((r) => setTimeout(r, 5000));
				const advanced = Number(player.currentTime) - initial;
				await player.pause();
				const paused = Number(player.currentTime);
				await new Promise((r) => setTimeout(r, 700));
				return {
					streams,
					fonts: fonts.length,
					packets,
					advanced,
					pausedDrift: Number(player.currentTime) - paused,
					mse: player.isMSE(),
					isolated: crossOriginIsolated,
					subtitleCodec: renderer.codec,
					assReady: renderer.assReady,
					subtitlePixels: pgsPixels,
					textVisible: !!renderer.text.textContent,
					subtitleErrors,
					layers: layers.map((l) => ({
						id: l.id,
						packets: l.packets,
						assReady: l.renderer.assReady,
						textVisible: !!l.renderer.text.textContent
					}))
				};
			},
			{ url: `${backend}${part.url}`, fixture }
		);
		await page.screenshot({ path: `cache/qualification-${results.length}.png` });
		results.push({ fixture: fixture.id, ...result, rawBytes, unboundedReads, errors });
	} catch (e) {
		results.push({ fixture: fixture.id, error: e.message, rawBytes, unboundedReads, errors });
	}
	console.log(JSON.stringify(results.at(-1)));
	await context.close();
}
await browser.close();
await mkdir('cache', { recursive: true });
await writeFile('cache/media-qualification.json', JSON.stringify(results, null, 2));
if (
	results.some(
		(r) =>
			r.error ||
			r.advanced < 2000 ||
			Math.abs(r.pausedDrift) > 1000 ||
			r.unboundedReads ||
			r.errors.length ||
			r.subtitleErrors?.length
	)
)
	process.exitCode = 1;
