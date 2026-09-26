// Disposable multilingual selection fixtures; never reads the Plex library.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = 'cache/track-selection';
await mkdir(root, { recursive: true });
await writeFile(
	`${root}/captions.srt`,
	'1\n00:00:00,000 --> 00:00:47,000\nTrack selection fixture\n'
);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const run = (args) =>
	execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
run([
	'-f',
	'lavfi',
	'-i',
	'testsrc2=size=320x180:rate=24',
	'-f',
	'lavfi',
	'-i',
	'sine=frequency=440:sample_rate=48000',
	'-i',
	`${root}/captions.srt`,
	'-map',
	'0:v',
	'-map',
	'1:a',
	'-map',
	'1:a',
	'-map',
	'1:a',
	'-map',
	'2:s',
	'-map',
	'2:s',
	'-map',
	'2:s',
	'-t',
	'48',
	'-c:v',
	'libx264',
	'-preset',
	'ultrafast',
	'-g',
	'48',
	'-c:a',
	'aac',
	'-c:s:0',
	'srt',
	'-c:s:1',
	'ass',
	'-c:s:2',
	'ass',
	'-metadata:s:a:0',
	'language=eng',
	'-metadata:s:a:0',
	'title=English',
	'-metadata:s:a:1',
	'language=chi',
	'-metadata:s:a:1',
	'title=Chinese',
	'-metadata:s:a:2',
	'language=jpn',
	'-metadata:s:a:2',
	'title=Japanese',
	'-metadata:s:s:0',
	'language=chi',
	'-metadata:s:s:0',
	'title=Chinese text',
	'-metadata:s:s:1',
	'language=jpn',
	'-metadata:s:s:1',
	'title=Japanese styled',
	'-metadata:s:s:2',
	'language=eng',
	'-metadata:s:s:2',
	'title=English styled',
	'-disposition:a:0',
	'default',
	'-disposition:a:1',
	'0',
	'-disposition:a:2',
	'0',
	'-disposition:s:0',
	'default',
	'-disposition:s:1',
	'0',
	'-disposition:s:2',
	'0',
	`${root}/multilingual.mkv`
]);
for (const [index, language] of ['eng', 'chi', 'jpn'].entries()) {
	run([
		'-i',
		`${root}/multilingual.mkv`,
		'-map',
		'0:v',
		'-map',
		`0:a:${index}`,
		'-c',
		'copy',
		'-movflags',
		'+faststart',
		`${root}/h264-8bit-${index + 1}-${language}.mp4`
	]);
}
// Optional real NVENC fixtures exercise embedded Opus selection in both modes.
if (process.argv.includes('--nvenc')) {
	for (const codec of ['av1', 'hevc']) {
		await mkdir(`${root}/${codec}`, { recursive: true });
		run([
			'-i',
			`${root}/multilingual.mkv`,
			'-map',
			'0:v',
			'-map',
			'0:a',
			'-c:v',
			`${codec}_nvenc`,
			'-preset',
			'p3',
			'-cq',
			'24',
			'-g',
			'48',
			'-c:a',
			'libopus',
			'-ac',
			'2',
			'-b:a',
			'96k',
			'-f',
			'hls',
			'-hls_time',
			'6',
			'-hls_playlist_type',
			'vod',
			'-hls_segment_type',
			'fmp4',
			'-hls_fmp4_init_filename',
			'init.mp4',
			'-hls_segment_filename',
			`${root}/${codec}/segment-%d.m4s`,
			`${root}/${codec}/master.m3u8`
		]);
	}
}
console.log(`Prepared ${root}${process.argv.includes('--nvenc') ? ' with AV1/HEVC NVENC' : ''}.`);
