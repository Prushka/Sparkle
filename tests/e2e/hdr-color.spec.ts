import { test, expect } from '@playwright/test';
import { hdrSDRShader } from '../../scripts/libmedia/hdr-sdr';
import { readDovi, doviUniforms } from '../../scripts/libmedia/dovi-sdr';

test('SDR shader renders PQ/HLG reference levels, legal range and highlights', async ({ page }) => {
	const cases = [16, 18].flatMap((transfer) =>
		[10, 12].flatMap((depth) =>
			[false, true].map((full) => ({
				transfer,
				depth,
				full,
				shader: hdrSDRShader(transfer, depth, full)
			}))
		)
	);
	const result = await page.evaluate((cases) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
		if (!gl) throw new Error('WebGL2 unavailable');
		const compile = (type: number, source: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, source);
			gl.compileShader(s);
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
			return s;
		};
		const rows = [];
		for (const c of cases) {
			const program = gl.createProgram()!;
			gl.attachShader(
				program,
				compile(
					gl.VERTEX_SHADER,
					'#version 300 es\nvoid main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.0-1.0,float(gl_VertexID&2)*2.0-1.0,0,1);}'
				)
			);
			gl.attachShader(
				program,
				compile(
					gl.FRAGMENT_SHADER,
					`#version 300 es\nprecision highp float;uniform vec3 sampleYUV;out vec4 pixel;void main(){vec4 color=vec4(sampleYUV,1);${c.shader}pixel=color;}`
				)
			);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS))
				throw new Error(gl.getProgramInfoLog(program)!);
			gl.useProgram(program);
			const max = 2 ** c.depth - 1,
				scale = 2 ** (c.depth - 8);
			const draw = (signal: number, u = 0, v = 0) => {
				gl.uniform3fv(gl.getUniformLocation(program, 'sampleYUV'), [
					c.full ? signal : ((16 + 219 * signal) * scale) / max,
					(128 * scale) / max + u * (c.full ? 1 : (224 * scale) / max),
					(128 * scale) / max + v * (c.full ? 1 : (224 * scale) / max)
				]);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				const p = new Uint8Array(4);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
				return [...p];
			};
			// Independent published ST2084 code values: 100/1000/4000/10000 nits.
			const signals =
				c.transfer === 16 ? [0, 0.5080784, 0.7518271, 0.9025724, 1] : [0, 0.5, 0.75, 0.9, 1];
			rows.push({
				...c,
				shader: undefined,
				neutral: signals.map((s) => draw(s)),
				saturated: draw(0.6, 0.25, -0.2)
			});
			gl.deleteProgram(program);
		}
		return rows;
	}, cases);
	for (const row of result) {
		expect(row.neutral[0]).toEqual([0, 0, 0, 255]);
		let last = -1;
		for (const p of row.neutral) {
			expect(Math.max(...p.slice(0, 3)) - Math.min(...p.slice(0, 3))).toBeLessThanOrEqual(1);
			expect(p[0]).toBeGreaterThan(last);
			last = p[0];
		}
		// 100 nits / (203 + 100) mapped through sRGB is approximately 155/255.
		if (row.transfer === 16) expect(row.neutral[1][0]).toBeCloseTo(155, 0);
		expect(row.neutral.at(-1)![0]).toBeLessThan(255);
		expect(new Set(row.saturated.slice(0, 3)).size).toBeGreaterThan(1);
	}
});

test('Dolby RPU bounds, polynomial/MMR reshaping and per-frame matrix uniforms', async ({
	page
}) => {
	const bytes = new Uint8Array(5372),
		v = new DataView(bytes.buffer);
	v.setUint32(0, 16, true);
	v.setUint32(4, 40, true);
	v.setUint32(8, 5176, true);
	bytes[24] = 13;
	bytes[27] = 10;
	bytes[32] = 1;
	for (let c = 0; c < 3; c++) {
		const curve = 48 + c * 1672;
		bytes[curve] = 2;
		v.setUint16(curve + 4, 1023, true);
		if (c === 1) {
			// Third-order MMR with the known identity coefficient.
			v.setInt32(curve + 20, 1, true);
			bytes[curve + 256] = 3;
			v.setBigInt64(curve + 328 + 8, 8192n, true);
		} else {
			bytes[curve + 52] = 2;
			v.setBigInt64(curve + 64 + 8, 8192n, true);
		}
	}
	for (const at of [5180, 5276])
		for (let i = 0; i < 9; i++) {
			v.setInt32(at + i * 8, i % 4 === 0 ? 1 : 0, true);
			v.setInt32(at + i * 8 + 4, 1, true);
		}
	for (let i = 0; i < 3; i++) v.setInt32(5252 + i * 8 + 4, 1, true);
	const data = readDovi(bytes);
	expect(() => readDovi(bytes.slice(0, 100))).toThrow(/bounds/);
	const broken = bytes.slice();
	broken[48] = 255;
	expect(() => readDovi(broken)).toThrow(/pivot count/);
	broken.set(bytes);
	broken[32] = 0;
	expect(() => readDovi(broken)).toThrow(/residual/);
	const shader = hdrSDRShader(16, 10, true, true);
	const pixels = await page.evaluate(
		({ data, shader, uniforms }) => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 1;
			const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
			const p = gl.createProgram()!;
			for (const [kind, source] of [
				[
					gl.VERTEX_SHADER,
					'#version 300 es\nvoid main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.0-1.0,float(gl_VertexID&2)*2.0-1.0,0,1);}'
				],
				[
					gl.FRAGMENT_SHADER,
					`#version 300 es\nprecision highp float;${uniforms}\nout vec4 pixel;void main(){vec4 color=vec4(0.5080784,0.5080784,0.5080784,1);${shader}pixel=color;}`
				]
			] as const) {
				const s = gl.createShader(kind)!;
				gl.shaderSource(s, source);
				gl.compileShader(s);
				if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
				gl.attachShader(p, s);
			}
			gl.linkProgram(p);
			if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)!);
			gl.useProgram(p);
			gl.uniform4fv(gl.getUniformLocation(p, 'doviCoefficients'), data.coefficients);
			gl.uniform4fv(gl.getUniformLocation(p, 'doviPivots'), data.pivots);
			gl.uniform3fv(gl.getUniformLocation(p, 'doviCounts'), data.counts);
			gl.uniform3fv(gl.getUniformLocation(p, 'doviOffset'), data.offset);
			gl.uniformMatrix3fv(gl.getUniformLocation(p, 'doviNonlinear'), false, data.nonlinear);
			const draw = (matrix: Float32Array) => {
				gl.uniformMatrix3fv(gl.getUniformLocation(p, 'doviLinearMatrix'), false, matrix);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				const pixel = new Uint8Array(4);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
				return [...pixel];
			};
			return [draw(data.linear), draw(data.linear.map((n) => n / 2))];
		},
		{ data, shader, uniforms: doviUniforms }
	);
	expect(pixels[0]).toEqual([155, 155, 155, 255]);
	expect(pixels[1][0]).toBeLessThan(155);
	expect(pixels[1][0]).toBe(pixels[1][1]);
});
