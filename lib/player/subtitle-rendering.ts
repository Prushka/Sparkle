import { defaultFallback, fallbackFontsByScript, fallbackFontsMap } from './t';
import type { SubtitleTrackInfo } from './subtitle-selection';
import { normalizeTrackLanguage, type SubtitleTrackFormat } from './track-selection';

export const ASS_BITMAP_CACHE_LIMIT_MB = 64;
export const ASS_GLYPH_CACHE_LIMIT_MB = 16;
const ASS_DEFAULT_LATIN_FONT = 'Liberation Sans';
const ASS_DEFAULT_LATIN_FONT_FILE = 'default.woff2';
const ASS_DEFAULT_UNICODE_FONT = defaultFallback[0] ?? 'Noto Sans';
const ASS_DEFAULT_UNICODE_FONT_FILE = defaultFallback[1] ?? 'NotoSans-Regular.ttf';
const ASS_ARABIC_FONT = 'Noto Naskh Arabic';
const ASS_ARABIC_FONT_FILE = 'NotoNaskhArabic-Regular.ttf';
const ASS_ARABIC_FONT_ALIASES = [
	ASS_ARABIC_FONT,
	'Adobe Arabic',
	'Arabic Typesetting',
	'Andalus',
	'Geeza Pro',
	'Sakkal Majalla',
	'Simplified Arabic',
	'Traditional Arabic',
	'Urdu Typesetting',
	'SF Arabic'
];
const ASS_ANNOTATION_FONT_ALIASES = [ASS_DEFAULT_LATIN_FONT, 'Arial', 'Arial Unicode MS'];
const ASS_ARABIC_SCRIPT_FONT = fallbackFontsByScript.Arabic[0] ?? ASS_ARABIC_FONT;
const ASS_BENGALI_FONT = fallbackFontsByScript.Bengali[0] ?? 'Noto Sans Bengali';
const ASS_CHINESE_FONT = fallbackFontsByScript.Han[0] ?? 'Noto Sans SC Thin';
// Used only for glyphs missing from the selected ASS style font; SC has the broadest shipped coverage.
const ASS_MISSING_GLYPH_FALLBACK_FONT = ASS_CHINESE_FONT;
const ASS_DEVANAGARI_FONT = fallbackFontsByScript.Devanagari[0] ?? 'Noto Sans Devanagari';
const ASS_ETHIOPIC_FONT = fallbackFontsByScript.Ethiopic[0] ?? 'Noto Sans Ethiopic';
const ASS_GEORGIAN_FONT = 'Noto Sans Georgian';
const ASS_GUJARATI_FONT = fallbackFontsByScript.Gujarati[0] ?? 'Noto Sans Gujarati';
const ASS_GURMUKHI_FONT = fallbackFontsByScript.Gurmukhi[0] ?? 'Noto Sans Gurmukhi';
const ASS_HEBREW_FONT = fallbackFontsByScript.Hebrew[0] ?? 'Noto Sans Hebrew';
const ASS_JAPANESE_FONT = fallbackFontsByScript.Japanese[0] ?? 'Noto Sans JP Thin';
const ASS_KANNADA_FONT = fallbackFontsByScript.Kannada[0] ?? 'Noto Sans Kannada';
const ASS_KHMER_FONT = fallbackFontsByScript.Khmer[0] ?? 'Noto Sans Khmer';
const ASS_KOREAN_FONT = fallbackFontsByScript.Hangul[0] ?? 'NanumGothicCoding';
const ASS_LAO_FONT = 'Noto Sans Lao';
const ASS_MALAYALAM_FONT = fallbackFontsByScript.Malayalam[0] ?? 'Noto Sans Malayalam';
const ASS_MYANMAR_FONT = fallbackFontsByScript.Myanmar[0] ?? 'Noto Sans Myanmar';
const ASS_NKO_FONT = fallbackFontsByScript.NKo[0] ?? 'Noto Sans NKo';
const ASS_ORIYA_FONT = fallbackFontsByScript.Oriya[0] ?? 'Noto Sans Oriya';
const ASS_SINHALA_FONT = fallbackFontsByScript.Sinhala[0] ?? 'Noto Sans Sinhala';
const ASS_TAMIL_FONT = fallbackFontsByScript.Tamil[0] ?? 'Noto Sans Tamil';
const ASS_TELUGU_FONT = fallbackFontsByScript.Telugu[0] ?? 'Noto Sans Telugu';
const ASS_THAI_FONT = fallbackFontsByScript.Thai[0] ?? 'Noto Sans Thai';
const ASS_TIFINAGH_FONT = fallbackFontsByScript.Tifinagh[0] ?? 'Noto Sans Tifinagh';
const ASS_COMMON_PLATFORM_FONT_ALIASES = [
	'Aharoni',
	'Apple SD Gothic Neo',
	'Arial',
	'Arial Black',
	'Arial Cyr',
	'Arial Greek',
	'Arial Narrow',
	'Arial Unicode MS',
	'Aparajita',
	'Batang',
	'Browallia New',
	'Calibri',
	'Cambria',
	'Cordia New',
	'Courier New',
	'DaunPenh',
	'David',
	'DejaVu Sans',
	'DengXian',
	'DokChampa',
	'Dotum',
	'Ebrima',
	'FangSong',
	'FrankRuehl',
	'Gautami',
	'Georgia',
	'Gulim',
	'Gungsuh',
	'Heiti SC',
	'Helvetica',
	'Helvetica Neue',
	'Hiragino Kaku Gothic ProN',
	'Hiragino Sans',
	'Iskoola Pota',
	'KaiTi',
	'Kalinga',
	'Kartika',
	'Khmer UI',
	'Kokila',
	'Krungthep',
	'Latha',
	'Lao UI',
	'Leelawadee',
	'Leelawadee UI',
	'Levenim MT',
	'Lucida Grande',
	'Lucida Sans Unicode',
	'Malgun Gothic',
	'Mangal',
	'Meiryo',
	'Microsoft Sans Serif',
	'Microsoft YaHei',
	'Microsoft JhengHei',
	'MingLiU',
	'Miriam',
	'MS Gothic',
	'MS Mincho',
	'MS PGothic',
	'MS PMincho',
	'MS Sans Serif',
	'MoolBoran',
	'Myanmar Text',
	'Narkisim',
	'Nirmala UI',
	'NSimSun',
	'Nyala',
	'Osaka',
	'Padauk',
	'PingFang SC',
	'PMingLiU',
	'Raavi',
	'Segoe UI',
	'Shonar Bangla',
	'SimHei',
	'SimKai',
	'SimSun',
	'Songti SC',
	'Shruti',
	'STHeiti',
	'STSong',
	'Sylfaen',
	'Tahoma',
	'Times New Roman Cyr',
	'Times New Roman Greek',
	'Times New Roman',
	'Trebuchet MS',
	'Tunga',
	'Utsaah',
	'Vani',
	'Verdana',
	'Vijaya',
	'Vrinda',
	'Yu Gothic',
	'sans-serif',
	'serif'
];
const ASS_COMMON_PLATFORM_FONT_ALIAS_SET = new Set(
	ASS_COMMON_PLATFORM_FONT_ALIASES.map(normalizeAssFontLookupName)
);
const ASS_SCRIPT_FALLBACK_FONTS = [
	{
		family: ASS_ARABIC_SCRIPT_FONT,
		filename: fallbackFontsByScript.Arabic[1] ?? ASS_ARABIC_FONT_FILE,
		pattern: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/
	},
	{
		family: ASS_JAPANESE_FONT,
		filename: fallbackFontsByScript.Japanese[1] ?? 'NotoSansJP-VariableFont_wght.ttf',
		pattern: /[\u3040-\u30ff]/
	},
	{
		family: ASS_KOREAN_FONT,
		filename: fallbackFontsByScript.Hangul[1] ?? 'NanumGothicCoding-Regular.ttf',
		pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/
	},
	{
		family: ASS_CHINESE_FONT,
		filename: fallbackFontsByScript.Han[1] ?? 'NotoSansSC-VariableFont_wght.ttf',
		pattern: /[\u3400-\u9fff\uf900-\ufaff]/
	},
	{
		family: ASS_HEBREW_FONT,
		filename: fallbackFontsByScript.Hebrew[1] ?? 'NotoSansHebrew-Regular.ttf',
		pattern: /[\u0590-\u05ff]/
	},
	{
		family: ASS_DEVANAGARI_FONT,
		filename: fallbackFontsByScript.Devanagari[1] ?? 'NotoSansDevanagari-Regular.ttf',
		pattern: /[\u0900-\u097f]/
	},
	{
		family: ASS_BENGALI_FONT,
		filename: fallbackFontsByScript.Bengali[1] ?? 'NotoSansBengali-Regular.ttf',
		pattern: /[\u0980-\u09ff]/
	},
	{
		family: ASS_GURMUKHI_FONT,
		filename: fallbackFontsByScript.Gurmukhi[1] ?? 'NotoSansGurmukhi-Regular.ttf',
		pattern: /[\u0a00-\u0a7f]/
	},
	{
		family: ASS_GUJARATI_FONT,
		filename: fallbackFontsByScript.Gujarati[1] ?? 'NotoSansGujarati-Regular.ttf',
		pattern: /[\u0a80-\u0aff]/
	},
	{
		family: ASS_ORIYA_FONT,
		filename: fallbackFontsByScript.Oriya[1] ?? 'NotoSansOriya-Regular.ttf',
		pattern: /[\u0b00-\u0b7f]/
	},
	{
		family: ASS_TAMIL_FONT,
		filename: fallbackFontsByScript.Tamil[1] ?? 'NotoSansTamil-Regular.ttf',
		pattern: /[\u0b80-\u0bff]/
	},
	{
		family: ASS_TELUGU_FONT,
		filename: fallbackFontsByScript.Telugu[1] ?? 'NotoSansTelugu-Regular.ttf',
		pattern: /[\u0c00-\u0c7f]/
	},
	{
		family: ASS_KANNADA_FONT,
		filename: fallbackFontsByScript.Kannada[1] ?? 'NotoSansKannada-Regular.ttf',
		pattern: /[\u0c80-\u0cff]/
	},
	{
		family: ASS_MALAYALAM_FONT,
		filename: fallbackFontsByScript.Malayalam[1] ?? 'NotoSansMalayalam-Regular.ttf',
		pattern: /[\u0d00-\u0d7f]/
	},
	{
		family: ASS_SINHALA_FONT,
		filename: fallbackFontsByScript.Sinhala[1] ?? 'NotoSansSinhala-Regular.ttf',
		pattern: /[\u0d80-\u0dff]/
	},
	{
		family: ASS_THAI_FONT,
		filename: fallbackFontsByScript.Thai[1] ?? 'NotoSansThai-Regular.ttf',
		pattern: /[\u0e00-\u0e7f]/
	},
	{ family: ASS_LAO_FONT, filename: 'NotoSansLao-Regular.ttf', pattern: /[\u0e80-\u0eff]/ },
	{
		family: ASS_MYANMAR_FONT,
		filename: fallbackFontsByScript.Myanmar[1] ?? 'NotoSansMyanmar-Regular.ttf',
		pattern: /[\u1000-\u109f]/
	},
	{
		family: ASS_ETHIOPIC_FONT,
		filename: fallbackFontsByScript.Ethiopic[1] ?? 'NotoSansEthiopic-Regular.ttf',
		pattern: /[\u1200-\u137f]/
	},
	{
		family: ASS_KHMER_FONT,
		filename: fallbackFontsByScript.Khmer[1] ?? 'NotoSansKhmer-Regular.ttf',
		pattern: /[\u1780-\u17ff]/
	},
	{
		family: ASS_NKO_FONT,
		filename: fallbackFontsByScript.NKo[1] ?? 'NotoSansNKo-Regular.ttf',
		pattern: /[\u07c0-\u07ff]/
	},
	{
		family: 'Noto Sans Armenian',
		filename: 'NotoSansArmenian-Regular.ttf',
		pattern: /[\u0530-\u058f]/
	},
	{
		family: 'Noto Sans Georgian',
		filename: 'NotoSansGeorgian-Regular.ttf',
		pattern: /[\u10a0-\u10ff\u1c90-\u1cbf]/
	},
	{
		family: ASS_TIFINAGH_FONT,
		filename: fallbackFontsByScript.Tifinagh[1] ?? 'NotoSansTifinagh-Regular.ttf',
		pattern: /[\u2d30-\u2d7f]/
	},
	{
		family: ASS_DEFAULT_UNICODE_FONT,
		filename: ASS_DEFAULT_UNICODE_FONT_FILE,
		pattern: /[\u00a0-\u024f\u0370-\u052f\u1e00-\u1eff]/
	}
] as const;
const ASS_NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const MERGED_SUBTITLE_FONT_SCALE_STEP = 0.12;
const MERGED_ASS_SUBTITLE_MIN_FONT_SCALE = 0.7;
const MERGED_VTT_SUBTITLE_MIN_FONT_SCALE = 0.5;

