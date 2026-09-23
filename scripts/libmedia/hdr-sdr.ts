// Sparkle's SDR-only shader. Input is the original normalized integer YUV;
// output is full-range sRGB. Native HDR must never use this canvas renderer.
// ST 2084 / BT.2100 transfer functions and BT.2020 / BT.709 D65 primaries.
// No frame history, readback, LUT allocation or server processing is involved.
export function hdrSDRShader(transfer: number, depth: number, fullRange: boolean, dolby = false) {
	if (![16, 18].includes(transfer) || depth < 9 || depth > 16)
		throw new Error('Unsupported software HDR color representation');
	const max = 2 ** depth - 1,
		scale = 2 ** (depth - 8);
	const yOffset = fullRange ? 0 : (16 * scale) / max;
	const yScale = fullRange ? 1 : max / (219 * scale);
	const uvOffset = (128 * scale) / max;
	const uvScale = fullRange ? 1 : max / (224 * scale);
	return `${
		dolby
			? 'vec3 rgb = doviLinear(color.rgb);'
			: `
    vec3 yuv = (color.rgb - vec3(${yOffset}, ${uvOffset}, ${uvOffset})) * vec3(${yScale}, ${uvScale}, ${uvScale});
    vec3 rgb = max(vec3(yuv.x + 1.4746 * yuv.z,
      yuv.x - 0.1645531268 * yuv.y - 0.5713531268 * yuv.z,
      yuv.x + 1.8814 * yuv.y), vec3(0.0));
    ${
			transfer === 16
				? `
      vec3 p = pow(min(rgb, vec3(1.0)), vec3(1.0 / 78.84375));
      rgb = 10000.0 * pow(max(p - vec3(0.8359375), vec3(0.0)) /
        max(vec3(18.8515625) - 18.6875 * p, vec3(0.000001)), vec3(1.0 / 0.1593017578125));
    `
				: `
      rgb = mix(rgb * rgb / 3.0,
        (exp((rgb - vec3(0.55991073)) / 0.17883277) + 0.28466892) / 12.0,
        greaterThan(rgb, vec3(0.5)));
      rgb *= 1000.0 * pow(max(dot(rgb, vec3(0.2627, 0.6780, 0.0593)), 0.0), 0.2);
    `
		}
    `
	}
    // A monotonic, hue-preserving shoulder retains detail up to 10,000 nits.
    // It deliberately does not depend on absent or inaccurate MaxCLL tags.
    rgb /= 203.0;
    rgb /= 1.0 + max(max(rgb.r, rgb.g), rgb.b);
    rgb = mat3(1.660491, -0.124550, -0.018151,
      -0.587641, 1.132900, -0.100579,
      -0.072850, -0.008349, 1.118730) * rgb;
    // Bring out-of-gamut chroma towards the neutral axis, avoiding per-channel
    // clipping that changes the hue of saturated BT.2020 highlights.
    float luma = clamp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    vec3 delta = rgb - vec3(luma);
    vec3 limits = mix(vec3(luma) / max(-delta, vec3(0.000001)),
      vec3(1.0 - luma) / max(delta, vec3(0.000001)), greaterThan(delta, vec3(0.0)));
    rgb = vec3(luma) + delta * min(1.0, min(min(limits.r, limits.g), limits.b));
    rgb = max(rgb, vec3(0.0));
    color.rgb = mix(12.92 * rgb, 1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055,
      greaterThan(rgb, vec3(0.0031308)));
  `;
}
