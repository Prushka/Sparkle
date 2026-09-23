// Dolby single-layer reshaping for SDR output, using the decoded FFmpeg RPU.
// Layout is pinned to FFmpeg 3a14ab2, wasm32. Verify with dovi-layout.c whenever
// changing decoder ABI. No binary offsets are read before bounds validation.
// Color transforms follow FFmpeg dovi_meta.h and BT.2100/ST2084, with the
// BT.2020 HPE LMS inverse used by libplacebo (LGPL-2.1-or-later).
export function readDovi(data: Uint8Array) {
	const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const bound = (offset: number, size: number) => {
		if (!Number.isInteger(offset) || offset < 0 || offset + size > v.byteLength)
			throw new Error('Invalid Dolby Vision metadata bounds');
		return offset;
	};
	bound(0, 12);
	const h = bound(v.getUint32(0, true), 18);
	const m = bound(v.getUint32(4, true), 5136);
	const c = bound(v.getUint32(8, true), 196);
	const depth = v.getUint8(h + 11),
		denom = v.getUint8(h + 8);
	if (depth < 8 || depth > 16 || denom < 13 || denom > 32 || !v.getUint8(h + 16))
		throw new Error('Unsupported Dolby Vision residual or coefficient format');
	const coefficients = new Float32Array(576),
		pivots = new Float32Array(36),
		counts = new Float32Array(3);
	const readCoefficient = (at: number) => {
		const n = Number(v.getBigInt64(at, true)) / 2 ** denom;
		if (!Number.isFinite(n) || Math.abs(n) > 1e6)
			throw new Error('Invalid Dolby Vision coefficient');
		return n;
	};
	for (let channel = 0; channel < 3; channel++) {
		const curve = m + 8 + channel * 1672,
			count = v.getUint8(curve);
		if (count < 2 || count > 9) throw new Error('Invalid Dolby Vision pivot count');
		counts[channel] = count;
		for (let i = 0; i < count; i++) {
			const pivot = v.getUint16(curve + 2 + i * 2, true) / (2 ** depth - 1);
			if (pivot > 1 || (i > 0 && pivot <= pivots[channel * 12 + i - 1]))
				throw new Error('Invalid Dolby Vision pivots');
			pivots[channel * 12 + i] = pivot;
		}
		for (let i = 0; i < count - 1; i++) {
			const method = v.getInt32(curve + 20 + i * 4, true),
				dst = (channel * 8 + i) * 24;
			if (method === 0) {
				const order = v.getUint8(curve + 52 + i);
				if (order < 1 || order > 2) throw new Error('Invalid Dolby Vision polynomial');
				for (let k = 0; k <= order; k++)
					coefficients[dst + k] = readCoefficient(curve + 64 + (i * 3 + k) * 8);
			} else if (method === 1) {
				const order = v.getUint8(curve + 256 + i);
				if (order < 1 || order > 3) throw new Error('Invalid Dolby Vision MMR order');
				coefficients[dst + 23] = order;
				coefficients[dst] = readCoefficient(curve + 264 + i * 8);
				for (let k = 0; k < order * 7; k++)
					coefficients[dst + 1 + k] = readCoefficient(curve + 328 + (i * 21 + k) * 8);
			} else throw new Error('Unsupported Dolby Vision reshaping method');
		}
	}
	const rational = (at: number) => {
		const den = v.getInt32(at + 4, true),
			value = v.getInt32(at, true) / den;
		if (!den || !Number.isFinite(value) || Math.abs(value) > 128)
			throw new Error('Invalid Dolby Vision color matrix');
		return value;
	};
	const matrix = (offset: number) =>
		Float32Array.from({ length: 9 }, (_, i) =>
			rational(c + offset + ((i % 3) * 3 + Math.floor(i / 3)) * 8)
		);
	return {
		coefficients,
		pivots,
		counts,
		nonlinear: matrix(4),
		linear: matrix(100),
		offset: Float32Array.from({ length: 3 }, (_, i) => rational(c + 76 + i * 8))
	};
}

export type DoviData = ReturnType<typeof readDovi>;
export const doviUniforms = `
uniform vec4 doviCoefficients[144];
uniform vec4 doviPivots[9];
uniform vec3 doviCounts;
uniform mat3 doviNonlinear;
uniform mat3 doviLinearMatrix;
uniform vec3 doviOffset;
float doviPivot(int c, int n) { return doviPivots[c * 3 + n / 4][n % 4]; }
float doviCoefficient(int piece, int n) { return doviCoefficients[piece * 6 + n / 4][n % 4]; }
vec3 doviLinear(vec3 signal) {
  signal = clamp(signal, 0.0, 1.0);
  vec3 reshaped = signal;
  for (int c = 0; c < 3; c++) {
    int count = int(doviCounts[c]);
    int segment = 0;
    for (int i = 1; i < 8; i++) {
      if (i < count - 1 && signal[c] >= doviPivot(c, i)) segment = i;
    }
    int piece = c * 8 + segment;
    int order = int(doviCoefficient(piece, 23));
    float value = doviCoefficient(piece, 0);
    if (order == 0) {
      value += signal[c] * (doviCoefficient(piece, 1) + signal[c] * doviCoefficient(piece, 2));
    } else {
      vec3 p = vec3(1.0);
      for (int k = 0; k < 3; k++) {
        if (k >= order) break;
        p *= signal;
        int n = 1 + k * 7;
        value += p.r * doviCoefficient(piece,n) + p.g * doviCoefficient(piece,n+1)
          + p.b * doviCoefficient(piece,n+2) + p.r*p.g * doviCoefficient(piece,n+3)
          + p.r*p.b * doviCoefficient(piece,n+4) + p.g*p.b * doviCoefficient(piece,n+5)
          + p.r*p.g*p.b * doviCoefficient(piece,n+6);
      }
    }
    reshaped[c] = clamp(value, doviPivot(c,0), doviPivot(c,count-1));
  }
  vec3 pq = max(doviNonlinear * (reshaped - doviOffset), vec3(0.0));
  vec3 p = pow(min(pq,vec3(1.0)),vec3(1.0/78.84375));
  vec3 linear = pow(max(p-vec3(0.8359375),vec3(0.0)) /
    max(vec3(18.8515625)-18.6875*p,vec3(0.000001)),vec3(1.0/0.1593017578125));
  return 10000.0 * max(mat3(3.06441879,-0.65612108,0.01736321,
    -2.16597676,1.78554118,-0.04725154,0.10155818,-0.12943749,1.03004253)
    * doviLinearMatrix * linear, vec3(0.0));
}
`;
