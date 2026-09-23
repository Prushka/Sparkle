// After rebuilding the pinned source, export distributable JS and the custom
// TrueHD binary. Stock codecs are fetched by hash during asset preparation.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = 'cache/libmedia-source',
	target = 'vendor/libmedia';
await mkdir(target, { recursive: true });
await cp(`${source}/dist/avplayer`, `${target}/avplayer`, { recursive: true });
await cp(`${source}/dist/decode/truehd.wasm`, `${target}/truehd.wasm`);
await cp(`${source}/COPYING.LGPLv3`, `${target}/LICENSE`);
const paths = [];
for (const dir of ['decode', 'resample', 'stretchpitch']) {
	for (const file of await readdir(`${source}/dist/${dir}`)) {
		if (!file.endsWith('.wasm') || /-64|truehd/.test(file)) continue;
		paths.push(`${dir}/${file}`);
	}
}
const codecs = {};
for (const path of paths)
	codecs[path] = createHash('sha256')
		.update(await readFile(`${source}/dist/${path}`))
		.digest('hex');
const artifacts = {};
for (const path of [
	'truehd.wasm',
	...(await readdir(`${target}/avplayer`)).map((file) => `avplayer/${file}`)
]) {
	artifacts[path] = createHash('sha256')
		.update(await readFile(`${target}/${path}`))
		.digest('hex');
}
const patchHash = createHash('sha256')
	.update((await readFile('scripts/libmedia/patch.mjs', 'utf8')).replaceAll('\r\n', '\n'))
	.digest('hex');
const sources = {};
for (const file of ['hdr-sdr.ts', 'dovi-sdr.ts'])
	sources[file] = createHash('sha256')
		.update((await readFile(`scripts/libmedia/${file}`, 'utf8')).replaceAll('\r\n', '\n'))
		.digest('hex');
await writeFile(
	`${target}/manifest.json`,
	JSON.stringify(
		{
			version: '1.3.1',
			commit: '152f629d3021fd8013efa464fcb7b55f9fbe7753',
			ffmpeg: '3a14ab29692763e561610412cdeb1985da4e3cd8',
			emscripten: '4.0.10',
			patchHash,
			sources,
			artifacts,
			codecs
		},
		null,
		2
	) + '\n'
);
