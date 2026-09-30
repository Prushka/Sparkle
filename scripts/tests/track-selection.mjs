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
	rawSubtitleFormat,
	rawSubtitleByteSize,
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
	2,
	'preferred language precedes format'
);
assert.equal(pickPrioritySubtitleStream([], null), null);

// Language-first policy is shared by processed files and every Plex transport.
for (const mobile of [false, true]) {
	for (const format of ['ass', 'vtt', 'srt', 'sup']) {
		const streams = [
			...['ass', 'vtt', 'srt', 'sup'].map((f, i) => stream('fra', i, f)),
			stream('eng', 10, format)
		];
		for (const selection of [
			null,
			{ language: 'en-US' },
			{ language: 'en-US', format: 'ass', style: 'ass' }
		]) {
			assert.equal(pickPrioritySubtitleStream(streams, selection, mobile).Index, 10);
			storage.clear();
			if (selection) storage.set('subtitleSelection', JSON.stringify(selection));
			for (const offset of [0, 100, 200]) {
				const raw = streams.map((s) => ({
					id: s.Index + offset,
					index: s.Index,
					title: s.Title,
					language: s.Language,
					codec: s.Location.split('.')[1]
				}));
				assert.equal(
					getRawSubtitleTracks(raw, `version-${offset}`, mobile).find((t) => t.default).id,
					10 + offset
				);
			}
		}
	}
	// An explicit non-English language also survives a missing format.
	assert.equal(
		pickPrioritySubtitleStream(
			[stream('eng', 1, 'ass'), stream('jpn', 2, 'sup')],
			{ language: 'ja-JP', format: 'vtt' },
			mobile
		).Index,
		2
	);
}
storage.clear();

