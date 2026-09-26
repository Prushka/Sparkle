import {
	compareSubtitleStreams,
	formatSubtitlePair,
	getCueForgeSubtitleInfo,
	type Stream
} from './t';
import {
	type SubtitleTrackFormat,
	type StoredSubtitleSelection,
	SUBTITLE_LANGUAGE_PRIORITY,
	getSubtitleLanguage,
	getSubtitleLanguageBase,
	isSameSubtitleLanguage,
	getSubtitleSelectionStyle,
	normalizeStoredSubtitleSelection,
	getStoredSubtitleSelection,
	getStoredSubtitleSelectionForTrack,
	saveStoredSubtitleSelection,
	saveStoredSubtitleSelectionOff,
	compareSubtitleFormats,
	isStoredSubtitleSelectionDisabled,
	getSubtitleSelectionCandidateFromTrack,
	findSubtitleByStoredSelection,
	pickPrioritySubtitleStream,
	getSubtitleFormat,
	isIOSOrAndroidDevice,
	readTrackPreference,
	writeTrackPreference,
	removeTrackPreference
} from './track-selection';
export type ChineseSubtitleVariant = 'Simplified' | 'Traditional';

export type SubtitleTrackInfo = {
	annotated: boolean;
	cueForge: boolean;
	src: string;
	label: string;
	settingsLabel: string;
	kind: 'subtitles';
	type: SubtitleTrackFormat;
	language: string;
	default: boolean;
	format: SubtitleTrackFormat;
	style: string;
};

export type SelectedSubtitleTrack = Pick<
	SubtitleTrackInfo,
	'annotated' | 'cueForge' | 'format' | 'label' | 'language' | 'src' | 'style'
> & { mode?: TextTrackMode };

export type StackableSubtitleTrackFormat = Extract<SubtitleTrackFormat, 'ass' | 'vtt'>;

export type StoredSubtitleLayerSelections = Partial<
	Record<StackableSubtitleTrackFormat, StoredSubtitleSelection[]>
>;

const SUBTITLE_LAYERS_STORAGE_KEY = 'subtitleLayers';
const STACKABLE_SUBTITLE_FORMATS = new Set<SubtitleTrackFormat>(['ass', 'vtt']);
export function isStackableSubtitleFormat(
	format: SubtitleTrackFormat
): format is StackableSubtitleTrackFormat {
	return STACKABLE_SUBTITLE_FORMATS.has(format);
}

export function getStoredSubtitleSelectionDedupeKey(selection: StoredSubtitleSelection) {
	return [
		selection.disabled ? 'off' : '',
		selection.language || '',
		selection.cueForge === undefined ? '' : selection.cueForge ? 'cueforge' : 'native',
		selection.annotated === undefined ? '' : selection.annotated ? 'annotated' : 'plain',
		selection.format || '',
		selection.style || '',
		selection.label || '',
		selection.srcName || '',
		selection.src || ''
	].join('\t');
}

export function dedupeStoredSubtitleSelections(values: StoredSubtitleSelection[]) {
	const uniqueSelections: StoredSubtitleSelection[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const key = getStoredSubtitleSelectionDedupeKey(value);
		if (key && !seen.has(key)) {
			seen.add(key);
			uniqueSelections.push(value);
		}
	}
	return uniqueSelections;
}

export function pickSubtitleTrackForFormat(
	tracks: SubtitleTrackInfo[],
	format: SubtitleTrackFormat,
	storedSelection: StoredSubtitleSelection | null = getStoredSubtitleSelection()
) {
	const formatTracks = getSubtitleTracksByFormat(tracks, format);
	if (formatTracks.length === 0 || isStoredSubtitleSelectionDisabled(storedSelection)) {
		return null;
	}
	const exactStoredMatch = findSubtitleByStoredSelection(
		formatTracks,
		storedSelection,
		getSubtitleSelectionCandidateFromTrack
	);
	if (exactStoredMatch) {
		return exactStoredMatch;
	}
	if (storedSelection?.language) {
		const languageMatch = formatTracks.find((track) =>
			isSameSubtitleLanguage(track.language, storedSelection.language || '')
		);
		if (languageMatch) {
			return languageMatch;
		}
	}
	for (const language of SUBTITLE_LANGUAGE_PRIORITY) {
		const priorityMatch = formatTracks.find(
			(track) => getSubtitleLanguageBase(track.language) === language
		);
		if (priorityMatch) {
			return priorityMatch;
		}
	}
	return formatTracks[0] ?? null;
}

