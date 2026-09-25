import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

await import('../audio/prepare.mjs');
const code = readFileSync('public/vendor/libmedia/audio/normalize-v2.js', 'utf8');
function fixture(channels, rate = 48000) {
	let Processor;
	const scope = vm.createContext({
		Float32Array,
		Uint32Array,
		Math,
		Number,
		currentTime: 0,
		currentFrame: 0,
		sampleRate: rate,
		AudioWorkletProcessor: class {
			port = { postMessage() {}, onmessage: undefined };
		},
		registerProcessor(name, value) {
			if (name === 'sparkle-normalize') Processor = value;
		}
	});
	vm.runInContext(code, scope);
	const processor = new Processor({ numberOfInputs: 1 });
	const input = Array.from({ length: channels }, () => new Float32Array(128));
	const output = [new Float32Array(128), new Float32Array(128)];
	return {
		processor,
		input,
		output,
		scope,
		message(data) {
			processor.port.onmessage({ data });
		},
		run(seconds, amplitude = 0.05) {
			for (let n = 0; n < Math.ceil((seconds * rate) / 128); n++) {
				for (let c = 0; c < channels; c++)
					for (let i = 0; i < 128; i++)
						input[c][i] =
							amplitude *
							(1 + c * 0.07) *
							Math.sin((2 * Math.PI * 1000 * (scope.currentFrame + i)) / rate);
				assert.equal(processor.process([input], [output]), true);
				scope.currentFrame += 128;
				scope.currentTime = scope.currentFrame / rate;
			}
		}
	};
}

// Independent channel impulse expectations, not just a channel-count assertion.
// Center must reach both sides; LFE must not; side/back channels stay on-side.
const q = Math.SQRT1_2;
const expected = {
	1: [[1, 1]],
	2: [
		[1, 0],
		[0, 1]
	],
	3: [
		[1, 0],
		[0, 1],
		[q, q]
	],
	4: [
		[0.5, 0],
		[0, 0.5],
		[0.5, 0],
		[0, 0.5]
	],
	5: [
		[1, 0],
		[0, 1],
		[q, q],
		[q, 0],
		[0, q]
	],
	6: [
		[1, 0],
		[0, 1],
		[q, q],
		[0, 0],
		[q, 0],
		[0, q]
	],
	7: [
		[1, 0],
		[0, 1],
		[q, q],
		[0, 0],
		[0.5, 0.5],
		[q, 0],
		[0, q]
	],
	8: [
		[1, 0],
		[0, 1],
		[q, q],
		[0, 0],
		[q, 0],
		[0, q],
		[q, 0],
		[0, q]
	]
};
for (const [count, speakers] of Object.entries(expected)) {
	const f = fixture(Number(count));
	for (let channel = 0; channel < speakers.length; channel++) {
		f.input.forEach((c) => c.fill(0));
		f.input[channel][17] = 0.25;
		f.processor.process([f.input], [f.output]);
		for (let side = 0; side < 2; side++) {
			assert.ok(
				Math.abs(f.output[side][17] - speakers[channel][side] * 0.25) < 1e-7,
				`${count}ch speaker ${channel} reaches correct stereo side ${side}`
			);
			assert.equal(f.output[side][16], 0);
			assert.equal(f.output[side][18], 0, 'mix adds no sample delay');
		}
	}
}
const start = performance.now();
for (const channels of [1, 2, 3, 4, 5, 6, 7, 8]) {
	const f = fixture(channels);
	f.message({ type: 'configure', enabled: true, volume: 1 });
	f.run(16);
	const ratio = f.output[0][5] / f.processor.stereo[0][5];
	assert.ok(
		Math.abs(ratio - 1) > 0.04 && ratio <= 4,
		`${channels} channels actually change level: ${ratio}`
	);
	for (let c = 0; c < 2; c++) {
		assert.ok(
			Math.abs(f.output[c][5] / f.processor.stereo[c][5] - ratio) < 0.00001,
			'linked gain preserves stereo balance'
		);
		assert.equal(f.output[c].length, f.input[0].length, 'no latency or dropped/extra samples');
	}
	const amplitude = [0, 1].map((side) =>
		expected[channels].reduce((sum, weights, c) => sum + weights[side] * 0.05 * (1 + c * 0.07), 0)
	);
	const expectedLUFS = -3.003 + 10 * Math.log10(amplitude[0] ** 2 + amplitude[1] ** 2);
	assert.ok(
		Math.abs(f.processor.views[0][3] - expectedLUFS) < 0.12,
		'BS.1770 calibrated 1 kHz reference'
	);
	assert.ok(Math.abs(expectedLUFS + 20 * Math.log10(ratio) + 18) < 0.15, 'converges to -18 LUFS');
	f.message({ type: 'configure', enabled: false });
	f.run(0.15);
	for (let c = 0; c < 2; c++)
		assert.deepEqual(f.output[c], f.processor.stereo[c], 'worklet releases gain to unity');
	f.message({ type: 'configure', enabled: true });
	f.run(0.6, 0.00001);
	assert.ok(f.processor.target <= 4, 'silence cannot trigger excessive boost');
	console.log(
		`${channels} → stereo: ${expectedLUFS.toFixed(2)} LUFS → ${(expectedLUFS + 20 * Math.log10(ratio)).toFixed(2)} LUFS; matrix, balance and timing passed`
	);
}
// Loud stereo is attenuated, and the post-mix guard catches correlated peaks.
const loud = fixture(2);
loud.message({ type: 'configure', enabled: true });
loud.run(12, 0.5);
const loudGain = loud.output[0][5] / loud.input[0][5];
assert.ok(loudGain < 0.4, 'loud material is attenuated, not only boosted');
assert.ok(Math.abs(loud.processor.views[0][3] + 20 * Math.log10(loudGain) + 18) < 0.15);
loud.message({ type: 'configure', enabled: false });
loud.run(0.15, 0.5);
assert.deepEqual(loud.input, loud.output, 'off also restores previously attenuated material');