type AssParsedDocument = {
	content: string;
	eventColumns: string[];
	events: AssParsedEvent[];
	fontSections: string[];
	header: string;
	playResX: number | null;
	playResY: number | null;
	styleColumns: string[];
	styles: AssParsedStyle[];
	track: Pick<SubtitleTrackInfo, 'language'>;
};

type AssParsedStyle = {
	values: Record<string, string>;
};

type AssParsedEvent = {
	endTime: number;
	startTime: number;
	values: Record<string, string>;
};

const ASS_STYLE_COLUMNS = [
	'Name',
	'Fontname',
	'Fontsize',
	'PrimaryColour',
	'SecondaryColour',
	'OutlineColour',
	'BackColour',
	'Bold',
	'Italic',
	'Underline',
	'StrikeOut',
	'ScaleX',
	'ScaleY',
	'Spacing',
	'Angle',
	'BorderStyle',
	'Outline',
	'Shadow',
	'Alignment',
	'MarginL',
	'MarginR',
	'MarginV',
	'Encoding'
] as const;
const ASS_EVENT_COLUMNS = [
	'Layer',
	'Start',
	'End',
	'Style',
	'Name',
	'MarginL',
	'MarginR',
	'MarginV',
	'Effect',
	'Text'
] as const;
const ASS_STYLE_DEFAULTS: Record<string, string> = {
	name: 'Default',
	fontname: 'Arial',
	fontsize: '20',
	primarycolour: '&H00FFFFFF',
	secondarycolour: '&H000000FF',
	outlinecolour: '&H00000000',
	backcolour: '&H00000000',
	bold: '0',
	italic: '0',
	underline: '0',
	strikeout: '0',
	scalex: '100',
	scaley: '100',
	spacing: '0',
	angle: '0',
	borderstyle: '1',
	outline: '2',
	shadow: '2',
	alignment: '2',
	marginl: '10',
	marginr: '10',
	marginv: '10',
	encoding: '1'
};
const ASS_EVENT_DEFAULTS: Record<string, string> = {
	layer: '0',
	start: '0:00:00.00',
	end: '0:00:00.00',
	style: 'Default',
	name: '',
	marginl: '0',
	marginr: '0',
	marginv: '0',
	effect: '',
	text: ''
};
export const EMPTY_ASS_TRACK = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const ASS_RENDERER_FONT_NORMALIZATION_MARKER = '; Sparkle-Ass-Renderer-Fonts-Normalized: per-track';
export function getMergedSubtitleFontScale(
	count: number,
	minScale = MERGED_ASS_SUBTITLE_MIN_FONT_SCALE
) {
	return Math.max(minScale, 1 - Math.max(0, count - 1) * MERGED_SUBTITLE_FONT_SCALE_STEP);
}

