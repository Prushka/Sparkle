export type CueForgeLanguage = {
	ids: readonly string[];
	name: string;
};

export type CueForgeLanguageScript =
	| 'Arabic'
	| 'Bengali'
	| 'Cyrillic'
	| 'Devanagari'
	| 'Ethiopic'
	| 'Greek'
	| 'Gujarati'
	| 'Gurmukhi'
	| 'Han'
	| 'Hangul'
	| 'Hebrew'
	| 'Japanese'
	| 'Kannada'
	| 'Khmer'
	| 'Latin'
	| 'Malayalam'
	| 'Myanmar'
	| 'NKo'
	| 'Oriya'
	| 'Sinhala'
	| 'Tamil'
	| 'Telugu'
	| 'Thai'
	| 'Tifinagh';

export type CueForgeLanguageMetadata = {
	languageTag: string;
	script: CueForgeLanguageScript;
};

export const cueForgeLanguages = [
	{ ids: ['eng', 'en'], name: 'English' },
	{ ids: ['chi', 'zho', 'zh', 'zh-hans', 'zh-cn', 'zh-sg', 'cmn'], name: 'SIMPLIFIED Chinese' },
	{ ids: ['zht', 'zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'], name: 'TRADITIONAL Chinese' },
	{ ids: ['spa', 'es'], name: 'Spanish' },
	{ ids: ['hin', 'hi'], name: 'Hindi' },
	{ ids: ['arb'], name: 'Modern Standard Arabic' },
	{ ids: ['ara', 'ar'], name: 'Arabic' },
	{ ids: ['fre', 'fra', 'fr'], name: 'French' },
	{ ids: ['ben', 'bn'], name: 'Bengali' },
	{ ids: ['por', 'pt'], name: 'Portuguese' },
	{ ids: ['ind', 'id'], name: 'Indonesian' },
	{ ids: ['urd', 'ur'], name: 'Urdu' },
	{ ids: ['rus', 'ru'], name: 'Russian' },
	{ ids: ['ger', 'deu', 'de'], name: 'German' },
	{ ids: ['jpn', 'ja'], name: 'Japanese' },
	{ ids: ['pcm'], name: 'Nigerian Pidgin' },
	{ ids: ['arz'], name: 'Egyptian Arabic' },
	{ ids: ['mar', 'mr'], name: 'Marathi' },
	{ ids: ['vie', 'vi'], name: 'Vietnamese' },
	{ ids: ['tel', 'te'], name: 'Telugu' },
	{ ids: ['swa', 'swh', 'sw'], name: 'Swahili' },
	{ ids: ['hau', 'ha'], name: 'Hausa' },
	{ ids: ['tur', 'tr'], name: 'Turkish' },
	{ ids: ['pnb'], name: 'Western Punjabi' },
	{ ids: ['pan', 'pa'], name: 'Punjabi' },
	{ ids: ['tgl', 'tl'], name: 'Tagalog' },
	{ ids: ['fil'], name: 'Filipino' },
	{ ids: ['tam', 'ta'], name: 'Tamil' },
	{ ids: ['yue'], name: 'Yue Chinese' },
	{ ids: ['wuu'], name: 'Wu Chinese' },
	{ ids: ['pes', 'fas', 'per', 'fa'], name: 'Persian' },
	{ ids: ['kor', 'ko'], name: 'Korean' },
	{ ids: ['may', 'msa', 'ms'], name: 'Malay' },
	{ ids: ['amh', 'am'], name: 'Amharic' },
	{ ids: ['tha', 'th'], name: 'Thai' },
	{ ids: ['jav', 'jv'], name: 'Javanese' },
	{ ids: ['ita', 'it'], name: 'Italian' },
	{ ids: ['guj', 'gu'], name: 'Gujarati' },
	{ ids: ['kan', 'kn'], name: 'Kannada' },
	{ ids: ['apc'], name: 'Levantine Arabic' },
	{ ids: ['apd'], name: 'Sudanese Arabic' },
	{ ids: ['yor', 'yo'], name: 'Yoruba' },
	{ ids: ['bho'], name: 'Bhojpuri' },
	{ ids: ['mal', 'ml'], name: 'Malayalam' },
	{ ids: ['pol', 'pl'], name: 'Polish' },
	{ ids: ['pus', 'ps'], name: 'Pashto' },
	{ ids: ['nan'], name: 'Min Nan Chinese' },
	{ ids: ['hak'], name: 'Hakka Chinese' },
	{ ids: ['cjy'], name: 'Jinyu Chinese' },
	{ ids: ['rom'], name: 'Romani' },
	{ ids: ['arq'], name: 'Algerian Arabic' },
	{ ids: ['hsn'], name: 'Xiang Chinese' },
	{ ids: ['raj'], name: 'Rajasthani' },
	{ ids: ['ory', 'or'], name: 'Odia' },
	{ ids: ['mai'], name: 'Maithili' },
	{ ids: ['mya', 'bur', 'my'], name: 'Burmese' },
	{ ids: ['sun', 'su'], name: 'Sundanese' },
	{ ids: ['ary'], name: 'Moroccan Arabic' },
	{ ids: ['uzb', 'uz'], name: 'Uzbek' },
	{ ids: ['ibo', 'ig'], name: 'Igbo' },
	{ ids: ['nqo'], name: "N'Ko" },
	{ ids: ['ukr', 'uk'], name: 'Ukrainian' },
	{ ids: ['uzn'], name: 'Northern Uzbek' },
	{ ids: ['snd', 'sd'], name: 'Sindhi' },
	{ ids: ['rum', 'ron', 'ro'], name: 'Romanian' },
	{ ids: ['ful', 'ff'], name: 'Fula' },
	{ ids: ['orm', 'om'], name: 'Oromo' },
	{ ids: ['dut', 'nld', 'nl'], name: 'Dutch' },
	{ ids: ['aze', 'az'], name: 'Azerbaijani' },
	{ ids: ['aec'], name: 'Saidi Arabic' },
	{ ids: ['gan'], name: 'Gan Chinese' },
	{ ids: ['awa'], name: 'Awadhi' },
	{ ids: ['kur', 'ku'], name: 'Kurdish' },
	{ ids: ['pbu'], name: 'Northern Pashto' },
	{ ids: ['mag'], name: 'Magahi' },
	{ ids: ['skr'], name: 'Saraiki' },
	{ ids: ['lin', 'ln'], name: 'Lingala' },
	{ ids: ['hbs', 'sh'], name: 'Serbo-Croatian' },
	{ ids: ['mlg', 'mg'], name: 'Malagasy' },
	{ ids: ['tzm'], name: 'Central Atlas Tamazight' },
	{ ids: ['khm', 'km'], name: 'Khmer' },
	{ ids: ['hne'], name: 'Chhattisgarhi' },
	{ ids: ['som', 'so'], name: 'Somali' },
	{ ids: ['tuk', 'tk'], name: 'Turkmen' },
	{ ids: ['zha', 'za'], name: 'Zhuang' },
	{ ids: ['ceb'], name: 'Cebuano' },
	{ ids: ['nep', 'ne'], name: 'Nepali' },
	{ ids: ['acm'], name: 'Mesopotamian Arabic' },
	{ ids: ['sin', 'si'], name: 'Sinhala' },
	{ ids: ['asm', 'as'], name: 'Assamese' },
	{ ids: ['tts'], name: 'Isan' },
	{ ids: ['kau', 'kr'], name: 'Kanuri' },
	{ ids: ['mad'], name: 'Madurese' },
	{ ids: ['gre', 'ell', 'el'], name: 'Greek' },
	{ ids: ['kmr'], name: 'Kurmanji' },
	{ ids: ['fuv'], name: 'Nigerian Fulfulde' },
	{ ids: ['acw'], name: 'Hijazi Arabic' },
	{ ids: ['bar'], name: 'Bavarian' },
	{ ids: ['tgk', 'tg'], name: 'Tajik' },
	{ ids: ['bgc'], name: 'Haryanvi' },
	{ ids: ['mwr'], name: 'Marwari' },
	{ ids: ['syl'], name: 'Sylheti' },
	{ ids: ['azb'], name: 'South Azerbaijani' },
	{ ids: ['ctg'], name: 'Chittagonian' },
	{ ids: ['tso', 'ts'], name: 'Tsonga' },
	{ ids: ['kaz', 'kk'], name: 'Kazakh' },
	{ ids: ['hun', 'hu'], name: 'Hungarian' },
	{ ids: ['zul', 'zu'], name: 'Zulu' },
	{ ids: ['kin', 'rw'], name: 'Kinyarwanda' },
	{ ids: ['nya', 'ny'], name: 'Chichewa' },
	{ ids: ['cze', 'ces', 'cs'], name: 'Czech' },
	{ ids: ['dan', 'da'], name: 'Danish' },
	{ ids: ['fin', 'fi'], name: 'Finnish' },
	{ ids: ['heb', 'he'], name: 'Hebrew' },
	{ ids: ['nor', 'no'], name: 'Norwegian' },
	{ ids: ['swe', 'sv'], name: 'Swedish' }
] as const satisfies readonly CueForgeLanguage[];

