import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

await import('../audio/prepare.mjs');
const code = readFileSync('public/vendor/libmedia/audio/normalize-v1.js', 'utf8');
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
	const output = input.map(() => new Float32Array(128));
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

const start = performance.now();
for (const channels of [1, 2, 5, 6, 8]) {
	const f = fixture(channels);
	f.run(0.2);
	for (let c = 0; c < channels; c++)
		assert.deepEqual(f.output[c], f.input[c], 'default off is bit-exact');
	f.message({ type: 'configure', enabled: true, volume: 1 });
	f.run(16);
	const ratio = f.output[0][5] / f.input[0][5];
	assert.ok(
		Math.abs(ratio - 1) > 0.04 && ratio <= 4,
		`${channels} channels actually change level: ${ratio}`
	);
	for (let c = 0; c < channels; c++) {
		assert.ok(
			Math.abs(f.output[c][5] / f.input[c][5] - ratio) < 0.00001,
			'linked gain preserves channel balance, including LFE'
		);
		assert.equal(f.output[c].length, f.input[c].length, 'no latency or dropped/extra samples');
	}
	const weights =
		channels === 6
			? [1, 1, 1, 0, 1.41, 1.41]
			: channels === 8
				? [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41]
				: channels === 5
					? [1, 1, 1, 1.41, 1.41]
					: Array(channels).fill(1);
	const expectedLUFS =
		-3.003 +
		10 * Math.log10(weights.reduce((sum, w, c) => sum + w * (0.05 * (1 + c * 0.07)) ** 2, 0));
	assert.ok(
		Math.abs(f.processor.views[0][3] - expectedLUFS) < 0.12,
		'BS.1770 calibrated 1 kHz reference'
	);
	assert.ok(Math.abs(expectedLUFS + 20 * Math.log10(ratio) + 18) < 0.15, 'converges to -18 LUFS');
	f.message({ type: 'configure', enabled: false });
	f.run(0.15);
	for (let c = 0; c < channels; c++)
		assert.deepEqual(f.output[c], f.input[c], 'turning off restores original samples');
	f.message({ type: 'configure', enabled: true });
	f.run(0.6, 0.00001);
	assert.ok(f.processor.target <= 4, 'silence cannot trigger excessive boost');
	console.log(
		`${channels} channels: ${expectedLUFS.toFixed(2)} LUFS → ${(expectedLUFS + 20 * Math.log10(ratio)).toFixed(2)} LUFS; bypass, balance and timing passed`
	);
}
// LFE-only impulses must be limited even though LFE is excluded from loudness.
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
peak.input[3][3] = 0.99;
peak.processor.process([peak.input], [peak.output]);
assert.ok(Math.abs(peak.output[3][3]) <= 10 ** (-2 / 20) + 1e-6, 'LFE peak guard');
assert.ok(
	peak.output.every((c) => c.every(Number.isFinite)),
	'finite output'
);
// Unknown layouts must transparently bypass.
const unknown = fixture(4);
unknown.message({ type: 'configure', enabled: true });
unknown.run(0.1);
assert.deepEqual(unknown.input, unknown.output);
const sample441 = fixture(2, 44100);
sample441.message({ type: 'configure', enabled: true });
sample441.run(10);
assert.ok(sample441.processor.gain > 1.5, '44.1 kHz supported');
sample441.message({ type: 'dispose' });
assert.equal(sample441.processor.process([sample441.input], [sample441.output]), false);
console.log(
	`Audio normalization DSP checks passed (${Math.round(performance.now() - start)} ms for >100 seconds of multichannel audio)`
);
