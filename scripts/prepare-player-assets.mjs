import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const vendor = 'vendor/libmedia';
const manifest = JSON.parse(await readFile(`${vendor}/manifest.json`, 'utf8'));
const digest = (data) => createHash('sha256').update(data).digest('hex');
if (
	digest((await readFile('scripts/libmedia/patch.mjs', 'utf8')).replaceAll('\r\n', '\n')) !==
	manifest.patchHash
)
	throw new Error('Player patches changed; rebuild and export the pinned player');
for (const [file, hash] of Object.entries(manifest.sources || {})) {
	if (
		digest((await readFile(`scripts/libmedia/${file}`, 'utf8')).replaceAll('\r\n', '\n')) !== hash
	)
		throw new Error(`Player source changed; rebuild and export: ${file}`);
}
for (const [file, hash] of Object.entries(manifest.artifacts)) {
	if (digest(await readFile(`${vendor}/${file}`)) !== hash)
		throw new Error(`Patched player integrity check failed: ${file}`);
}
const target = `public/vendor/libmedia/${manifest.version}`;
await mkdir(target, { recursive: true });
await cp(`${vendor}/avplayer`, target, { recursive: true });
await mkdir(`${target}/decode`, { recursive: true });
await cp(`${vendor}/truehd.wasm`, `${target}/decode/truehd.wasm`);
await cp(`${vendor}/LICENSE`, `${target}/LICENSE`);
const entries = Object.entries(manifest.codecs);
async function worker() {
	for (;;) {
		const entry = entries.pop();
		if (!entry) return;
		const [path, hash] = entry,
			destination = `${target}/${path}`;
		let bytes = await readFile(destination).catch(() => null);
		const digest = (data) => createHash('sha256').update(data).digest('hex');
		if (bytes && digest(bytes) === hash) continue;
		// The local build cache is optional; clean builds use the immutable commit.
		bytes = await readFile(`cache/libmedia-source/dist/${path}`).catch(() => null);
		if (!bytes || digest(bytes) !== hash) {
			const response = await fetch(
				`https://raw.githubusercontent.com/zhaohappy/libmedia/${manifest.commit}/dist/${path}`,
				{ signal: AbortSignal.timeout(120000) }
			);
			if (!response.ok) throw new Error(`Unable to download pinned decoder: ${path}`);
			bytes = Buffer.from(await response.arrayBuffer());
		}
		if (digest(bytes) !== hash) throw new Error(`Decoder integrity check failed: ${path}`);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, bytes);
	}
}
await Promise.all(Array.from({ length: 4 }, worker));
const subtitles = 'public/vendor/libmedia/jassub';
await mkdir(subtitles, { recursive: true });
await cp('node_modules/jassub/LICENSE', `${subtitles}/LICENSE`);
await build({
	entryPoints: ['node_modules/jassub/dist/jassub.js'],
	outfile: `${subtitles}/jassub.js`,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	minify: true
});
await build({
	entryPoints: ['node_modules/jassub/dist/worker/worker.js'],
	outfile: `${subtitles}/worker.js`,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	minify: true
});
for (const file of ['jassub-worker.wasm', 'jassub-worker-modern.wasm'])
	await cp(`node_modules/jassub/dist/wasm/${file}`, `${subtitles}/${file}`);
await cp('node_modules/jassub/dist/default.woff2', `${subtitles}/default.woff2`);
await import('./audio/prepare.mjs');
console.log('Prepared locally hosted raw-player assets');