// Size is an automatic tie-breaker, never a substitute for a saved identity or priority.
for (const format of ['ass', 'vtt', 'srt', 'sup']) {
	const streams = [
		stream('eng', 1, format, 'A signs'),
		stream('eng', 2, format, 'B dialogue'),
		stream('eng', 3, format, 'Z full'),
		stream('jpn', 4, format, 'Japanese')
	];
	const files = {
		[`1.${format}`]: 10,
		[`2.${format}`]: 100,
		[`3.${format}`]: 1000,
		[`4.${format}`]: 10000
	};
	const tracks = createSubtitleTracks(streams, '/static/movie/', files, null, false);
	assert.equal(tracks.find((t) => t.default).src, `/static/movie/3.${format}`);
	assert.deepEqual(
		tracks.map((t) => t.src),
		createSubtitleTracks(streams, '/static/movie/', {}, null, false).map((t) => t.src),
		'size selection must not reorder menu tracks'
	);
	assert.equal(
		getSubtitleFormatSelection(tracks, format).primaryTrack.src,
		`/static/movie/3.${format}`
	);
	assert.equal(storage.size, 0, 'automatic size selection must not persist');
	saveStoredSubtitleSelection(tracks[0]);
	const saved = storage.get('subtitleSelection');
	assert.equal(JSON.parse(saved).size, undefined, 'size is not part of persistent identity');
	assert.equal(
		createSubtitleTracks(streams, '/static/movie/', files).find((t) => t.default).src,
		tracks[0].src
	);
	assert.equal(getSubtitleFormatSelection(tracks, format).primaryTrack.src, tracks[0].src);
	assert.equal(
		createSubtitleTracks(streams.slice(1), '/static/movie/', files).find((t) => t.default).src,
		`/static/movie/3.${format}`,
		'missing saved primary falls back to the largest otherwise equivalent track'
	);
	assert.equal(storage.get('subtitleSelection'), saved);
	saveStoredSubtitleSelectionOff();
	assert.equal(
		createSubtitleTracks(streams, '', files).some((t) => t.default),
		false
	);
	storage.clear();
}
const sized = [
	{ ...stream('eng', 1, 'ass', 'Signs'), Size: 10 },
	{ ...stream('eng', 2, 'ass', 'Full'), Size: 1000 },
	{ ...stream('eng', 3, 'vtt'), Size: 10000 },
	{ ...stream('jpn', 4, 'ass'), Size: 100000 }
];
assert.equal(pickPrioritySubtitleStream(sized, null).Index, 2);
assert.equal(pickPrioritySubtitleStream(sized, null, true).Index, 3);
assert.equal(pickPrioritySubtitleStream(sized, { language: 'ja-JP' }).Index, 4);
assert.equal(pickPrioritySubtitleStream(sized, { language: 'en-US' }).Index, 2);
assert.equal(
	pickPrioritySubtitleStream(sized, {
		language: 'en-US',
		format: 'ass',
		label: '1-English - Signs'
	}).Index,
	1
);
assert.equal(pickPrioritySubtitleStream(sized, { language: 'en-US', format: 'vtt' }).Index, 3);
assert.equal(
	pickPrioritySubtitleStream(
		sized.map((s) => ({ ...s, Size: 10 })),
		null
	).Index,
	1,
	'equal sizes retain the previous tie order'
);
for (const size of [undefined, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
	assert.equal(
		pickPrioritySubtitleStream(
			[
				{ ...sized[0], Size: 1 },
				{ ...sized[1], Size: size }
			],
			null
		).Index,
		1
	);
}
const chineseVariants = [
	{ ...stream('chi', 1, 'ass', 'Traditional'), Size: 10 },
	{ ...stream('chi', 2, 'ass', 'Simplified'), Size: 1000 }
];
assert.equal(
	pickPrioritySubtitleStream(chineseVariants, null).Index,
	1,
	'size cannot change Chinese variants'
);
const cueForgeStreams = [
	{ ...stream('eng', 1, 'ass', 'cueforge_eng'), Size: 10 },
	{ ...stream('eng', 2, 'ass', 'cueforge_eng_annotated'), Size: 1000 },
	{ ...stream('eng', 3, 'ass', 'Full'), Size: 10000 }
];
assert.equal(
	createSubtitleTracks(cueForgeStreams, '', {}, null).find((t) => t.default).src,
	'1.ass'
);
const layerTracks = createSubtitleTracks(sized, '', {}, null);
persistSubtitleTrackSelection(
	layerTracks,
	layerTracks.find((t) => t.src === '2.ass'),
	[layerTracks.find((t) => t.src === '1.ass')]
);
assert.deepEqual(
	getSubtitleFormatSelection(layerTracks, 'ass').layerTracks.map((t) => t.src),
	['1.ass']
);
storage.clear();
for (const [metadata, size] of [
	[{ NUMBER_OF_BYTES: ' 12345 ' }, 12345],
	[{ 'NUMBER_OF_BYTES-eng': '45678' }, 45678],
	[{ NUMBER_OF_BYTES: '12', 'NUMBER_OF_BYTES-eng': '34' }, 12],
	[{ NUMBER_OF_BYTES: '-1', 'NUMBER_OF_BYTES-eng': '34' }, 34],
	[{}, undefined],
	[{ BPS: '12345', NUMBER_OF_FRAMES: '99' }, undefined],
	[{ NUMBER_OF_BYTES: '1e5' }, undefined],
	[{ NUMBER_OF_BYTES: '+100' }, undefined],
	[{ NUMBER_OF_BYTES: 'Infinity' }, undefined]
])
	assert.equal(rawSubtitleByteSize(metadata), size);
const sizedRaw = sized.map((s) => ({
	id: s.Index,
	index: s.Index,
	title: s.Title,
	language: s.Language,
	codec: s.Location.split('.')[1],
	size: s.Size
}));
assert.equal(getRawSubtitleTracks(sizedRaw, 'movie').find((t) => t.default).id, 2);
saveStoredSubtitleSelection(getRawSubtitleTracks(sizedRaw, 'movie').find((t) => t.id === 1));
assert.equal(
	getRawSubtitleTracks(
		sizedRaw.map((t) => ({ ...t, id: t.id + 100 })),
		'movie'
	).find((t) => t.default).id,
	101
);
storage.clear();

const rawSubtitles = subtitles.map((s) => ({
	id: s.Index,
	title: `Subtitle ${s.Index}`,
	language: s.Language,
	codec: s.Location.split('.').pop()
}));
assert.equal(getRawSubtitleTracks(rawSubtitles, '', false).find((track) => track.default).id, 5);
assert.equal(getRawSubtitleTracks(rawSubtitles, '', true).find((track) => track.default).id, 3);
assert.equal(storage.size, 0, 'automatic subtitles must not persist');
storage.set('sparkle.raw.subtitle', 'Subtitle 1');
assert.equal(getRawSubtitleTracks(rawSubtitles, '').find((track) => track.default).id, 1);
storage.set('sparkle.raw.subtitle', 'off');
assert.equal(
	getRawSubtitleTracks(rawSubtitles, '').find((track) => track.default),
	undefined
);
assert.equal(
	getRawSubtitleTracks(rawSubtitles, '', false, null).find((track) => track.default).id,
	5,
	'turning captions on uses the shared default'
);
storage.set('sparkle.raw.subtitle', 'Not present');
assert.equal(getRawSubtitleTracks(rawSubtitles, '').find((track) => track.default).id, 5);
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
assert.equal(getRawSubtitleTracks(rawSubtitles, '').find((track) => track.default).id, 5);
assert.doesNotThrow(() => saveStoredAudioSelection(audio[0], 'movie'));
console.log(
	'Shared audio/subtitle priorities, language aliases, explicit preferences, legacy choices and blocked storage passed.'
);