export function getMergedSubtitleMinFontScale(format: SubtitleTrackFormat | null) {
	return format === 'vtt' ? MERGED_VTT_SUBTITLE_MIN_FONT_SCALE : MERGED_ASS_SUBTITLE_MIN_FONT_SCALE;
}

function parseAssTimestamp(value: string) {
	const match = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.](\d{1,3}))?$/);
	if (!match) {
		return Number.POSITIVE_INFINITY;
	}
	const hours = Number.parseInt(match[1], 10);
	const minutes = Number.parseInt(match[2], 10);
	const seconds = Number.parseInt(match[3], 10);
	const fractionText = match[4] ?? '';
	const fraction = fractionText ? Number.parseInt(fractionText.padEnd(3, '0'), 10) / 1000 : 0;
	return hours * 3600 + minutes * 60 + seconds + fraction;
}

function normalizeAssColumnName(value: string) {
	return value.trim().toLowerCase();
}

function splitAssValues(value: string, count: number) {
	const values: string[] = [];
	let cursor = 0;
	for (let index = 0; index < value.length && values.length < count - 1; index++) {
		if (value[index] !== ',') {
			continue;
		}
		values.push(value.slice(cursor, index).trim());
		cursor = index + 1;
	}
	values.push(value.slice(cursor).trim());
	while (values.length < count) {
		values.push('');
	}
	return values;
}

