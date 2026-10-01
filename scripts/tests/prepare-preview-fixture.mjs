// Disposable moving SDR/PQ/HLG sources plus actual NVENC AV1/HEVC HLS.
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = 'cache/preview-fixtures';
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const run = (args) =>
	execFileSync(ffmpeg, ['-v', 'error', '-nostdin', '-y', ...args], { stdio: 'pipe' });
for (const transfer of ['bt709', 'smpte2084', 'arib-std-b67']) {
	const dir = `${root}/${transfer}`;
	await mkdir(dir, { recursive: true });
	const hdr = transfer !== 'bt709';
	run([
		'-f',
		'lavfi',
		'-i',
		'testsrc2=size=640x360:rate=24',
		'-f',
		'lavfi',
		'-i',
		'sine=frequency=440:sample_rate=48000',
		'-t',
		'24',
		'-vf',
		hdr
			? `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt2020:t=${transfer}:m=bt2020nc:r=limited:npl=100,format=p010le`
			: 'format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
		'-c:v',
		'hevc_nvenc',
		'-preset',
		'p3',
		'-g',
		'48',
		'-c:a',
		'aac',
		`${dir}/original.mkv`
	]);
	for (const codec of ['av1', 'hevc']) {
		await mkdir(`${dir}/${codec}`, { recursive: true });
		run([
			'-i',
			`${dir}/original.mkv`,
			'-map',
			'0:v:0',
			'-map',
			'0:a:0',
			'-c:v',
			`${codec}_nvenc`,
			'-preset',
			'p3',
			'-g',
			'48',
			...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : ['-s12m_tc', '0']),
			'-c:a',
			'aac',
			'-f',
			'hls',
			'-hls_time',
			'6',
			'-hls_list_size',
			'0',
			'-hls_segment_type',
			'fmp4',
			'-hls_segment_filename',
			`${dir}/${codec}/segment-%d.m4s`,
			`${dir}/${codec}/master.m3u8`
		]);
	}
}
console.log(
	'Preview sources and NVENC AV1/HEVC fixtures prepared; run TestPreviewFFmpegFixtures to create production JPEGs.'
);
