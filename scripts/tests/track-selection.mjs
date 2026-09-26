import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = await build({
	stdin: {
		contents:
			"export * from './lib/player/track-selection'; export * from './lib/player/raw-track-selection';",
		resolveDir: process.cwd()
	},
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const {
	pickPriorityAudioStream,
	pickPreferredAudioStream,
	getStoredAudioSelection,
	saveStoredAudioSelection,
	pickPrioritySubtitleStream,
	pickRawAudioTrack,
	pickRawSubtitleTrack,
	rawSubtitleFormat
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, value)
};
const stream = (Language, Index, format = '', Title = '') => ({
	Language,
	Index,
	Title,
	CodecType: format ? 'subtitle' : 'audio',
	Location: `${Index}.${format}`
});
const audio = [stream('deu', 4), stream('zho', 3), stream('ENG', 2), stream('ja-JP', 1)];
assert.equal(pickPriorityAudioStream(audio).Index, 1);
assert.equal(pickPriorityAudioStream(audio.slice(0, 3)).Index, 2);
assert.equal(pickPriorityAudioStream(audio.slice(0, 2)).Index, 3);
assert.equal(pickPriorityAudioStream(audio.slice(0, 1)).Index, 4);
assert.equal(pickPriorityAudioStream([]), null);
for (const alias of ['ja', 'jpn', 'JA', 'ja_JP'])
	assert.equal(pickPriorityAudioStream([stream('eng', 2), stream(alias, 1)]).Index, 1);
for (const alias of ['chi', 'zho', 'zh', 'zh-Hant', 'cmn'])
	assert.equal(pickPriorityAudioStream([stream('deu', 2), stream(alias, 1)]).Index, 1);

const rawAudio = audio.map((s) => ({
	id: s.Index + 10,
	index: s.Index,
	language: s.Language,
	title: `Track ${s.Index}`
}));
assert.equal(pickRawAudioTrack(rawAudio, 'movie').id, 11);
assert.equal(storage.size, 0, 'defaults must not become saved preferences');
storage.set('sparkle.raw.audio', 'Track 2');
assert.equal(pickRawAudioTrack(rawAudio, 'movie').id, 12, 'keep legacy explicit Raw choices');
storage.set('sparkle.raw.audio', 'Not present');
assert.equal(pickRawAudioTrack(rawAudio, 'movie').id, 11);
saveStoredAudioSelection(audio[1], 'movie');
assert.equal(pickPreferredAudioStream(audio, getStoredAudioSelection(), 'movie').Index, 3);
assert.equal(pickRawAudioTrack(rawAudio, 'movie').id, 13);
assert.equal(
	pickRawAudioTrack(rawAudio, 'next-movie').id,
	13,
	'use the saved language across media'
);
const saved = storage.get('audioSelection');
assert.equal(
	pickRawAudioTrack(
		rawAudio.filter((a) => a.index !== 3),
		'next-movie'
	).id,
	11
);
assert.equal(
	storage.get('audioSelection'),
	saved,
	'missing saved tracks must not overwrite the preference'
);
const duplicateLanguage = [stream('eng', 1, '', 'Main'), stream('eng', 2, '', 'Commentary')];
saveStoredAudioSelection(duplicateLanguage[1], 'movie');
assert.equal(
	pickPreferredAudioStream(duplicateLanguage, getStoredAudioSelection(), 'movie').Index,
	2
);
assert.equal(
	pickPreferredAudioStream(duplicateLanguage, getStoredAudioSelection(), 'other-movie').Index,
	2
);

saveStoredAudioSelection({ ...audio[2], Title: undefined }, 'untitled-audio');
assert.equal(getStoredAudioSelection().title, '');
assert.equal(pickPreferredAudioStream(audio, getStoredAudioSelection(), 'another').Index, 2);
storage.clear();
const subtitles = [
	stream('eng', 1, 'sup'),
	stream('eng', 2, 'srt'),
	stream('eng', 3, 'vtt'),
	stream('jpn', 4, 'ass'),
	stream('eng', 5, 'ass')
];
assert.equal(pickPrioritySubtitleStream(subtitles, null).Index, 5);
assert.equal(pickPrioritySubtitleStream(subtitles, null, true).Index, 3);
assert.equal(pickPrioritySubtitleStream(subtitles, { disabled: true }), null);
assert.equal(pickPrioritySubtitleStream(subtitles, { language: 'en-US', format: 'sup' }).Index, 1);
assert.equal(pickPrioritySubtitleStream(subtitles, { language: 'ja-JP' }).Index, 4);
assert.equal(
	pickPrioritySubtitleStream([stream('jpn', 1, 'ass'), stream('eng', 2, 'srt')], null).Index,
	1,
	'Encoded policy is format first'
);
assert.equal(pickPrioritySubtitleStream([], null), null);

const rawSubtitles = subtitles.map((s) => ({
	id: s.Index,
	title: `Subtitle ${s.Index}`,
	language: s.Language,
	codec: s.Location.split('.').pop()
}));
assert.equal(pickRawSubtitleTrack(rawSubtitles, false).id, 5);
assert.equal(pickRawSubtitleTrack(rawSubtitles, true).id, 3);
assert.equal(storage.size, 0, 'automatic subtitles must not persist');
storage.set('sparkle.raw.subtitle', 'Subtitle 1');
assert.equal(pickRawSubtitleTrack(rawSubtitles).id, 1);
storage.set('sparkle.raw.subtitle', 'off');
assert.equal(pickRawSubtitleTrack(rawSubtitles), null);
assert.equal(
	pickRawSubtitleTrack(rawSubtitles, false, null).id,
	5,
	'turning captions on uses the shared default'
);
storage.set('sparkle.raw.subtitle', 'Not present');
assert.equal(pickRawSubtitleTrack(rawSubtitles).id, 5);
assert.equal(storage.get('sparkle.raw.subtitle'), 'Not present');
assert.equal(rawSubtitleFormat('ssa'), 'ass');
assert.equal(rawSubtitleFormat(String(0x17016)), 'ass');
assert.equal(rawSubtitleFormat(String(0x17004)), 'ass');
assert.equal(rawSubtitleFormat('hdmv_pgs_subtitle'), 'sup');
assert.equal(rawSubtitleFormat(String(0x17006)), 'sup');
assert.equal(rawSubtitleFormat('subrip'), 'srt');
assert.equal(rawSubtitleFormat(String(0x17011)), 'srt');
assert.equal(rawSubtitleFormat('webvtt'), 'vtt');

globalThis.localStorage = {
	getItem() {
		throw new Error('Storage blocked');
	},
	setItem() {
		throw new Error('Storage blocked');
	}
};
assert.equal(pickRawAudioTrack(rawAudio, 'movie').id, 11);
assert.equal(pickRawSubtitleTrack(rawSubtitles).id, 5);
assert.doesNotThrow(() => saveStoredAudioSelection(audio[0], 'movie'));
console.log(
	'Shared audio/subtitle priorities, language aliases, explicit preferences, legacy choices and blocked storage passed.'
);