export function readStoredSubtitleLayerSelectionMap(): StoredSubtitleLayerSelections {
	try {
		const parsed = JSON.parse(readTrackPreference(SUBTITLE_LAYERS_STORAGE_KEY) || '[]');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		const selections: StoredSubtitleLayerSelections = {};
		for (const format of ['ass', 'vtt'] as const) {
			const storedSelections = (parsed as Record<string, unknown>)[format];
			if (!Array.isArray(storedSelections)) {
				continue;
			}
			const normalizedSelections = dedupeStoredSubtitleSelections(
				storedSelections
					.map(normalizeStoredSubtitleSelection)
					.filter((selection): selection is StoredSubtitleSelection => Boolean(selection))
			);
			if (normalizedSelections.length > 0) {
				selections[format] = normalizedSelections;
			}
		}
		return selections;
	} catch {
		return {};
	}
}

export function readLegacyStoredSubtitleLayerSrcs() {
	try {
		const parsed = JSON.parse(readTrackPreference(SUBTITLE_LAYERS_STORAGE_KEY) || '[]');
		return Array.isArray(parsed)
			? parsed.filter((src): src is string => typeof src === 'string' && src.length > 0)
			: [];
	} catch {
		return [];
	}
}

export function readStoredSubtitleLayerSelections(format: StackableSubtitleTrackFormat) {
	return readStoredSubtitleLayerSelectionMap()[format] ?? [];
}

export function saveStoredSubtitleLayerSelections(
	format: StackableSubtitleTrackFormat,
	tracks: SubtitleTrackInfo[]
) {
	const storedSelections = readStoredSubtitleLayerSelectionMap();
	const normalizedSelections = dedupeStoredSubtitleSelections(
		tracks.map(getStoredSubtitleSelectionForTrack)
	);
	if (normalizedSelections.length > 0) {
		storedSelections[format] = normalizedSelections;
	} else {
		delete storedSelections[format];
	}
	if (!storedSelections.ass && !storedSelections.vtt) {
		removeTrackPreference(SUBTITLE_LAYERS_STORAGE_KEY);
		return;
	}
	writeTrackPreference(SUBTITLE_LAYERS_STORAGE_KEY, JSON.stringify(storedSelections));
}

export function getStackableSubtitleTracks(
	tracks: SubtitleTrackInfo[],
	primaryTrack: SelectedSubtitleTrack | null
) {
	if (!primaryTrack || !isStackableSubtitleFormat(primaryTrack.format)) {
		return [];
	}
	return tracks.filter(
		(track) => track.format === primaryTrack.format && isStackableSubtitleFormat(track.format)
	);
}

export function getAvailableSubtitleFormats(tracks: SubtitleTrackInfo[]) {
	return Array.from(new Set(tracks.map((track) => track.format))).sort(compareSubtitleFormats);
}

export function getSubtitleTracksByFormat(
	tracks: SubtitleTrackInfo[],
	format: SubtitleTrackFormat | null
) {
	if (!format) {
		return [];
	}
	return tracks.filter((track) => track.format === format).sort(compareSubtitleTrackNames);
}

