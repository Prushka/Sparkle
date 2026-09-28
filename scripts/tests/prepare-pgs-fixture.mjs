// Add authored image captions to the disposable multilingual playback fixture.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = 'cache/track-selection';
const bundle = await build({
	entryPoints: ['tests/e2e/fixtures/pgs.ts'],
	bundle: true,
	write: false,
	platform: 'node',
	format: 'esm'
});
const { pgsPacket } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const segments = [];
for (let cue = 0; cue < 48; cue++) {
	const packet = Buffer.from(pgsPacket(cue), 'base64');
	for (let offset = 0; offset < packet.length;) {
		const length = packet.readUInt16BE(offset + 1);
		const header = Buffer.alloc(10);
		header.write('PG');
		header.writeUInt32BE(cue * 90000, 2);
		segments.push(header, packet.subarray(offset, offset + 3 + length));
		offset += 3 + length;
	}
}
writeFileSync(`${root}/pixels.sup`, Buffer.concat(segments));
execFileSync(
	process.env.FFMPEG || 'ffmpeg',
	[
		'-v',
		'error',
		'-y',
		'-i',
		`${root}/multilingual.mkv`,
		'-i',
		`${root}/pixels.sup`,
		'-map',
		'0:v',
		'-map',
		'0:a:0',
		'-map',
		'1:s',
		'-c',
		'copy',
		`${root}/pixels.mkv`
	],
	{ windowsHide: true, stdio: 'pipe' }
);
console.log('Prepared bounded PGS MKV fixture');
