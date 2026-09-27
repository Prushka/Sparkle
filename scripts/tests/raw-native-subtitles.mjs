import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
	stdin: {
		contents: `export * from './lib/player/raw-native-subtitles';
			export * from './lib/player/raw-text-subtitles';
			export * from './lib/player/text-subtitle-cues';`,
		resolveDir: process.cwd()
	},
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { RawNativeSubtitles, RawTextCueWindow, mergeSubtitleCues, getActiveTrackText } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
	);
const packet = (text) => new TextEncoder().encode(text);
const first = new RawTextCueWindow(),
	second = new RawTextCueWindow();
first.add(0x17012, packet('English &amp; &lt;text&gt;'), 1000, 4000, 0);
first.add(0x17012, packet('English &amp; &lt;text&gt;'), 1000, 4000, 0);
assert.equal(first.cues.length, 1, 'seek replay does not duplicate the retained cue');
first.add(0x17012, packet('Next'), 5000, 2000, 0);
second.add(0x17012, packet('中文'), 2000, 4000, 0);
const merged = mergeSubtitleCues([first, second]);
assert.deepEqual(merged, [
	{ startTime: 1, endTime: 2, text: 'English & <text>' },
	{ startTime: 2, endTime: 5, text: 'English & <text>\n中文' },
	{ startTime: 5, endTime: 6, text: 'Next\n中文' },
	{ startTime: 6, endTime: 7, text: 'Next' }
]);
assert.equal(getActiveTrackText(merged, 5), 'Next\n中文', 'exact cue boundaries');
assert.equal(getActiveTrackText(merged, 7), '', 'no stale text after the last cue');
first.prune(5000);
assert.equal(first.cues.length, 1, 'expired cues leave the bounded window');
first.clear();
first.add(0x17012, packet('After backwards seek'), 0, 0, 0);
assert.equal(
	first.cues[0].endTime,
	5,
	'zero-duration packets keep the existing five-second fallback'
);
for (const [pts, duration] of [
	[NaN, 1],
	[0, Infinity],
	[1, -1]
])
	first.add(0x17012, packet('invalid'), pts, duration, 0);
assert.equal(first.cues.length, 1);
for (let i = 0; i < 300; i++) first.add(0x17012, packet(`cue ${i}`), i * 1000, 1000, 0);
assert.equal(first.cues.length, 256, 'dense/future tracks stay bounded');
first.add(0x17012, packet('x'.repeat(13 * 1024 * 1024)), 0, 1000, 0);
assert.equal(first.cues.length, 256, 'oversized decoded text is rejected');

// Minimal browser track objects let us check lifecycle and cue identity without an OS player.
globalThis.VTTCue = class {
	constructor(startTime, endTime, text) {
		Object.assign(this, { startTime, endTime, text });
	}
};
const video = () => ({
	textTracks: [],
	addTextTrack() {
		const track = {
			mode: 'disabled',
			cues: [],
			addCue(cue) {
				this.cues.push(cue);
				cue.track = this;
			},
			removeCue(cue) {
				this.cues.splice(this.cues.indexOf(cue), 1);
				cue.track = null;
			}
		};
		this.textTracks.push(track);
		return track;
	}
});
const oldVideo = video(),
	newVideo = video(),
	captions = new RawNativeSubtitles();
captions.update(merged);
captions.attach(oldVideo);
const track = oldVideo.textTracks[0];
assert.equal(track.mode, 'hidden', 'inline and Android keep the custom overlay');
assert.equal(track.cues[1].text, 'English &amp; &lt;text&gt;\n中文');
const originalCue = track.cues[1];
captions.update(merged);
assert.equal(track.cues[1], originalCue, 'unchanged cues are not torn down/repainted');
captions.setFullscreen(true);
assert.equal(track.mode, 'showing');
captions.update([merged[0]]);
assert.equal(track.cues.length, 1, 'selection/seek updates remove stale cues');
captions.attach(newVideo);
assert.equal(oldVideo.textTracks.length, 1);
assert.equal(track.cues.length, 0);
assert.equal(track.mode, 'disabled');
captions.setFullscreen(false);
assert.equal(newVideo.textTracks[0].mode, 'hidden');
captions.attach(oldVideo);
assert.equal(oldVideo.textTracks.length, 1, 'reattaching a video reuses its owned track');
captions.attach(newVideo);
captions.update([]);
assert.equal(newVideo.textTracks[0].cues.length, 0, 'turning captions off clears native output');
captions.destroy();
assert.equal(newVideo.textTracks[0].mode, 'disabled');
console.log(
	'Raw native subtitles: merged timings, escaping, bounded windows, selection, seek and video lifecycle passed'
);