export function getChineseSubtitleVariant(language: string): ChineseSubtitleVariant | null {
	const normalizedLanguage = language.trim().toLowerCase();
	if (
		normalizedLanguage === 'zh-cn' ||
		normalizedLanguage === 'zh-hans' ||
		normalizedLanguage === 'zh-sg'
	) {
		return 'Simplified';
	}
	if (
		normalizedLanguage === 'zh-tw' ||
		normalizedLanguage === 'zh-hant' ||
		normalizedLanguage === 'zh-hk' ||
		normalizedLanguage === 'zh-mo'
	) {
		return 'Traditional';
	}
	return null;
}

export function getChineseSubtitleVariantVisibilityByFormat(tracks: SubtitleTrackInfo[]) {
	const variantsByFormat = new Map<SubtitleTrackFormat, Set<ChineseSubtitleVariant>>();
	for (const track of tracks) {
		const variant = getChineseSubtitleVariant(track.language);
		if (!variant) {
			continue;
		}
		const variants = variantsByFormat.get(track.format) ?? new Set<ChineseSubtitleVariant>();
		variants.add(variant);
		variantsByFormat.set(track.format, variants);
	}
	return new Map([...variantsByFormat].map(([format, variants]) => [format, variants.size > 1]));
}

export function getSubtitleSettingsBaseLabel(track: SubtitleTrackInfo) {
	return track.label.replace(/^\s*\d+\s*-\s*/, '').trim() || track.label;
}

export function formatSubtitleSettingsLabel(label: string) {
	let formattedLabel = label.trim();
	const suffixes: string[] = [];
	let suffixMatch = formattedLabel.match(/\s+\(([^()]+)\)\s*$/);
	while (suffixMatch) {
		suffixes.unshift(suffixMatch[1].trim());
		formattedLabel = formattedLabel.slice(0, suffixMatch.index).trimEnd();
		suffixMatch = formattedLabel.match(/\s+\(([^()]+)\)\s*$/);
	}
	return [formattedLabel, ...suffixes].filter(Boolean).join(' - ') || label;
}

export function formatChineseSubtitleSettingsLabel(
	label: string,
	variant: ChineseSubtitleVariant,
	showVariant: boolean
) {
	let formattedLabel = label
		.replace(/\bsimplified\s+chinese\b/gi, 'Chinese - Simplified')
		.replace(/\btraditional\s+chinese\b/gi, 'Chinese - Traditional')
		.replace(/\bChinese\s*-\s*simplified\b/gi, 'Chinese - Simplified')
		.replace(/\bChinese\s*-\s*traditional\b/gi, 'Chinese - Traditional');

	if (showVariant && !new RegExp(`\\bChinese\\s*-\\s*${variant}\\b`).test(formattedLabel)) {
		formattedLabel = formattedLabel.replace(/\bChinese\b/, `Chinese - ${variant}`);
	}
	if (!showVariant) {
		formattedLabel = formattedLabel.replace(
			new RegExp(`\\bChinese\\s*-\\s*${variant}\\b`, 'g'),
			'Chinese'
		);
	}
	return formattedLabel;
}

export function getSubtitleSettingsDuplicateKey(track: SubtitleTrackInfo) {
	return [track.format, track.language, track.annotated ? 'annotated' : 'plain'].join('\t');
}

