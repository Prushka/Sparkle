// Web Audio speaker order, and conventional FFmpeg/WAVE order for 5.0/6.1/7.1.
// Lo/Ro downmix: center feeds both fronts; surrounds stay on their own side.
// LFE is omitted, as in the Web Audio 5.1 -> stereo matrix. Main-channel bass
// remains. 6.1 back center feeds both sides at -6 dB; 7.1 includes both pairs.
const q = Math.SQRT1_2;
const matrices = [
	null,
	[[1], [1]],
	[
		[1, 0],
		[0, 1]
	],
	[
		[1, 0, q],
		[0, 1, q]
	],
	[
		[0.5, 0, 0.5, 0],
		[0, 0.5, 0, 0.5]
	],
	[
		[1, 0, q, q, 0],
		[0, 1, q, 0, q]
	],
	[
		[1, 0, q, 0, q, 0],
		[0, 1, q, 0, 0, q]
	],
	[
		[1, 0, q, 0, 0.5, q, 0],
		[0, 1, q, 0, 0.5, 0, q]
	],
	[
		[1, 0, q, 0, q, 0, q, 0],
		[0, 1, q, 0, 0, q, 0, q]
	]
];

/** Writes into reusable two-channel buffers without queuing or clipping PCM. */
export function mixStereo(input, stereo) {
	const matrix = matrices[input.length];
	for (let side = 0; side < 2; side++) {
		const out = stereo[side];
		out.fill(0);
		if (!matrix) continue;
		for (let channel = 0; channel < input.length; channel++) {
			const weight = matrix[side][channel];
			if (!weight) continue;
			for (let i = 0; i < out.length; i++) out[i] += input[channel][i] * weight;
		}
	}
	return !!matrix;
}
