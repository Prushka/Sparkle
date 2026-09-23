import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
	entryPoints: ['scripts/libmedia/hdr-metadata.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { hevcHDRBoxes } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
// Includes zero runs requiring emulation-prevention removal and byte-exact units.
const mastering = Uint8Array.from([
	51, 194, 134, 196, 29, 76, 11, 184, 132, 208, 62, 128, 61, 19, 64, 66, 0, 152, 150, 128, 0, 0, 0,
	50
]);
const light = Uint8Array.from([4, 63, 1, 99]);
function escape(bytes) {
	const out = [];
	let zeros = 0;
	for (const b of bytes) {
		if (zeros >= 2 && b <= 3) {
			out.push(3);
			zeros = 0;
		}
		out.push(b);
		zeros = b === 0 ? zeros + 1 : 0;
	}
	return out;
}
const sei = Uint8Array.from([78, 1, ...escape([137, 24, ...mastering, 144, 4, ...light, 128])]);
const config = new Uint8Array(23);
config[0] = 1;
config[21] = 3;
function sample(nal, width = 4) {
	const length = Array.from(
		{ length: width },
		(_, i) => (nal.length >> ((width - i - 1) * 8)) & 255
	);
	return Uint8Array.from([...length, ...nal]);
}
const expected = { mdcv: mastering, clli: light };
assert.deepEqual(hevcHDRBoxes(config, sample(sei)), expected);
assert.deepEqual(
	hevcHDRBoxes(new Uint8Array(), Uint8Array.from([0, 0, 0, 1, ...sei]), true),
	expected
);
const hvcc = Uint8Array.from([...config, 39, 0, 1, sei.length >> 8, sei.length & 255, ...sei]);
hvcc[22] = 1;
assert.deepEqual(hevcHDRBoxes(hvcc), expected);
for (let width = 1; width <= 4; width++) {
	const c = config.slice();
	c[21] = width - 1;
	assert.deepEqual(hevcHDRBoxes(c, sample(sei, width)), expected);
}
// A length prefix that resembles an Annex B start code must not be misdetected.
const picture = new Uint8Array(0x120);
picture[0] = 38;
picture[1] = 1;
const packets = Uint8Array.from([...sample(picture), ...sample(sei)]);
const original = packets.slice();
assert.deepEqual(hevcHDRBoxes(config, packets), expected);
assert.deepEqual(packets, original);
assert.deepEqual(hevcHDRBoxes(config, Uint8Array.from([255, 255, 255, 255])), {});
assert.deepEqual(hevcHDRBoxes(config, sample(Uint8Array.from([78, 1, 137, 24, 1, 2]))), {});
const annexB = Uint8Array.from([0, 0, 0, 1, ...sei]);
for (let i = 0; i < annexB.length; i++)
	assert.doesNotThrow(() => hevcHDRBoxes(new Uint8Array(), annexB.subarray(0, i), true));
for (let i = 0; i < hvcc.length; i++) assert.doesNotThrow(() => hevcHDRBoxes(hvcc.subarray(0, i)));
console.log(
	'HEVC static HDR: hvcC, samples, Annex B, exact mastering/light levels and malformed input passed'
);
