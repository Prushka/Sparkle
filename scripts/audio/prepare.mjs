import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const digest = (data) => createHash('sha256').update(data).digest('hex');
// Pin the small adapter as well as npm's tarball integrity. Export the meter's
// processor for synchronous composition in a single AudioWorklet (no sample
// copies/messages through the UI thread). The adapter meters stereo after mixing.
const audio = 'public/vendor/libmedia/audio';
await mkdir(audio, { recursive: true });
let meter = await readFile(
	'node_modules/loudness-worklet/packages/lib/dist/loudness.worklet.js',
	'utf8'
);
if (digest(meter) !== 'd3ebd377c49977eb6395fe6dff388e8df23633c63232ac3feedb9265c0a2ebf3')
	throw new Error('Loudness processor changed; review the pinned adapter');
meter = meter.replace('registerProcessor(`loudness-processor`,f);export{};', 'export default f;');
await writeFile(`${audio}/loudness-meter.js`, meter);
await cp('node_modules/loudness-worklet/LICENSE', `${audio}/LICENSE`);
await build({
	entryPoints: ['scripts/audio/normalize.worklet.js'],
	outfile: `${audio}/normalize-v2.js`,
	bundle: true,
	plugins: [
		{
			name: 'pinned-meter',
			setup(builder) {
				builder.onResolve({ filter: /^\.\/loudness-meter\.js$/ }, () => ({
					path: 'meter',
					namespace: 'loudness'
				}));
				builder.onLoad({ filter: /.*/, namespace: 'loudness' }, () => ({
					contents: meter,
					loader: 'js'
				}));
			}
		}
	],
	format: 'esm',
	platform: 'browser',
	minify: true
});