function assValue(
	values: Record<string, string>,
	column: string,
	defaults: Record<string, string>
) {
	const key = normalizeAssColumnName(column);
	return values[key] ?? defaults[key] ?? '';
}

export function parseAssDocument(
	content: string,
	track: Pick<SubtitleTrackInfo, 'language'>,
	fallbackContent = EMPTY_ASS_TRACK
): AssParsedDocument {
	const lines = (content || fallbackContent).replace(/\r\n?/g, '\n').split('\n');
	const structuralIndex = lines.findIndex((line) =>
		/^\[(?:v4\+?\s+styles|events)\]\s*$/i.test(line)
	);
	const header = (structuralIndex >= 0 ? lines.slice(0, structuralIndex) : lines)
		.join('\n')
		.trimEnd();
	let section = '';
	let styleColumns = ASS_STYLE_COLUMNS.map(String);
	let eventColumns = ASS_EVENT_COLUMNS.map(String);
	let playResX: number | null = null;
	let playResY: number | null = null;
	const styles: AssParsedStyle[] = [];
	const events: AssParsedEvent[] = [];
	const fontSections: string[] = [];
	let activeFontSection: string[] | null = null;

	const flushActiveFontSection = () => {
		const fontSection = activeFontSection?.join('\n').trimEnd();
		if (fontSection) {
			fontSections.push(fontSection);
		}
		activeFontSection = null;
	};

	for (const line of lines) {
		const playResXMatch = line.match(/^PlayResX:\s*(\d+(?:\.\d+)?)/i);
		if (playResXMatch) {
			playResX = Number.parseFloat(playResXMatch[1]);
		}
		const playResYMatch = line.match(/^PlayResY:\s*(\d+(?:\.\d+)?)/i);
		if (playResYMatch) {
			playResY = Number.parseFloat(playResYMatch[1]);
		}
		const sectionMatch = line.match(/^\[(.*)\]\s*$/);
		if (sectionMatch) {
			flushActiveFontSection();
			section = sectionMatch[1].trim().toLowerCase();
			activeFontSection = section === 'fonts' ? [] : null;
			continue;
		}
		if (section === 'fonts') {
			activeFontSection?.push(line);
			continue;
		}
		const separatorIndex = line.indexOf(':');
		if (separatorIndex === -1) {
			continue;
		}
		const key = line.slice(0, separatorIndex).trim().toLowerCase();
		const rawValue = line.slice(separatorIndex + 1).trim();
		if (section === 'v4+ styles' || section === 'v4 styles') {
			if (key === 'format') {
				styleColumns = rawValue.split(',').map((value) => value.trim());
				continue;
			}
			if (key !== 'style') {
				continue;
			}
			const rawValues = splitAssValues(rawValue, styleColumns.length);
			const values: Record<string, string> = {};
			for (let index = 0; index < styleColumns.length; index++) {
				values[normalizeAssColumnName(styleColumns[index])] = rawValues[index] ?? '';
			}
			styles.push({ values });
			continue;
		}
		if (section === 'events') {
			if (key === 'format') {
				eventColumns = rawValue.split(',').map((value) => value.trim());
				continue;
			}
			if (key !== 'dialogue') {
				continue;
			}
			const rawValues = splitAssValues(rawValue, eventColumns.length);
			const values: Record<string, string> = {};
			for (let index = 0; index < eventColumns.length; index++) {
				values[normalizeAssColumnName(eventColumns[index])] = rawValues[index] ?? '';
			}
			events.push({
				endTime: parseAssTimestamp(assValue(values, 'End', ASS_EVENT_DEFAULTS)),
				startTime: parseAssTimestamp(assValue(values, 'Start', ASS_EVENT_DEFAULTS)),
				values
			});
		}
	}

	flushActiveFontSection();

	return {
		content,
		eventColumns,
		events,
		fontSections,
		header: header.trimEnd(),
		playResX: Number.isFinite(playResX) ? playResX : null,
		playResY: Number.isFinite(playResY) ? playResY : null,
		styleColumns,
		styles,
		track
	};
}