export function withSubtitleSettingsLabels(tracks: SubtitleTrackInfo[]) {
	const showChineseVariantByFormat = getChineseSubtitleVariantVisibilityByFormat(tracks);
	const entries = tracks.map((track, index) => ({
		baseLabel: getSubtitleSettingsBaseLabel(track),
		index,
		key: getSubtitleSettingsDuplicateKey(track),
		track
	}));
	const entriesByKey = new Map<string, typeof entries>();
	for (const entry of entries) {
		const keyEntries = entriesByKey.get(entry.key);
		if (keyEntries) {
			keyEntries.push(entry);
		} else {
			entriesByKey.set(entry.key, [entry]);
		}
	}

	const suffixes = new Map<number, number>();
	for (const keyEntries of entriesByKey.values()) {
		if (keyEntries.length <= 1) {
			continue;
		}
		[...keyEntries]
			.sort(
				(a, b) =>
					a.baseLabel.localeCompare(b.baseLabel, undefined, {
						numeric: true,
						sensitivity: 'base'
					}) ||
					a.track.src.localeCompare(b.track.src, undefined, {
						numeric: true,
						sensitivity: 'base'
					}) ||
					a.index - b.index
			)
			.forEach((entry, index) => suffixes.set(entry.index, index + 1));
	}

	return entries.map((entry) => {
		const suffix = suffixes.get(entry.index);
		const label = suffix ? `${entry.baseLabel} (${suffix})` : entry.baseLabel;
		const settingsLabel = formatSubtitleSettingsLabel(label);
		const chineseVariant = getChineseSubtitleVariant(entry.track.language);
		return {
			...entry.track,
			settingsLabel: chineseVariant
				? formatChineseSubtitleSettingsLabel(
						settingsLabel,
						chineseVariant,
						showChineseVariantByFormat.get(entry.track.format) ?? false
					)
				: settingsLabel
		};
	});
}

export function compareSubtitleTrackNames(a: SubtitleTrackInfo, b: SubtitleTrackInfo) {
	return (
		a.settingsLabel.localeCompare(b.settingsLabel, undefined, {
			numeric: true,
			sensitivity: 'base'
		}) ||
		a.language.localeCompare(b.language, undefined, { numeric: true, sensitivity: 'base' }) ||
		a.src.localeCompare(b.src, undefined, { numeric: true, sensitivity: 'base' })
	);
}

export function sanitizeSubtitleLayerSelection(
	srcs: string[],
	tracks: SubtitleTrackInfo[],
	primaryTrack: SelectedSubtitleTrack | null
) {
	const stackableTracks = getStackableSubtitleTracks(tracks, primaryTrack);
	const allowedSrcs = new Set(stackableTracks.map((track) => track.src));
	const nextSrcs: string[] = [];
	for (const src of srcs) {
		if (src !== primaryTrack?.src && allowedSrcs.has(src) && !nextSrcs.includes(src)) {
			nextSrcs.push(src);
		}
	}
	return nextSrcs;
}

export function getSubtitleLayerTracks(srcs: string[], tracks: SubtitleTrackInfo[]) {
	return srcs
		.map((src) => tracks.find((track) => track.src === src) ?? null)
		.filter((track): track is SubtitleTrackInfo => Boolean(track));
}

export function getStoredSubtitleLayerSrcs(
	tracks: SubtitleTrackInfo[],
	primaryTrack: SelectedSubtitleTrack
) {
	if (!isStackableSubtitleFormat(primaryTrack.format)) {
		return [];
	}
	const companionTracks = getStackableSubtitleTracks(tracks, primaryTrack).filter(
		(track) => track.src !== primaryTrack.src
	);
	const storedSelections = readStoredSubtitleLayerSelections(primaryTrack.format);
	const restoredSrcs: string[] = [];
	for (const selection of storedSelections) {
		const matchingTrack = findSubtitleByStoredSelection(
			companionTracks,
			selection,
			getSubtitleSelectionCandidateFromTrack,
			restoredSrcs
		);
		if (matchingTrack) {
			restoredSrcs.push(matchingTrack.src);
		}
	}
	if (restoredSrcs.length > 0 || storedSelections.length > 0) {
		return restoredSrcs;
	}

	const legacySrcs = readLegacyStoredSubtitleLayerSrcs();
	const migratedSrcs = sanitizeSubtitleLayerSelection(legacySrcs, tracks, primaryTrack);
	if (migratedSrcs.length > 0) {
		saveStoredSubtitleLayerSelections(
			primaryTrack.format,
			getSubtitleLayerTracks(migratedSrcs, tracks)
		);
	}
	return migratedSrcs;
}

