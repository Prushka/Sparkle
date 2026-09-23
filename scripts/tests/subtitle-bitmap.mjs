import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
const bundle = await build({
	stdin: {
		contents:
			"export * from './lib/suptitles/segments'; export * from './lib/suptitles/bitmap'; export * from './lib/player/raw-text-subtitles';",
		resolveDir: process.cwd()
	},
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const {
	BaseSegment,
	ObjectDefinitionSegment,
	assembleObjects,
	decodeBitmap,
	Palette,
	decodeRawTextSubtitle
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
function segment(payload) {
	const bytes = Uint8Array.from([
		80,
		71,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		21,
		payload.length >> 8,
		payload.length & 255,
		...payload
	]);
	return new ObjectDefinitionSegment(new BaseSegment(bytes));
}
const fragments = [
	segment([0, 1, 0, 128, 0, 0, 8, 0, 2, 0, 1, 1]),
	segment([0, 1, 0, 0, 1]),
	segment([0, 1, 0, 64, 0, 0])
];
const [bitmap] = assembleObjects(fragments);
assert.equal(bitmap.width, 2);
assert.equal(bitmap.height, 1);
assert.deepEqual([...bitmap.imgData], [1, 1, 0, 0]);
const colors = [new Palette(16, 128, 128, 0), new Palette(235, 128, 128, 255)];
assert.deepEqual(
	[...decodeBitmap(bitmap.imgData, colors, 2, 1)],
	[255, 255, 255, 255, 255, 255, 255, 255]
);
assert.throws(() => decodeBitmap(Uint8Array.from([0, 255, 255, 1]), colors, 2, 1));
assert.throws(() => decodeBitmap(Uint8Array.from([0, 128]), colors, 2, 1));
assert.throws(() => decodeBitmap(new Uint8Array(), colors, 65535, 65535));
assert.equal(assembleObjects(fragments.slice(0, 2)).length, 0);
assert.throws(() =>
	assembleObjects([...fragments, fragments[0], fragments[1], fragments[1], fragments[2]])
);
console.log('PGS fragment assembly, bitmap colors, truncation and allocation bounds passed');
const encoded = new TextEncoder().encode('Hello <i>world</i>');
assert.equal(
	decodeRawTextSubtitle(
		0x17005,
		Uint8Array.from([0, encoded.length, ...encoded, 0, 0, 0, 8, 115, 116, 121, 108])
	),
	'Hello world'
);
assert.equal(
	decodeRawTextSubtitle(0x17005, Uint8Array.from([0, 6, 0xfe, 0xff, 0x65, 0xe5, 0x67, 0x2c])),
	'日本'
);
assert.equal(decodeRawTextSubtitle(0x17005, Uint8Array.from([0, 30, 65])), '');
assert.equal(decodeRawTextSubtitle(0x17005, Uint8Array.from([0, 0])), '');
assert.equal(
	decodeRawTextSubtitle(0x17011, new TextEncoder().encode('A &amp; B<br>C')),
	'A & B\nC'
);
console.log('MP4 text lengths, style-box exclusion, Unicode and truncated packets passed');