export const cueForgeLanguageMetadataByName = {
	English: { languageTag: 'en-US', script: 'Latin' },
	'SIMPLIFIED Chinese': { languageTag: 'zh-CN', script: 'Han' },
	'TRADITIONAL Chinese': { languageTag: 'zh-TW', script: 'Han' },
	Spanish: { languageTag: 'es-ES', script: 'Latin' },
	Hindi: { languageTag: 'hi-IN', script: 'Devanagari' },
	'Modern Standard Arabic': { languageTag: 'arb', script: 'Arabic' },
	Arabic: { languageTag: 'ar-SA', script: 'Arabic' },
	French: { languageTag: 'fr-FR', script: 'Latin' },
	Bengali: { languageTag: 'bn-BD', script: 'Bengali' },
	Portuguese: { languageTag: 'pt-PT', script: 'Latin' },
	Indonesian: { languageTag: 'id-ID', script: 'Latin' },
	Urdu: { languageTag: 'ur-PK', script: 'Arabic' },
	Russian: { languageTag: 'ru-RU', script: 'Cyrillic' },
	German: { languageTag: 'de-DE', script: 'Latin' },
	Japanese: { languageTag: 'ja-JP', script: 'Japanese' },
	'Nigerian Pidgin': { languageTag: 'pcm', script: 'Latin' },
	'Egyptian Arabic': { languageTag: 'arz', script: 'Arabic' },
	Marathi: { languageTag: 'mr-IN', script: 'Devanagari' },
	Vietnamese: { languageTag: 'vi-VN', script: 'Latin' },
	Telugu: { languageTag: 'te-IN', script: 'Telugu' },
	Swahili: { languageTag: 'sw', script: 'Latin' },
	Hausa: { languageTag: 'ha', script: 'Latin' },
	Turkish: { languageTag: 'tr-TR', script: 'Latin' },
	'Western Punjabi': { languageTag: 'pnb', script: 'Arabic' },
	Punjabi: { languageTag: 'pa-IN', script: 'Gurmukhi' },
	Tagalog: { languageTag: 'tl', script: 'Latin' },
	Filipino: { languageTag: 'fil-PH', script: 'Latin' },
	Tamil: { languageTag: 'ta-IN', script: 'Tamil' },
	'Yue Chinese': { languageTag: 'yue', script: 'Han' },
	'Wu Chinese': { languageTag: 'wuu', script: 'Han' },
	Persian: { languageTag: 'fa-IR', script: 'Arabic' },
	Korean: { languageTag: 'ko-KR', script: 'Hangul' },
	Malay: { languageTag: 'ms-MY', script: 'Latin' },
	Amharic: { languageTag: 'am-ET', script: 'Ethiopic' },
	Thai: { languageTag: 'th-TH', script: 'Thai' },
	Javanese: { languageTag: 'jv', script: 'Latin' },
	Italian: { languageTag: 'it-IT', script: 'Latin' },
	Gujarati: { languageTag: 'gu-IN', script: 'Gujarati' },
	Kannada: { languageTag: 'kn-IN', script: 'Kannada' },
	'Levantine Arabic': { languageTag: 'apc', script: 'Arabic' },
	'Sudanese Arabic': { languageTag: 'apd', script: 'Arabic' },
	Yoruba: { languageTag: 'yo', script: 'Latin' },
	Bhojpuri: { languageTag: 'bho', script: 'Devanagari' },
	Malayalam: { languageTag: 'ml-IN', script: 'Malayalam' },
	Polish: { languageTag: 'pl-PL', script: 'Latin' },
	Pashto: { languageTag: 'ps-AF', script: 'Arabic' },
	'Min Nan Chinese': { languageTag: 'nan', script: 'Han' },
	'Hakka Chinese': { languageTag: 'hak', script: 'Han' },
	'Jinyu Chinese': { languageTag: 'cjy', script: 'Han' },
	Romani: { languageTag: 'rom', script: 'Latin' },
	'Algerian Arabic': { languageTag: 'arq', script: 'Arabic' },
	'Xiang Chinese': { languageTag: 'hsn', script: 'Han' },
	Rajasthani: { languageTag: 'raj', script: 'Devanagari' },
	Odia: { languageTag: 'or-IN', script: 'Oriya' },
	Maithili: { languageTag: 'mai', script: 'Devanagari' },
	Burmese: { languageTag: 'my-MM', script: 'Myanmar' },
	Sundanese: { languageTag: 'su', script: 'Latin' },
	'Moroccan Arabic': { languageTag: 'ary', script: 'Arabic' },
	Uzbek: { languageTag: 'uz', script: 'Latin' },
	Igbo: { languageTag: 'ig', script: 'Latin' },
	"N'Ko": { languageTag: 'nqo', script: 'NKo' },
	Ukrainian: { languageTag: 'uk-UA', script: 'Cyrillic' },
	'Northern Uzbek': { languageTag: 'uzn', script: 'Latin' },
	Sindhi: { languageTag: 'sd-PK', script: 'Arabic' },
	Romanian: { languageTag: 'ro-RO', script: 'Latin' },
	Fula: { languageTag: 'ff', script: 'Latin' },
	Oromo: { languageTag: 'om', script: 'Latin' },
	Dutch: { languageTag: 'nl-NL', script: 'Latin' },
	Azerbaijani: { languageTag: 'az-AZ', script: 'Latin' },
	'Saidi Arabic': { languageTag: 'aec', script: 'Arabic' },
	'Gan Chinese': { languageTag: 'gan', script: 'Han' },
	Awadhi: { languageTag: 'awa', script: 'Devanagari' },
	Kurdish: { languageTag: 'ku', script: 'Latin' },
	'Northern Pashto': { languageTag: 'pbu', script: 'Arabic' },
	Magahi: { languageTag: 'mag', script: 'Devanagari' },
	Saraiki: { languageTag: 'skr', script: 'Arabic' },
	Lingala: { languageTag: 'ln', script: 'Latin' },
	'Serbo-Croatian': { languageTag: 'sh', script: 'Latin' },
	Malagasy: { languageTag: 'mg', script: 'Latin' },
	'Central Atlas Tamazight': { languageTag: 'tzm', script: 'Tifinagh' },
	Khmer: { languageTag: 'km-KH', script: 'Khmer' },
	Chhattisgarhi: { languageTag: 'hne', script: 'Devanagari' },
	Somali: { languageTag: 'so', script: 'Latin' },
	Turkmen: { languageTag: 'tk', script: 'Latin' },
	Zhuang: { languageTag: 'za', script: 'Latin' },
	Cebuano: { languageTag: 'ceb', script: 'Latin' },
	Nepali: { languageTag: 'ne-NP', script: 'Devanagari' },
	'Mesopotamian Arabic': { languageTag: 'acm', script: 'Arabic' },
	Sinhala: { languageTag: 'si-LK', script: 'Sinhala' },
	Assamese: { languageTag: 'as', script: 'Bengali' },
	Isan: { languageTag: 'tts', script: 'Thai' },
	Kanuri: { languageTag: 'kr', script: 'Latin' },
	Madurese: { languageTag: 'mad', script: 'Latin' },
	Greek: { languageTag: 'el-GR', script: 'Greek' },
	Kurmanji: { languageTag: 'kmr', script: 'Latin' },
	'Nigerian Fulfulde': { languageTag: 'fuv', script: 'Latin' },
	'Hijazi Arabic': { languageTag: 'acw', script: 'Arabic' },
	Bavarian: { languageTag: 'bar', script: 'Latin' },
	Tajik: { languageTag: 'tg-TJ', script: 'Cyrillic' },
	Haryanvi: { languageTag: 'bgc', script: 'Devanagari' },
	Marwari: { languageTag: 'mwr', script: 'Devanagari' },
	Sylheti: { languageTag: 'syl', script: 'Bengali' },
	'South Azerbaijani': { languageTag: 'azb', script: 'Arabic' },
	Chittagonian: { languageTag: 'ctg', script: 'Bengali' },
	Tsonga: { languageTag: 'ts', script: 'Latin' },
	Kazakh: { languageTag: 'kk-KZ', script: 'Cyrillic' },
	Hungarian: { languageTag: 'hu-HU', script: 'Latin' },
	Zulu: { languageTag: 'zu', script: 'Latin' },
	Kinyarwanda: { languageTag: 'rw', script: 'Latin' },
	Chichewa: { languageTag: 'ny', script: 'Latin' },
	Czech: { languageTag: 'cs-CZ', script: 'Latin' },
	Danish: { languageTag: 'da-DK', script: 'Latin' },
	Finnish: { languageTag: 'fi-FI', script: 'Latin' },
	Hebrew: { languageTag: 'he-IL', script: 'Hebrew' },
	Norwegian: { languageTag: 'no-NO', script: 'Latin' },
	Swedish: { languageTag: 'sv-SE', script: 'Latin' }
} as const satisfies Record<(typeof cueForgeLanguages)[number]['name'], CueForgeLanguageMetadata>;

