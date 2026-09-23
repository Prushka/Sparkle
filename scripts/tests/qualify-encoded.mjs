import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const base = process.env.SPARKLE_TEST_BACKEND_URL;
const ids = process.env.SPARKLE_ENCODE_TEST_IDS?.split(',').filter(Boolean);
assert.ok(
	base?.startsWith('http') && ids?.length,
	'Set SPARKLE_TEST_BACKEND_URL and SPARKLE_ENCODE_TEST_IDS'
);
const dir = 'cache/encoded-qualification';
await mkdir(dir, { recursive: true });
const report = [];
for (const [index, id] of ids.entries()) {
	const metadata = await (await fetch(`${base}/media/${id}`)).json();
	const part = metadata.Raw.parts[0];
	for (const codec of ['av1', 'hevc']) {
		const path = `${base}${part.url.replace(/\/file$/, '')}/encoded/${codec}`;
		const manifestResponse = await fetch(`${path}/manifest`);
		assert.equal(manifestResponse.status, 200);
		const manifest = await manifestResponse.json();
		const segment = Math.floor(Math.min(part.duration * 0.5, 120) / manifest.segmentSeconds);
		const started = performance.now();
		const fragmentResponse = await fetch(`${path}/video-${segment}.m4s?v=${manifest.fingerprint}`);
		assert.equal(fragmentResponse.status, 200, `${id} ${codec}`);
		const fragment = `${dir}/${index}-${codec}.m4s`;
		await pipeline(Readable.fromWeb(fragmentResponse.body), createWriteStream(fragment));
		const seconds = (performance.now() - started) / 1000;
		const subtitleResponse = await fetch(
			`${path}/subtitles-${segment}.json?v=${manifest.fingerprint}`
		);
		assert.equal(subtitleResponse.status, 200);
		const subtitles = await subtitleResponse.json();
		const initResponse = await fetch(`${path}/video-init.mp4?v=${manifest.fingerprint}`);
		assert.equal(initResponse.status, 200);
		const sample = `${dir}/${index}-${codec}.mp4`;
		await pipeline(Readable.fromWeb(initResponse.body), createWriteStream(sample));
		await pipeline(createReadStream(fragment), createWriteStream(sample, { flags: 'a' }));
		let streams;
		if (process.env.FFPROBE) {
			const output = execFileSync(
				process.env.FFPROBE,
				[
					'-v',
					'error',
					'-show_streams',
					'-read_intervals',
					'%+#1',
					'-show_packets',
					'-of',
					'json',
					sample
				],
				{ windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
			);
			const data = JSON.parse(output);
			streams = data.streams.map(
				({ codec_name, pix_fmt, color_space, color_transfer, color_primaries }) => ({
					codec_name,
					pix_fmt,
					color_space,
					color_transfer,
					color_primaries
				})
			);
			assert.equal(streams[0].codec_name, codec);
			assert.match(streams[0].pix_fmt, /10/);
			if (manifest.output === 'HDR10') assert.equal(streams[0].color_transfer, 'smpte2084');
			if (manifest.output === 'HLG') assert.equal(streams[0].color_transfer, 'arib-std-b67');
			assert.ok(
				Math.abs(Number(data.packets[0].pts_time) - segment * manifest.segmentSeconds) < 0.2,
				'fragment timestamp does not match room timeline'
			);
		}
		const fonts = manifest.hasFonts
			? await (await fetch(`${path}/fonts.json?v=${manifest.fingerprint}`)).json()
			: [];
		const item = {
			id,
			codec,
			output: manifest.output,
			seconds,
			segment,
			bytes: Number(fragmentResponse.headers.get('content-length')),
			fonts: fonts.length,
			subtitleTracks: subtitles.tracks.length,
			subtitlePackets: subtitles.packets.length,
			streams
		};
		report.push(item);
		console.log(JSON.stringify(item));
	}
}
await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
