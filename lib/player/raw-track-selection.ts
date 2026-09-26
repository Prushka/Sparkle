import type { RawPlaybackTrack } from './raw-types';
import type { Stream } from './t';
import {
	getStoredAudioSelection,
	isIOSOrAndroidDevice,
	pickPreferredAudioStream,
	pickPrioritySubtitleStream,
	readTrackPreference,
	type SubtitleTrackFormat
} from './track-selection';

// Original subtitle codecs use the same format priorities as extracted tracks.
export function rawSubtitleFormat(codec = ''): SubtitleTrackFormat {
	if (['ass', 'ssa', '94230', '94212'].includes(codec.toLowerCase())) return 'ass';
	if (['pgs', 'hdmv_pgs_subtitle', 'sup', '94214'].includes(codec.toLowerCase())) return 'sup';
	if (['srt', 'subrip', 'text', '94225', '94210'].includes(codec.toLowerCase())) return 'srt';
	return 'vtt';
}

export function rawSelectionStream(track: RawPlaybackTrack, kind: 'audio' | 'subtitle'): Stream {
	return {
		Index: track.index ?? track.id,
		CodecType: kind,
		Language: track.language || '',
		Title: track.title,
		Location: kind === 'subtitle' ? `${track.id}.${rawSubtitleFormat(track.codec)}` : ''
	};
}

export function pickRawAudioTrack(tracks: RawPlaybackTrack[], mediaId: string) {
	const selection = getStoredAudioSelection();
	// Keep existing explicit Raw choices until the user makes a shared choice.
	if (!selection) {
		const legacy = readTrackPreference('sparkle.raw.audio');
		const match = tracks.find((track) => track.title === legacy);
		if (match) return match;
	}
	return (
		pickPreferredAudioStream(
			tracks.map((track) => ({ ...rawSelectionStream(track, 'audio'), track })),
			selection,
			mediaId
		)?.track ?? null
	);
}

export function pickRawSubtitleTrack(
	tracks: RawPlaybackTrack[],
	preferMobileNative = isIOSOrAndroidDevice(),
	preference = readTrackPreference('sparkle.raw.subtitle')
) {
	if (preference === 'off') return null;
	const saved = tracks.find((track) => track.title === preference);
	if (saved) return saved;
	const streams = tracks.map((track) => rawSelectionStream(track, 'subtitle'));
	const selected = pickPrioritySubtitleStream(streams, null, preferMobileNative);
	return selected ? tracks[streams.indexOf(selected)] : null;
}
