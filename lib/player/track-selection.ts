import { formatSubtitlePair, getCueForgeSubtitleInfo, languageSrcMap, type Stream } from './t';

export type SubtitleTrackFormat = 'ass' | 'srt' | 'sup' | 'vtt';

export type StoredSubtitleSelection = {
	annotated?: boolean;
	cueForge?: boolean;
	disabled?: boolean;
	format?: SubtitleTrackFormat;
	label?: string;
	language?: string;
	src?: string;
	srcName?: string;
	style?: string;
};

export type SubtitleSelectionCandidate = Required<
	Pick<StoredSubtitleSelection, 'annotated' | 'cueForge' | 'format' | 'language' | 'style'>
> &
	Pick<StoredSubtitleSelection, 'label' | 'src' | 'srcName'>;

export const SUBTITLE_SELECTION_STORAGE_KEY = 'subtitleSelection';

export const SUBTITLE_LANGUAGE_STORAGE_KEY = 'subtitleLanguage';

export const AUDIO_LANGUAGE_PRIORITY = ['ja', 'en', 'zh'];

export const SUBTITLE_LANGUAGE_PRIORITY = ['en'];

export const DEFAULT_SUBTITLE_FORMAT_PRIORITY = ['ass', 'vtt', 'srt', 'sup'] as const;

export const MOBILE_DEFAULT_SUBTITLE_FORMAT_PRIORITY = ['vtt', 'ass', 'srt', 'sup'] as const;

export function normalizeTrackLanguage(language: string) {
	const value = (language || '').trim().toLowerCase().replaceAll('_', '-');
	return languageSrcMap[value] || value;
}

function audioLanguage(language: string) {
	return normalizeTrackLanguage(language).split('-')[0].toLowerCase();
}

export function pickPriorityAudioStream<T extends Stream>(streams: T[]) {
	for (const language of AUDIO_LANGUAGE_PRIORITY) {
		const stream = streams.find((candidate) => audioLanguage(candidate.Language) === language);
		if (stream) {
			return stream;
		}
	}
	return streams[0] ?? null;
}

export type StoredAudioSelection = {
	language: string;
	title: string;
	mediaId?: string;
	index?: number;
};

export function readTrackPreference(key: string) {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeTrackPreference(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Track choices still work when storage is unavailable.
	}
}

export function getStoredAudioSelection(): StoredAudioSelection | null {
	try {
		const value = JSON.parse(readTrackPreference('audioSelection') || 'null');
		if (!value || typeof value.language !== 'string' || typeof value.title !== 'string')
			return null;
		return {
			language: value.language,
			title: value.title,
			mediaId: typeof value.mediaId === 'string' ? value.mediaId : undefined,
			index: Number.isInteger(value.index) ? value.index : undefined
		};
	} catch {
		return null;
	}
}

/** Called only by an explicit local track choice, never by default selection. */
export function saveStoredAudioSelection(stream: Stream, mediaId: string) {
	writeTrackPreference(
		'audioSelection',
		JSON.stringify({
			language: normalizeTrackLanguage(stream.Language),
			title: stream.Title || '',
			mediaId,
			index: stream.Index
		} satisfies StoredAudioSelection)
	);
}

export function pickPreferredAudioStream<T extends Stream>(
	streams: T[],
	selection: StoredAudioSelection | null,
	mediaId: string
) {
	if (selection) {
		const sameLanguage = (stream: Stream) =>
			audioLanguage(stream.Language) === audioLanguage(selection.language);
		const exact =
			selection.mediaId === mediaId
				? streams.find((stream) => stream.Index === selection.index && sameLanguage(stream))
				: null;
		const title = selection.title
			? streams.find((stream) => stream.Title === selection.title && sameLanguage(stream))
			: null;
		const language = selection.language ? streams.find(sameLanguage) : null;
		if (exact || title || language) return exact || title || language || null;
	}
	return pickPriorityAudioStream(streams);
}

export function getSubtitleLanguage(stream: Stream) {
	const cueForgeSubtitle = getCueForgeSubtitleInfo(stream);
	if (cueForgeSubtitle) {
		return languageSrcMap[cueForgeSubtitle.languageId] || cueForgeSubtitle.languageId;
	}
	const rawLanguage = (stream.Language || '').trim().toLowerCase();
	const title = stream.Title || '';
	if (rawLanguage === 'chi' || rawLanguage === 'zho' || /^zh(?:-|$)/i.test(rawLanguage)) {
		if (/traditional|繁體|繁体|正體|正体|tc|cht/i.test(title)) {
			return 'zh-TW';
		}
		if (/simplified|简体|簡體|sc|chs/i.test(title)) {
			return 'zh-CN';
		}
	}
	return normalizeTrackLanguage(rawLanguage);
}