function getAssStyleName(style: AssParsedStyle) {
	return assValue(style.values, 'Name', ASS_STYLE_DEFAULTS);
}

function normalizeAssStyleKey(styleName: string) {
	return styleName.trim().toLowerCase();
}

function getAssDocumentStyles(document: AssParsedDocument) {
	return document.styles.length > 0
		? document.styles
		: parseAssDocument(
				normalizeAssRendererFonts(EMPTY_ASS_TRACK, document.track.language),
				document.track
			).styles;
}

function getAssMergedStyleName(styleName: string, documentIndex: number) {
	return `sparkle_${documentIndex}_${(styleName.trim() || ASS_STYLE_DEFAULTS.name).replace(
		/,/g,
		'_'
	)}`;
}

function getAssStyleNameMap(document: AssParsedDocument, documentIndex: number) {
	const styleNameMap = new Map<string, string>();
	for (const style of getAssDocumentStyles(document)) {
		const styleName = getAssStyleName(style) || ASS_STYLE_DEFAULTS.name;
		styleNameMap.set(
			normalizeAssStyleKey(styleName),
			getAssMergedStyleName(styleName, documentIndex)
		);
	}
	if (!styleNameMap.has(normalizeAssStyleKey(ASS_STYLE_DEFAULTS.name))) {
		styleNameMap.set(
			normalizeAssStyleKey(ASS_STYLE_DEFAULTS.name),
			getAssMergedStyleName(ASS_STYLE_DEFAULTS.name, documentIndex)
		);
	}
	return styleNameMap;
}

function getMappedAssStyleName(
	styleName: string,
	styleNameMap: Map<string, string>,
	fallbackStyleName: string
) {
	const normalizedStyleName = normalizeAssStyleKey(styleName);
	return styleNameMap.get(normalizedStyleName) ?? fallbackStyleName;
}

function namespaceAssStyleResetOverrides(text: string, styleNameMap: Map<string, string>) {
	return text.replace(/\{([^}]*)\}/g, (_, overrideText: string) => {
		const namespacedOverrideText = overrideText.replace(
			/\\r([^\\}]*)/gi,
			(match, styleName: string) => {
				const trimmedStyleName = styleName.trim();
				if (!trimmedStyleName) {
					return '\\r';
				}
				const mappedStyleName = styleNameMap.get(normalizeAssStyleKey(trimmedStyleName));
				return mappedStyleName ? `\\r${mappedStyleName}` : match;
			}
		);
		return `{${namespacedOverrideText}}`;
	});
}

function formatScaledAssNumber(value: string, scale: number, integer = false) {
	if (scale === 1) {
		return value;
	}
	const trimmedValue = value.trim();
	if (!ASS_NUMBER_PATTERN.test(trimmedValue)) {
		return value;
	}
	const numericValue = Number.parseFloat(trimmedValue);
	if (!Number.isFinite(numericValue)) {
		return value;
	}
	const scaledValue = integer
		? Math.round(numericValue * scale)
		: Math.round(numericValue * scale * 1000) / 1000;
	if (Object.is(scaledValue, -0)) {
		return '0';
	}
	return String(scaledValue);
}

function scaleAssStyleValues(values: Record<string, string>, scale: number) {
	if (scale === 1) {
		return values;
	}
	for (const key of ['fontsize', 'spacing', 'outline', 'shadow']) {
		values[key] = formatScaledAssNumber(values[key] ?? '', scale);
	}
	for (const key of ['marginl', 'marginr', 'marginv']) {
		values[key] = formatScaledAssNumber(values[key] ?? '', scale, true);
	}
	return values;
}

function scaleAssEventMargins(values: Record<string, string>, scale: number) {
	if (scale === 1) {
		return values;
	}
	for (const key of ['marginl', 'marginr', 'marginv']) {
		values[key] = formatScaledAssNumber(values[key] ?? '', scale, true);
	}
	return values;
}

function scaleAssOverrideText(text: string, scale: number) {
	if (scale === 1) {
		return text;
	}
	return text.replace(
		/\\(fs|fsp|bord|xbord|ybord|shad|xshad|yshad|blur|be)(-?(?:\d+(?:\.\d+)?|\.\d+))/gi,
		(match, tag: string, value: string) => {
			const scaledValue = formatScaledAssNumber(value, scale, tag.toLowerCase() === 'be');
			return scaledValue === value ? match : `\\${tag}${scaledValue}`;
		}
	);
}

function normalizeAssFontLookupName(fontName: string) {
	return fontName.trim().replace(/^@/, '').toLowerCase();
}