/** The catalog adapter is shared; only the transport for each selected track differs. */
export function createSubtitleTracks(
	streams: Stream[],
	baseURL = '',
	files: Record<string, number> = {},
	selection = getStoredSubtitleSelection(),
	preferMobileNative = isIOSOrAndroidDevice()
): SubtitleTrackInfo[] {
	const sorted = streams
		.filter((s) => s.CodecType === 'subtitle')
		.sort((a, b) => compareSubtitleStreams(a, b, files));
	const preferred = pickPrioritySubtitleStream(sorted, selection, preferMobileNative);
	return withSubtitleSettingsLabels(
		sorted.map((stream) => {
			const cueForge = getCueForgeSubtitleInfo(stream);
			const src = `${baseURL}${stream.Location}`;
			const format = getSubtitleFormat(src);
			return {
				annotated: Boolean(cueForge?.annotated),
				cueForge: Boolean(cueForge),
				src,
				label: formatSubtitlePair(stream, true),
				settingsLabel: '',
				kind: 'subtitles',
				type: format,
				language: getSubtitleLanguage(stream),
				default: stream === preferred,
				format,
				style: getSubtitleSelectionStyle(format)
			};
		})
	);
}

export type SubtitleSelectionState = {
	primaryTrack: SubtitleTrackInfo | null;
	layerTracks: SubtitleTrackInfo[];
};

export function getSubtitleFormatSelection(
	tracks: SubtitleTrackInfo[],
	format: SubtitleTrackFormat
): SubtitleSelectionState {
	const stored = getStoredSubtitleSelection();
	const primaryTrack = pickSubtitleTrackForFormat(
		tracks,
		format,
		isStoredSubtitleSelectionDisabled(stored) ? null : stored
	);
	return {
		primaryTrack,
		layerTracks: primaryTrack
			? getSubtitleLayerTracks(getStoredSubtitleLayerSrcs(tracks, primaryTrack), tracks)
			: []
	};
}

/** Encoded's toggle semantics: add companions, promote the next when removing
 * the primary, and retain other formats' saved layers. No transport or storage writes. */
export function getToggledSubtitleSelection(
	tracks: SubtitleTrackInfo[],
	selected: SelectedSubtitleTrack | null,
	layerSrcs: string[],
	track: SubtitleTrackInfo,
	checked: boolean,
	maxLayers = Infinity
): SubtitleSelectionState | null {
	const layers = getSubtitleLayerTracks(layerSrcs, tracks).filter(
		(layer) => layer.format === track.format
	);
	const primary = tracks.find((candidate) => candidate.src === selected?.src) ?? null;
	if (checked) {
		if (!selected || selected.format !== track.format || !isStackableSubtitleFormat(track.format)) {
			return { primaryTrack: track, layerTracks: [] };
		}
		if (
			selected.src === track.src ||
			layers.some((layer) => layer.src === track.src) ||
			layers.length >= maxLayers
		)
			return null;
		return { primaryTrack: primary ?? track, layerTracks: [...layers, track] };
	}
	if (!selected || selected.format !== track.format) return null;
	if (selected.src === track.src) {
		if (!isStackableSubtitleFormat(track.format) || !layers.length)
			return { primaryTrack: null, layerTracks: [] };
		const [next, ...rest] = layers;
		return { primaryTrack: next, layerTracks: rest };
	}
	return { primaryTrack: primary, layerTracks: layers.filter((layer) => layer.src !== track.src) };
}

export function persistSubtitleTrackSelection(
	tracks: SubtitleTrackInfo[],
	primaryTrack: SubtitleTrackInfo | null,
	layerTracks: SubtitleTrackInfo[] = []
) {
	if (!primaryTrack) {
		saveStoredSubtitleSelectionOff();
		return [];
	}
	const srcs = sanitizeSubtitleLayerSelection(
		layerTracks.map((track) => track.src),
		tracks,
		primaryTrack
	);
	if (isStackableSubtitleFormat(primaryTrack.format)) {
		saveStoredSubtitleLayerSelections(primaryTrack.format, getSubtitleLayerTracks(srcs, tracks));
	}
	saveStoredSubtitleSelection(primaryTrack);
	return srcs;
}
