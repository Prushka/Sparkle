import { build } from 'esbuild';
import assert from 'node:assert/strict';
const bundle = await build({
	entryPoints: ['lib/player/raw-hdr.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { planHDR, dolbyVisionMime, compatibleHDR, sourceHDR } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const hevc = 'video/mp4; codecs="hvc1.2.4.L153.B0"';
const base = { id: 1, index: 0, streamType: 1, codec: 'hevc', colorTrc: 'smpte2084' };
const p5 = { ...base, DOVIPresent: true, DOVIProfile: 5, DOVILevel: 6, DOVIBLCompatID: 0 };
const config5 = Uint8Array.from([1, 0, 10, 53, 0]);
assert.equal(compatibleHDR(p5), null);
assert.equal(sourceHDR(p5), 'Dolby Vision Profile 5');
assert.equal(dolbyVisionMime(hevc, p5, config5), 'video/mp4; codecs="dvh1.05.06"');
assert.equal(dolbyVisionMime(hevc, p5), null);
const native5 = await planHDR(p5, hevc, config5, 'auto', true, async (mime) =>
	mime.includes('dvh1.05.06')
);
assert.equal(native5.renderer, 'native');
assert.equal(native5.output, 'Native dynamic HDR (unverified)');
await assert.rejects(
	planHDR(p5, hevc, config5, 'auto', false, async () => false),
	/Dolby-aware/
);
await assert.rejects(
	planHDR({ ...p5, DOVIELPresent: true }, hevc, config5, 'auto', false, async () => false),
	/Dolby-aware/
);
await assert.rejects(
	planHDR(p5, hevc, undefined, 'auto', false, async () => false),
	/Dolby-aware/
);
const p7 = {
	...base,
	DOVIPresent: true,
	DOVIProfile: 7,
	DOVIELPresent: true,
	HDR10PlusPresent: true
};
const probes = [];
const native7 = await planHDR(
	p7,
	hevc,
	Uint8Array.from([1, 0, 14, 55, 96]),
	'auto',
	true,
	async (mime, mode) => {
		probes.push([mime, mode]);
		return mode === 'HDR10';
	}
);
assert.equal(native7.output, 'HDR10');
assert.equal(native7.baseOnly, true);
assert.match(native7.reason, /enhancement layers are not used/);
assert.ok(probes.every(([mime]) => !mime.includes('dvh')));
assert.equal(compatibleHDR({ ...p5, DOVIProfile: 8, DOVIBLCompatID: 4 }), 'HLG');
assert.equal(compatibleHDR({ ...p5, DOVIProfile: 8, DOVIBLCompatID: 0 }), null);
const plus = await planHDR(
	{ ...base, HDR10PlusPresent: true },
	hevc,
	undefined,
	'auto',
	true,
	async (_, mode) => mode === 'HDR10+'
);
assert.equal(plus.output, 'Native dynamic HDR (unverified)');
// Even stale/direct requests for the disabled mode must never activate software.
for (const hdrDisplay of [false, true]) {
	for (const preference of ['auto', 'compatible', 'sdr', 'av1', 'hevc']) {
		for (const track of [base, p7, { ...base, colorTrc: 'arib-std-b67' }]) {
			const plan = await planHDR(track, hevc, undefined, preference, hdrDisplay, async () => true);
			assert.equal(plan.renderer, 'native');
			await assert.rejects(
				planHDR(track, hevc, undefined, preference, hdrDisplay, async () => false),
				/Native HDR playback is unavailable/
			);
		}
	}
}
assert.equal(
	(await planHDR(base, hevc, undefined, 'auto', false, async () => true)).output,
	'SDR tone mapping'
);
console.log(
	'HDR policy: exact Dolby profiles, HDR10+ probes, native output on SDR/HDR displays, no software fallback passed'
);