export function getSubtitleLanguageBase(language: string) {
	return language.split('-')[0]?.toLowerCase() || language.toLowerCase();
}

export function isChineseSubtitleLanguage(language: string) {
	return getSubtitleLanguageBase(language) === 'zh';
}

export function isSameSubtitleLanguage(a: string, b: string) {
	if (a === b) {
		return true;
	}
	if (isChineseSubtitleLanguage(a) || isChineseSubtitleLanguage(b)) {
		return false;
	}
	return getSubtitleLanguageBase(a) === getSubtitleLanguageBase(b);
}

export function isSubtitleTrackFormat(value: string): value is SubtitleTrackFormat {
	return value === 'ass' || value === 'srt' || value === 'sup' || value === 'vtt';
}

export function getSubtitleSelectionStyle(format: SubtitleTrackFormat) {
	return format;
}

export function getSubtitleSrcName(src: string) {
	return src.split(/[?#]/)[0].split('/').pop() || src;
}

export function readStoredSubtitleLanguage() {
	if (typeof window === 'undefined') {
		return null;
	}
	return window.localStorage.getItem(SUBTITLE_LANGUAGE_STORAGE_KEY);
}

export function saveStoredSubtitleLanguage(language: string) {
	if (typeof window === 'undefined' || !language) {
		return;
	}
	window.localStorage.setItem(SUBTITLE_LANGUAGE_STORAGE_KEY, language);
}

export function normalizeStoredSubtitleSelection(value: unknown): StoredSubtitleSelection | null {
	if (typeof value === 'string') {
		const storedValue = value.trim();
		if (!storedValue) {
			return null;
		}
		if (storedValue.toLowerCase() === 'off') {
			return { disabled: true };
		}
		if (storedValue.includes('\t')) {
			const [language = '', label = '', srcName = ''] = storedValue.split('\t');
			const format = isSubtitleTrackFormat(getSubtitleFormat(srcName))
				? getSubtitleFormat(srcName)
				: undefined;
			return normalizeStoredSubtitleSelection({
				format,
				label,
				language,
				srcName,
				style: format ? getSubtitleSelectionStyle(format) : undefined
			});
		}
		if (storedValue.includes('/') || /\.[a-z0-9]+$/i.test(storedValue)) {
			const format = getSubtitleFormat(storedValue);
			return {
				format,
				src: storedValue,
				srcName: getSubtitleSrcName(storedValue),
				style: getSubtitleSelectionStyle(format)
			};
		}
		return { language: storedValue };
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const record = value as Record<string, unknown>;
	const selection: StoredSubtitleSelection = {};
	for (const key of ['label', 'language', 'src', 'srcName', 'style'] as const) {
		const stringValue = record[key];
		if (typeof stringValue === 'string' && stringValue.trim()) {
			selection[key] = stringValue.trim();
		}
	}
	if (typeof record.cueForge === 'boolean') {
		selection.cueForge = record.cueForge;
	}
	if (typeof record.annotated === 'boolean') {
		selection.annotated = record.annotated;
	}
	if (typeof record.disabled === 'boolean') {
		selection.disabled = record.disabled;
	}
	if (typeof record.format === 'string' && isSubtitleTrackFormat(record.format)) {
		selection.format = record.format;
	}
	if (selection.src && !selection.srcName) {
		selection.srcName = getSubtitleSrcName(selection.src);
	}
	if (selection.format && !selection.style) {
		selection.style = getSubtitleSelectionStyle(selection.format);
	}
	return Object.keys(selection).length > 0 ? selection : null;
}

export function getStoredSubtitleSelection() {
	if (typeof window === 'undefined') {
		return null;
	}
	const storedSelection = window.localStorage.getItem(SUBTITLE_SELECTION_STORAGE_KEY);
	if (storedSelection) {
		try {
			const selection = normalizeStoredSubtitleSelection(JSON.parse(storedSelection));
			if (selection) {
				return selection;
			}
		} catch {
			const selection = normalizeStoredSubtitleSelection(storedSelection);
			if (selection) {
				return selection;
			}
		}
	}
	const legacyLanguage = readStoredSubtitleLanguage();
	return legacyLanguage ? { language: legacyLanguage } : null;
}

export function getStoredSubtitleSelectionForTrack(
	track: SubtitleSelectionTrack
): StoredSubtitleSelection {
	return {
		annotated: track.annotated,
		cueForge: track.cueForge,
		format: track.format,
		label: track.label,
		language: track.language,
		src: track.src,
		srcName: getSubtitleSrcName(track.src),
		style: track.style || getSubtitleSelectionStyle(track.format)
	};
}

export function saveStoredSubtitleSelection(track: SubtitleSelectionTrack) {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(
		SUBTITLE_SELECTION_STORAGE_KEY,
		JSON.stringify(getStoredSubtitleSelectionForTrack(track))
	);
	saveStoredSubtitleLanguage(track.language);
}

export function saveStoredSubtitleSelectionOff() {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(SUBTITLE_SELECTION_STORAGE_KEY, JSON.stringify({ disabled: true }));
	window.localStorage.removeItem(SUBTITLE_LANGUAGE_STORAGE_KEY);
}

export function getSubtitleFormatPriority(format: SubtitleTrackFormat) {
	const priorityIndex = DEFAULT_SUBTITLE_FORMAT_PRIORITY.indexOf(format);
	return priorityIndex === -1 ? DEFAULT_SUBTITLE_FORMAT_PRIORITY.length : priorityIndex;
}

export function compareSubtitleFormats(a: SubtitleTrackFormat, b: SubtitleTrackFormat) {
	return getSubtitleFormatPriority(a) - getSubtitleFormatPriority(b) || a.localeCompare(b);
}

export function isIOSOrAndroidDevice() {
	if (typeof navigator === 'undefined') {
		return false;
	}
	const userAgent = navigator.userAgent || '';
	const platform = navigator.platform || '';
	return (
		/android|iphone|ipad|ipod/i.test(userAgent) ||
		(platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

export function compareDefaultSubtitleFormats(
	a: SubtitleTrackFormat,
	b: SubtitleTrackFormat,
	preferMobileNative: boolean
) {
	const priority = preferMobileNative
		? MOBILE_DEFAULT_SUBTITLE_FORMAT_PRIORITY
		: DEFAULT_SUBTITLE_FORMAT_PRIORITY;
	const aIndex = priority.indexOf(a);
	const bIndex = priority.indexOf(b);
	return (
		(aIndex === -1 ? priority.length : aIndex) - (bIndex === -1 ? priority.length : bIndex) ||
		a.localeCompare(b)
	);
}

export function isStoredSubtitleSelectionDisabled(selection: StoredSubtitleSelection | null) {
	return selection?.disabled === true;
}

export function getSubtitleSelectionCandidateFromStream(
	stream: Stream
): SubtitleSelectionCandidate {
	const cueForgeSubtitle = getCueForgeSubtitleInfo(stream);
	const format = getSubtitleFormat(stream.Location);
	return {
		annotated: Boolean(cueForgeSubtitle?.annotated),
		cueForge: Boolean(cueForgeSubtitle),
		format,
		label: formatSubtitlePair(stream, true),
		language: getSubtitleLanguage(stream),
		src: stream.Location,
		srcName: getSubtitleSrcName(stream.Location),
		style: getSubtitleSelectionStyle(format)
	};
}

export function getSubtitleSelectionCandidateFromTrack(
	track: SubtitleSelectionTrack
): SubtitleSelectionCandidate {
	return {
		annotated: track.annotated,
		cueForge: track.cueForge,
		format: track.format,
		label: track.label,
		language: track.language,
		src: track.src,
		srcName: getSubtitleSrcName(track.src),
		style: track.style || getSubtitleSelectionStyle(track.format)
	};
}

export function getSubtitleSelectionScore(
	candidate: SubtitleSelectionCandidate,
	selection: StoredSubtitleSelection
) {
	if (isStoredSubtitleSelectionDisabled(selection)) {
		return -1;
	}
	let score = 0;
	if (selection.src && candidate.src === selection.src) {
		score += 1000;
	}
	if (
		selection.srcName &&
		(candidate.srcName === selection.srcName ||
			getSubtitleSrcName(selection.srcName) === candidate.srcName)
	) {
		score += 500;
	}
	if (selection.src && getSubtitleSrcName(selection.src) === candidate.srcName) {
		score += 500;
	}
	if (selection.language) {
		if (!isSameSubtitleLanguage(candidate.language, selection.language)) {
			return -1;
		}
		score += candidate.language === selection.language ? 200 : 160;
	}
	if (typeof selection.cueForge === 'boolean') {
		if (candidate.cueForge !== selection.cueForge) {
			return -1;
		}
		score += 90;
	}
	if (typeof selection.annotated === 'boolean') {
		if (candidate.annotated !== selection.annotated) {
			return -1;
		}
		score += 80;
	}
	if (selection.format) {
		if (candidate.format !== selection.format) {
			return -1;
		}
		score += 70;
	}
	if (selection.style) {
		if (candidate.style !== selection.style) {
			return -1;
		}
		score += 60;
	}
	if (selection.label && candidate.label === selection.label) {
		score += 40;
	}
	return score;
}

export function findSubtitleByStoredSelection<T>(
	items: T[],
	selection: StoredSubtitleSelection | null,
	getCandidate: (item: T) => SubtitleSelectionCandidate,
	usedSrcs: string[] = []
) {
	if (!selection) {
		return null;
	}
	let bestItem: T | null = null;
	let bestScore = -1;
	for (const item of items) {
		const candidate = getCandidate(item);
		if (candidate.src && usedSrcs.includes(candidate.src)) {
			continue;
		}
		const score = getSubtitleSelectionScore(candidate, selection);
		if (score > bestScore) {
			bestItem = item;
			bestScore = score;
		}
	}
	return bestScore >= 0 ? bestItem : null;
}

export function hasDetailedStoredSubtitleSelection(selection: StoredSubtitleSelection | null) {
	return Boolean(
		selection?.annotated !== undefined ||
		selection?.cueForge !== undefined ||
		selection?.format ||
		selection?.label ||
		selection?.src ||
		selection?.srcName ||
		selection?.style
	);
}

export function pickPrioritySubtitleStreamBySelection(
	streams: Stream[],
	storedSelection: StoredSubtitleSelection | null
) {
	if (isStoredSubtitleSelectionDisabled(storedSelection)) {
		return null;
	}
	if (storedSelection) {
		const storedMatch = findSubtitleByStoredSelection(
			streams,
			storedSelection,
			getSubtitleSelectionCandidateFromStream
		);
		if (storedMatch) {
			return storedMatch;
		}
		if (storedSelection.language) {
			const storedLanguageMatch = streams.find((stream) =>
				isSameSubtitleLanguage(getSubtitleLanguage(stream), storedSelection.language || '')
			);
			if (storedLanguageMatch) {
				return storedLanguageMatch;
			}
		}
	}

	for (const language of SUBTITLE_LANGUAGE_PRIORITY) {
		const priorityMatch = streams.find(
			(stream) => getSubtitleLanguageBase(getSubtitleLanguage(stream)) === language
		);
		if (priorityMatch) {
			return priorityMatch;
		}
	}

	return streams[0] ?? null;
}

export function pickPrioritySubtitleStream(
	streams: Stream[],
	storedSelection: StoredSubtitleSelection | null,
	preferMobileNative = false
) {
	if (isStoredSubtitleSelectionDisabled(storedSelection)) {
		return null;
	}
	if (hasDetailedStoredSubtitleSelection(storedSelection)) {
		const storedMatch = findSubtitleByStoredSelection(
			streams,
			storedSelection,
			getSubtitleSelectionCandidateFromStream
		);
		if (storedMatch) {
			return storedMatch;
		}
	}

	const streamsByFormat = new Map<SubtitleTrackFormat, Stream[]>();

	for (const stream of streams) {
		const format = getSubtitleFormat(stream.Location);
		const formatStreams = streamsByFormat.get(format);
		if (formatStreams) {
			formatStreams.push(stream);
		} else {
			streamsByFormat.set(format, [stream]);
		}
	}

	for (const format of [...streamsByFormat.keys()].sort((a, b) =>
		compareDefaultSubtitleFormats(a, b, preferMobileNative && storedSelection === null)
	)) {
		const priorityMatch = pickPrioritySubtitleStreamBySelection(
			streamsByFormat.get(format) ?? [],
			storedSelection
		);
		if (priorityMatch) {
			return priorityMatch;
		}
	}

	return streams[0] ?? null;
}

export function getSubtitleFormat(src: string): SubtitleTrackFormat {
	const cleanSrc = src.split(/[?#]/)[0].toLowerCase();
	if (cleanSrc.endsWith('.ass')) {
		return 'ass';
	}
	if (cleanSrc.endsWith('.sup')) {
		return 'sup';
	}
	if (cleanSrc.endsWith('.srt')) {
		return 'srt';
	}
	return 'vtt';
}

export type SubtitleSelectionTrack = Pick<
	SubtitleSelectionCandidate,
	'annotated' | 'cueForge' | 'format' | 'language' | 'style'
> & { label: string; src: string };
