import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = await build({
	stdin: {
		contents:
			"export * from './lib/player/track-selection'; export * from './lib/player/raw-track-selection'; export * from './lib/player/subtitle-selection';",
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
	rawSubtitleFormat,
	getRawSubtitleTracks,
	restoreRawSubtitleLayers,
	createSubtitleTracks,
	getSubtitleFormatSelection,
	getToggledSubtitleSelection,
	getStoredSubtitleLayerSrcs,
	persistSubtitleTrackSelection,
	getStoredSubtitleSelection,
	saveStoredSubtitleSelection,
	saveStoredSubtitleSelectionOff
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, value),
	removeItem: (key) => storage.delete(key)
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

storage.clear();
const duplicates = [
	{ id: 15, index: 5, title: 'English', language: 'eng', codec: 'ass' },
	{ id: 16, index: 6, title: 'English', language: 'eng', codec: 'ass' },
	{ id: 17, index: 7, title: 'Chinese old title', language: 'chi', codec: 'ass' },
	{ id: 18, index: 8, title: 'Japanese', language: 'jpn', codec: 'ass' },
	{ id: 19, index: 9, title: 'English', language: 'eng', codec: 'webvtt' },
	{ id: 20, index: 10, title: 'Chinese old title', language: 'chi', codec: 'webvtt' }
];
let tracks = getRawSubtitleTracks(duplicates, 'version-A');
saveStoredSubtitleSelection(tracks.find((t) => t.id === 16));
for (const offset of [0, 100, 200]) {
	const modeTracks = getRawSubtitleTracks(
		duplicates.map((t) => ({ ...t, id: t.id + offset })),
		'version-A'
	);
	assert.equal(
		modeTracks.find((t) => t.default).id,
		16 + offset,
		'restore original stream identity across transport IDs'
	);
}
assert.notEqual(
	tracks.find((t) => t.id === 15).settingsLabel,
	tracks.find((t) => t.id === 16).settingsLabel
);
saveStoredSubtitleSelection(tracks.find((t) => t.id === 17));
const missing = duplicates.map((t) => ({ ...t, title: t.title.replace('old title', 'new title') }));
const preferenceBeforeFallback = storage.get('subtitleSelection');
assert.equal(getRawSubtitleTracks(missing, 'version-B').find((t) => t.default).id, 17);
assert.equal(
	storage.get('subtitleSelection'),
	preferenceBeforeFallback,
	'fallback must retain saved language and detailed preference'
);
const encodedStreams = duplicates.map((t) =>
	stream(t.language, t.index, t.codec === 'webvtt' ? 'vtt' : t.codec, t.title)
);
assert.equal(
	createSubtitleTracks(encodedStreams).find((t) => t.default).language,
	'zh-CN',
	'Raw preference also applies to Encoded'
);
saveStoredSubtitleSelection(
	createSubtitleTracks(encodedStreams).find((t) => t.language === 'ja-JP')
);
assert.equal(
	getRawSubtitleTracks(duplicates, 'version-A').find((t) => t.default).id,
	18,
	'Encoded preference also applies to Raw'
);

const primary = tracks.find((t) => t.id === 16),
	companion = tracks.find((t) => t.id === 17);
persistSubtitleTrackSelection(tracks, primary, [companion]);
let state = getSubtitleFormatSelection(tracks, 'vtt');
assert.equal(state.primaryTrack.format, 'vtt');
persistSubtitleTrackSelection(tracks, state.primaryTrack, [tracks.find((t) => t.id === 20)]);
state = getSubtitleFormatSelection(tracks, 'ass');
assert.deepEqual(
	state.layerTracks.map((t) => t.id),
	[17],
	'switching formats restores the saved companion'
);
persistSubtitleTrackSelection(tracks, primary, [companion]);
state = getToggledSubtitleSelection(tracks, primary, [companion.src], primary, false);
assert.equal(state.primaryTrack.id, 17, 'removing primary promotes its companion');
assert.deepEqual(state.layerTracks, []);
state = getToggledSubtitleSelection(
	tracks,
	primary,
	[companion.src],
	tracks.find((t) => t.id === 18),
	true
);
assert.equal(state.primaryTrack.id, 16);
assert.deepEqual(
	state.layerTracks.map((t) => t.id),
	[17, 18]
);
assert.deepEqual(
	getToggledSubtitleSelection(
		tracks,
		primary,
		state.layerTracks.map((t) => t.src),
		tracks.find((t) => t.id === 15),
		true
	).layerTracks.map((track) => track.id),
	[17, 18, 15],
	'Raw and Encoded allow more than three selected tracks'
);
const allLayers = [17, 18, 15].map((id) => tracks.find((track) => track.id === id));
persistSubtitleTrackSelection(tracks, primary, allLayers);
assert.deepEqual(
	restoreRawSubtitleLayers(tracks, primary, duplicates),
	allLayers.map((track) => track.src),
	'Restoring saved Raw layers does not truncate the selection'
);
persistSubtitleTrackSelection(tracks, primary, [companion]);
saveStoredSubtitleSelectionOff();
assert.equal(getStoredSubtitleSelection().disabled, true);
assert.equal(
	getRawSubtitleTracks(duplicates, 'version-A').find((t) => t.default),
	undefined
);
assert.equal(
	createSubtitleTracks(encodedStreams).find((t) => t.default),
	undefined
);
assert.deepEqual(
	getStoredSubtitleLayerSrcs(tracks, primary),
	[companion.src],
	'Off preserves format layers'
);

// The initial ordering and mobile/desktop choice are identical for both adapters.
storage.clear();
for (const mobile of [false, true]) {
	const raw = getRawSubtitleTracks([...duplicates].reverse(), 'version-A', mobile);
	const encoded = createSubtitleTracks([...encodedStreams].reverse(), '', {}, null, mobile);
	assert.deepEqual(
		raw.map((t) => t.label),
		encoded.map((t) => t.label)
	);
	assert.equal(raw.find((t) => t.default).label, encoded.find((t) => t.default).label);
}

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