function getAssRendererLanguageFallbackFont(language: string | null | undefined) {
	const normalizedLanguage = language ? normalizeTrackLanguage(language).trim().toLowerCase() : '';
	if (!normalizedLanguage) {
		return null;
	}
	const fallbackEntry = Object.entries(fallbackFontsMap).find(([languageTag]) => {
		const normalizedLanguageTag = languageTag.toLowerCase();
		return (
			normalizedLanguageTag === normalizedLanguage ||
			normalizedLanguageTag.split('-')[0] === normalizedLanguage
		);
	});
	return fallbackEntry?.[1]?.[0] ?? null;
}

function getAssRendererScriptFallbackFont(content: string, language?: string | null) {
	const languageFallback = getAssRendererLanguageFallbackFont(language);
	if (languageFallback) {
		return languageFallback;
	}
	return ASS_SCRIPT_FALLBACK_FONTS.find(({ pattern }) => pattern.test(content))?.family ?? null;
}

function shouldUseAssRendererScriptFallback(fontName: string) {
	const normalizedFontName = normalizeAssFontLookupName(fontName);
	return normalizedFontName ? ASS_COMMON_PLATFORM_FONT_ALIAS_SET.has(normalizedFontName) : false;
}

function getAssRendererFontName(
	fontName: string,
	options: { fallbackFont?: string | null; phoneticAnnotation?: boolean } = {}
) {
	const normalizedFontName = normalizeAssFontLookupName(fontName);
	if (ASS_ARABIC_FONT_ALIASES.some((alias) => alias.toLowerCase() === normalizedFontName)) {
		return ASS_ARABIC_FONT;
	}
	const annotationFont = ASS_ANNOTATION_FONT_ALIASES.some(
		(alias) => alias.toLowerCase() === normalizedFontName
	);
	if (options.phoneticAnnotation && annotationFont) {
		return ASS_DEFAULT_LATIN_FONT;
	}
	if (options.fallbackFont && shouldUseAssRendererScriptFallback(fontName)) {
		return options.fallbackFont;
	}
	return fontName;
}

function isAssPhoneticAnnotationOverride(text: string) {
	return (
		/\\c&HAAEBFF&/i.test(text) && /\\fscx60(?:\.0+)?/i.test(text) && /\\fscy60(?:\.0+)?/i.test(text)
	);
}

function normalizeAssRendererOverrideFonts(text: string, fallbackFont: string | null) {
	return text.replace(/\{([^}]*)\}/g, (block, overrideText: string) => {
		const phoneticAnnotation = isAssPhoneticAnnotationOverride(overrideText);
		return `{${overrideText.replace(/\\fn([^\\}]*)/gi, (match, fontName: string) => {
			const rendererFontName = getAssRendererFontName(fontName, {
				fallbackFont,
				phoneticAnnotation
			});
			return rendererFontName === fontName ? match : `\\fn${rendererFontName}`;
		})}}`;
	});
}

function normalizeAssRendererStyleFonts(content: string, fallbackFont: string | null) {
	let section = '';
	let styleColumns = ASS_STYLE_COLUMNS.map(String);
	return content
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => {
			const sectionMatch = line.match(/^\[(.*)\]\s*$/);
			if (sectionMatch) {
				section = sectionMatch[1].trim().toLowerCase();
				return line;
			}
			if (section !== 'v4+ styles' && section !== 'v4 styles') {
				return line;
			}
			const separatorIndex = line.indexOf(':');
			if (separatorIndex === -1) {
				return line;
			}
			const key = line.slice(0, separatorIndex).trim().toLowerCase();
			const rawValue = line.slice(separatorIndex + 1).trim();
			if (key === 'format') {
				styleColumns = rawValue.split(',').map((value) => value.trim());
				return line;
			}
			if (key !== 'style') {
				return line;
			}
			const fontNameIndex = styleColumns.findIndex(
				(column) => normalizeAssColumnName(column) === 'fontname'
			);
			if (fontNameIndex === -1) {
				return line;
			}
			const values = splitAssValues(rawValue, styleColumns.length);
			const rendererFontName = getAssRendererFontName(values[fontNameIndex] ?? '', {
				fallbackFont
			});
			if (rendererFontName === values[fontNameIndex]) {
				return line;
			}
			values[fontNameIndex] = rendererFontName;
			return `${line.slice(0, separatorIndex + 1)} ${values.join(',')}`;
		})
		.join('\n');
}

export function normalizeAssRendererFonts(content: string, language?: string | null) {
	const fallbackFont = getAssRendererScriptFallbackFont(content, language);
	return normalizeAssRendererOverrideFonts(
		normalizeAssRendererStyleFonts(content, fallbackFont),
		fallbackFont
	);
}

export function markAssRendererFontsNormalized(content: string) {
	if (content.includes(ASS_RENDERER_FONT_NORMALIZATION_MARKER)) {
		return content;
	}
	const normalizedContent = content.replace(/\r\n?/g, '\n');
	const lines = normalizedContent.split('\n');
	const scriptInfoIndex = lines.findIndex((line) => /^\[script info\]\s*$/i.test(line));
	if (scriptInfoIndex >= 0) {
		lines.splice(scriptInfoIndex + 1, 0, ASS_RENDERER_FONT_NORMALIZATION_MARKER);
		return lines.join('\n');
	}
	return `${ASS_RENDERER_FONT_NORMALIZATION_MARKER}\n${normalizedContent}`;
}

