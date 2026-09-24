import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = await build({
	entryPoints: ['scripts/libmedia/playback-bitrate.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { default: Meter } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const meter = new Meter();
// The same packet timeline arrives in one network burst. Reading must still
// report compressed media bitrate rather than download bytes per wall second.
for (let second = 0; second < 20; second++) {
	meter.add(1, second * 1000, 125_000);
	meter.add(2, second * 1000, 16_000);
}
assert.equal(meter.read(1, 4500), 1_000_000);
assert.equal(meter.read(2, 4500), 128_000);
assert.equal(meter.read(1, 0), undefined);
assert.equal(meter.read(3, 4000), undefined);
assert.equal(meter.read(1, 25000), undefined);
// Seek backwards uses the new meter; it cannot reuse a stale window.
assert.equal(new Meter().read(1, 4000), undefined);
for (let i = 20; i < 10000; i++) meter.add(1, i * 1000, 250_000);
assert.equal(meter.read(1, 9999000), 2_000_000);
assert.equal(meter.read(1, 4000), undefined);
assert.equal(meter.tracks.get(1).size, 120);
for (let i = 0; i < 100; i++) meter.add(i, 0, 1);
assert.equal(meter.tracks.size, 8);
console.log(
	'Playback bitrate: media clock, selected tracks, startup, seek and bounded storage passed'
);