const peak = fixture(6);
peak.message({ type: 'configure', enabled: true });
peak.run(8);
peak.input.forEach((c) => c.fill(0));
peak.input.forEach((c) => (c[3] = 0.99));
peak.processor.process([peak.input], [peak.output]);
assert.ok(
	peak.output.every((c) => Math.abs(c[3]) <= 10 ** (-2 / 20) + 1e-6),
	'post-downmix peak guard'
);
assert.ok(
	peak.output.every((c) => c.every(Number.isFinite)),
	'finite output'
);
// Unknown layouts are reported unavailable so the graph restores its dry route.
const unknown = fixture(9);
unknown.message({ type: 'configure', enabled: true });
unknown.run(0.1);
assert.ok(unknown.output.every((c) => c.every((x) => x === 0)));
// Correlated antiphase channels must cancel before loudness is measured.
const cancellation = fixture(6);
cancellation.input.forEach((c) => c.fill(0));
cancellation.input[0].fill(-q * 0.1);
cancellation.input[2].fill(0.1);
cancellation.processor.process([cancellation.input], [cancellation.output]);
assert.ok(cancellation.output[0].every((x) => Math.abs(x) < 1e-7));
assert.ok(cancellation.output[1].every((x) => Math.abs(x - q * 0.1) < 1e-7));
const sample441 = fixture(2, 44100);
sample441.message({ type: 'configure', enabled: true });
sample441.run(10);
assert.ok(sample441.processor.gain > 1.5, '44.1 kHz supported');
sample441.message({ type: 'dispose' });
assert.equal(sample441.processor.process([sample441.input], [sample441.output]), false);
console.log(
	`Audio normalization DSP checks passed (${Math.round(performance.now() - start)} ms for >100 seconds of multichannel audio)`
);