export function areAssRendererFontsNormalized(content: string) {
	return content.includes(ASS_RENDERER_FONT_NORMALIZATION_MARKER);
}

function createNamespacedAssStyleValues(
	style: AssParsedStyle,
	styleNameMap: Map<string, string>,
	scale: number
) {
	const styleName = getAssStyleName(style) || ASS_STYLE_DEFAULTS.name;
	const values: Record<string, string> = {};
	for (const column of ASS_STYLE_COLUMNS) {
		values[normalizeAssColumnName(column)] = assValue(style.values, column, ASS_STYLE_DEFAULTS);
	}
	values.name = getMappedAssStyleName(styleName, styleNameMap, ASS_STYLE_DEFAULTS.name);
	return scaleAssStyleValues(values, scale);
}

function createNamespacedAssEventValues(
	event: AssParsedEvent,
	styleNameMap: Map<string, string>,
	scale: number
) {
	const fallbackStyleName =
		styleNameMap.get(normalizeAssStyleKey(ASS_STYLE_DEFAULTS.name)) ?? ASS_STYLE_DEFAULTS.name;
	const values: Record<string, string> = {};
	for (const column of ASS_EVENT_COLUMNS) {
		values[normalizeAssColumnName(column)] = assValue(event.values, column, ASS_EVENT_DEFAULTS);
	}
	values.style = getMappedAssStyleName(values.style, styleNameMap, fallbackStyleName);
	values.text = scaleAssOverrideText(
		namespaceAssStyleResetOverrides(values.text, styleNameMap),
		scale
	);
	return scaleAssEventMargins(values, scale);
}

function serializeAssRow(
	columns: readonly string[],
	values: Record<string, string>,
	defaults: Record<string, string>
) {
	return columns.map((column) => assValue(values, column, defaults)).join(',');
}

function serializeAssStyle(values: Record<string, string>) {
	return `Style: ${serializeAssRow(ASS_STYLE_COLUMNS, values, ASS_STYLE_DEFAULTS)}`;
}

function serializeAssEvent(values: Record<string, string>) {
	return `Dialogue: ${serializeAssRow(ASS_EVENT_COLUMNS, values, ASS_EVENT_DEFAULTS)}`;
}

function serializeMergedAssHeader(document: AssParsedDocument) {
	return document.header.trimEnd() || '[Script Info]\nScriptType: v4.00+';
}

function serializeMergedAssFontSections(documents: AssParsedDocument[]) {
	const fontSections: string[] = [];
	const emittedFontSections = new Set<string>();
	for (const document of documents) {
		for (const fontSection of document.fontSections) {
			const normalizedFontSection = fontSection.trim();
			if (!normalizedFontSection || emittedFontSections.has(normalizedFontSection)) {
				continue;
			}
			emittedFontSections.add(normalizedFontSection);
			fontSections.push(normalizedFontSection);
		}
	}
	return fontSections.length > 0 ? `\n[Fonts]\n${fontSections.join('\n')}\n` : '';
}

function getAssResolution(document: AssParsedDocument) {
	// libass uses 384x288 when both dimensions are absent, and infers the
	// missing dimension at 4:3 (apart from its conventional 1280x1024 case).
	let x = document.playResX ?? 0,
		y = document.playResY ?? 0;
	if (x <= 0 && y <= 0) return { x: 384, y: 288 };
	if (x <= 0) x = y === 1024 ? 1280 : Math.floor((y * 4) / 3);
	if (y <= 0) y = x === 1280 ? 1024 : Math.max(1, Math.floor((x * 3) / 4));
	return { x, y };
}

function rescaleAssDrawing(drawing: string, x: number, y: number) {
	let coordinate = 0;
	return drawing.replace(/-?(?:\d+(?:\.\d+)?|\.\d+)/g, (value) =>
		formatScaledAssNumber(value, coordinate++ % 2 ? y : x)
	);
}

function rescaleAssCoordinates(text: string, x: number, y: number) {
	let drawing = false;
	return text
		.split(/(\{[^}]*\})/g)
		.map((part) => {
			if (!part.startsWith('{')) return drawing ? rescaleAssDrawing(part, x, y) : part;
			const drawingMode = [...part.matchAll(/\\p(\d+)/gi)].at(-1);
			if (drawingMode) drawing = Number(drawingMode[1]) > 0;
			return part
				.replace(/\\(pos|org|move|i?clip)\(([^()]*)\)/gi, (match, tag: string, args: string) => {
					const values = args.split(',').map((value) => value.trim());
					if (values.every((value) => ASS_NUMBER_PATTERN.test(value))) {
						const count = /^(pos|org)$/i.test(tag) ? 2 : 4;
						if (values.length < count) return match;
						return `\\${tag}(${values.map((value, index) => (index < count ? formatScaledAssNumber(value, index % 2 ? y : x) : value)).join(',')})`;
					}
					if (/clip$/i.test(tag)) {
						// Vector clips optionally begin with a drawing-scale exponent.
						const prefix =
							values.length === 2 && ASS_NUMBER_PATTERN.test(values[0]) ? `${values.shift()},` : '';
						return `\\${tag}(${prefix}${rescaleAssDrawing(values.join(','), x, y)})`;
					}
					return match;
				})
				.replace(
					/\\(pbo)(-?(?:\d+(?:\.\d+)?|\.\d+))/gi,
					(_, tag: string, value: string) => `\\${tag}${formatScaledAssNumber(value, y)}`
				);
		})
		.join('');
}