export function normalizeLanguageId(id: string) {
	return id.trim().toLowerCase();
}

export const cueForgeLanguageById = Object.freeze(
	cueForgeLanguages.reduce<Record<string, string>>((acc, language) => {
		for (const id of language.ids) {
			acc[normalizeLanguageId(id)] = language.name;
		}
		return acc;
	}, {})
);

export const cueForgeLanguageNameById = cueForgeLanguageById;

export const cueForgeLanguageTagById = Object.freeze(
	cueForgeLanguages.reduce<Record<string, string>>((acc, language) => {
		const metadata = cueForgeLanguageMetadataByName[language.name];
		for (const id of language.ids) {
			acc[normalizeLanguageId(id)] = metadata.languageTag;
		}
		return acc;
	}, {})
);

export const cueForgeLanguageScriptById = Object.freeze(
	cueForgeLanguages.reduce<Record<string, CueForgeLanguageScript>>((acc, language) => {
		const metadata = cueForgeLanguageMetadataByName[language.name];
		for (const id of language.ids) {
			acc[normalizeLanguageId(id)] = metadata.script;
		}
		return acc;
	}, {})
);

export function getCueForgeLanguageName(id: string) {
	return cueForgeLanguageNameById[normalizeLanguageId(id)] || '';
}

export function getCueForgeLanguageTag(id: string) {
	return cueForgeLanguageTagById[normalizeLanguageId(id)] || '';
}

export function getCueForgeLanguageScript(id: string) {
	return cueForgeLanguageScriptById[normalizeLanguageId(id)] || '';
}
