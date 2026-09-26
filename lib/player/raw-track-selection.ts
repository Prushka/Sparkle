import type { RawPlaybackTrack } from './raw-types';
import type { Stream } from './t';
import {
	createSubtitleTracks,
	getStoredSubtitleLayerSrcs,
	saveStoredSubtitleLayerSelections,
	isStackableSubtitleFormat,
	type SubtitleTrackInfo
} from './subtitle-selection';
import {
	getStoredAudioSelection,
	getStoredSubtitleSelection,
	getSubtitleSelectionCandidateFromStream,
	isIOSOrAndroidDevice,
	pickPreferredAudioStream,
	readTrackPreference,
	removeTrackPreference,
	type StoredSubtitleSelection,
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
	preference?: string | null,
	mediaId = ''
) {
	const selected = getRawSubtitleTracks(tracks, mediaId, preferMobileNative, preference).find(
		(track) => track.default
	);
	return tracks.find((track) => track.id === selected?.id) ?? null;
}

/** Transport IDs differ between original MKV and NVENC subtitle packets.
 * Persist the original stream index scoped to this version-specific media ID. */
export function getRawSubtitleTracks(
	tracks: RawPlaybackTrack[],
	mediaId: string,
	preferMobileNative = isIOSOrAndroidDevice(),
	legacyPreference?: string | null
) {
	const streams = tracks.map((track) => ({
		...rawSelectionStream(track, 'subtitle'),
		Location: `raw-${encodeURIComponent(mediaId)}-track-${track.index ?? track.id}.${rawSubtitleFormat(track.codec)}`
	}));
	let selection: StoredSubtitleSelection | null =
		legacyPreference === null ? null : getStoredSubtitleSelection();
	if (!selection && legacyPreference !== null) {
		const legacy = legacyPreference ?? readTrackPreference('sparkle.raw.subtitle');
		const index = tracks.findIndex((track) => track.title === legacy);
		selection =
			legacy === 'off'
				? { disabled: true }
				: index < 0
					? null
					: getSubtitleSelectionCandidateFromStream(streams[index]);
	}
	return createSubtitleTracks(streams, '', {}, selection, preferMobileNative).map((track) => ({
		...track,
		id: tracks[streams.findIndex((stream) => stream.Location === track.src)].id
	}));
}

export function restoreRawSubtitleLayers(
	tracks: (SubtitleTrackInfo & { id: number })[],
	primary: SubtitleTrackInfo,
	originals: RawPlaybackTrack[]
) {
	const legacy = readTrackPreference('sparkle.raw.subtitleLayers');
	if (legacy) {
		try {
			const titles: unknown = JSON.parse(legacy);
			if (
				!getStoredSubtitleSelection() &&
				!readTrackPreference('subtitleLayers') &&
				Array.isArray(titles)
			) {
				for (const format of ['ass', 'vtt'] as const) {
					const layers = tracks.filter(
						(track) =>
							track.format === format &&
							titles.some((title) => originals.find((raw) => raw.id === track.id)?.title === title)
					);
					if (layers.length) saveStoredSubtitleLayerSelections(format, layers.slice(0, 2));
				}
			}
		} catch {
			/* Invalid legacy choices do not prevent playback. */
		}
		removeTrackPreference('sparkle.raw.subtitleLayers');
	}
	return isStackableSubtitleFormat(primary.format)
		? getStoredSubtitleLayerSrcs(tracks, primary).slice(0, 2)
		: [];
}