/** ASS tracks in the same MKV can author their styles in different coordinate
 * systems. Bring each into the primary script's resolution before composing. */
function normalizeAssResolution(document: AssParsedDocument, primary: AssParsedDocument) {
	const source = getAssResolution(document),
		target = getAssResolution(primary);
	const x = target.x / source.x,
		y = target.y / source.y;
	if (x === 1 && y === 1) return document;
	const margins = (values: Record<string, string>) => {
		const scaled = { ...values };
		for (const key of ['marginl', 'marginr'])
			scaled[key] = formatScaledAssNumber(values[key] ?? '', x, true);
		scaled.marginv = formatScaledAssNumber(values.marginv ?? '', y, true);
		return scaled;
	};
	return {
		...document,
		styles: getAssDocumentStyles(document).map((style) => {
			const values = scaleAssStyleValues({ ...style.values }, y);
			Object.assign(values, {
				marginl: margins(style.values).marginl,
				marginr: margins(style.values).marginr
			});
			values.scalex = formatScaledAssNumber(style.values.scalex ?? '100', x / y);
			return { values };
		}),
		events: document.events.map((event) => ({
			...event,
			values: {
				...margins(event.values),
				text: rescaleAssCoordinates(scaleAssOverrideText(event.values.text, y), x, y)
			}
		}))
	};
}

export function serializeMergedAss(
	documents: AssParsedDocument[],
	scale = getMergedSubtitleFontScale(documents.length)
) {
	if (documents.length === 0) {
		return '';
	}
	const primaryDocument = documents[0];
	const styles: string[] = [];
	const events: string[] = [];
	const emittedStyleNames = new Set<string>();

	documents.forEach((document, documentIndex) => {
		document = normalizeAssResolution(document, primaryDocument);
		const styleNameMap = getAssStyleNameMap(document, documentIndex);
		for (const style of getAssDocumentStyles(document)) {
			const values = createNamespacedAssStyleValues(style, styleNameMap, scale);
			const styleName = normalizeAssStyleKey(values.name);
			if (emittedStyleNames.has(styleName)) {
				continue;
			}
			emittedStyleNames.add(styleName);
			styles.push(serializeAssStyle(values));
		}
		for (const event of document.events) {
			if (
				!Number.isFinite(event.startTime) ||
				!Number.isFinite(event.endTime) ||
				event.endTime <= event.startTime
			) {
				continue;
			}
			events.push(serializeAssEvent(createNamespacedAssEventValues(event, styleNameMap, scale)));
		}
	});

	return `${serializeMergedAssHeader(primaryDocument)}

[V4+ Styles]
Format: ${ASS_STYLE_COLUMNS.join(', ')}
${styles.join('\n')}

[Events]
Format: ${ASS_EVENT_COLUMNS.join(', ')}
${events.join('\n')}
${serializeMergedAssFontSections(documents)}`;
}

export function getPublicAssetUrl(src: string) {
	if (/^(https?:)?\/\//.test(src) || src.startsWith('/')) {
		return src;
	}
	return `/scripts/${src}`;
}

/** The same locally hosted fallback families are available to every ASS renderer. */
export function getAssFallbackFonts() {
	const availableFonts: Record<string, string> = {};
	availableFonts[ASS_DEFAULT_LATIN_FONT.toLowerCase()] = getPublicAssetUrl(
		ASS_DEFAULT_LATIN_FONT_FILE
	);
	for (const family of ASS_ARABIC_FONT_ALIASES)
		availableFonts[family.toLowerCase()] = getPublicAssetUrl(ASS_ARABIC_FONT_FILE);
	for (const { family, filename } of ASS_SCRIPT_FALLBACK_FONTS)
		availableFonts[family.toLowerCase()] = getPublicAssetUrl(filename);
	for (const [family, filename] of [defaultFallback, ...Object.values(fallbackFontsMap)]) {
		if (family && filename) availableFonts[family.toLowerCase()] = getPublicAssetUrl(filename);
	}
	return {
		availableFonts,
		fonts: [...new Set(Object.values(availableFonts))],
		fallbackFont: ASS_MISSING_GLYPH_FALLBACK_FONT.toLowerCase()
	};
}

/** FFmpeg packets contain Matroska ASS chunks; libmedia emits Dialogue lines.
 * Normalize the packet envelope without changing authored text or override tags. */
export function assPacketDialogue(data: string, pts: number, duration: number) {
	if (/^Dialogue:/i.test(data)) return data;
	const fields = splitAssValues(data, 9);
	const timestamp = (ms: number) => {
		const cs = Math.max(0, Math.round(ms / 10));
		return (
			Math.floor(cs / 360000) +
			':' +
			String(Math.floor(cs / 6000) % 60).padStart(2, '0') +
			':' +
			String(Math.floor(cs / 100) % 60).padStart(2, '0') +
			'.' +
			String(cs % 100).padStart(2, '0')
		);
	};
	return (
		'Dialogue: ' +
		[fields[1], timestamp(pts), timestamp(pts + duration), ...fields.slice(2)].join(',')
	);
}
