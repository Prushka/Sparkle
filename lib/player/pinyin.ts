// Lazy-loaded Chinese pinyin annotation for subtitle cues.
//
// Uses pinyin-pro with the modern word dictionary so polyphonic characters
// resolve from context (银行 -> yínháng, 旅行 -> lǚxíng), plus the traditional
// dictionary so traditional-Chinese subtitles segment correctly.
//
// VTT cues are annotated with HTML ruby markup, which the DOM captions
// overlay renders as pinyin above each word. ASS dialogue keeps rendering
// through jassub: the format has no ruby, so Chinese lines are stacked as a
// small pinyin line above the original subtitle line.

export type PinyinAnnotators = {
	annotateAss: (text: string) => string;
	annotateHtml: (text: string) => string;
};

type SegmentedChar = { origin: string; result: string };
type JiebaTaggedWord = { word: string; tag: string };
type PositionedJiebaTaggedWord = JiebaTaggedWord & { start: number; end: number };
type JiebaTagger = (text: string) => JiebaTaggedWord[];
type JiebaModule = {
	default?: unknown;
	tag?: (sentence: string, hmm?: boolean | null) => JiebaTaggedWord[];
};

const HAN_CHAR_RE = /\p{Script=Han}/u;
// Kanji and hanja are Han script too; kana or hangul in a line means the text
// is Japanese or Korean, not Chinese, so it must not get pinyin.
const NON_CHINESE_CJK_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const HTML_TAG_SPLIT_RE = /(<[^>]*>)/;
const ASS_BLOCK_SPLIT_RE = /({[^}]*})/;
const ASS_LINE_SPLIT_RE = /(\\[Nn]|\n)/;
const ASS_PINYIN_COLOR = '&HAAEBFF&';
const ASS_PINYIN_SCALE = 60;
const ASS_PINYIN_GAP = '\\h';
const ASS_VISIBLE_TEXT_RE = /[^{}\s]/;
const LATIN_WORD_RE = /[\p{Script=Latin}\p{N}]/u;
const LATIN_WORD_GLOBAL_RE = /[\p{Script=Latin}\p{N}]+/gu;
const MODAL_DEI_PINYIN = 'děi';

let annotatorsPromise: Promise<PinyinAnnotators> | null = null;

export function textLooksChinese(text: string) {
	return HAN_CHAR_RE.test(text) && !NON_CHINESE_CJK_RE.test(text);
}

// A subtitle sample reads as Chinese when its Han-script lines are mostly
// free of kana/hangul. Japanese tracks fail this even though kanji-only
// lines exist, because most of their lines carry kana.
export function subtitleSampleLooksChinese(sample: string) {
	let chineseLines = 0;
	let otherCjkLines = 0;
	for (const line of sample.split('\n')) {
		if (!HAN_CHAR_RE.test(line)) {
			continue;
		}
		if (NON_CHINESE_CJK_RE.test(line)) {
			otherCjkLines++;
		} else {
			chineseLines++;
		}
	}
	return chineseLines > 0 && chineseLines >= otherCjkLines;
}

export function subtitleContentLooksChinese(content: string) {
	// ASS style headers can name Chinese fonts; only dialogue text counts.
	const eventsIndex = content.search(/^\[Events\]/im);
	const body = eventsIndex >= 0 ? content.slice(eventsIndex) : content;
	return subtitleSampleLooksChinese(body.slice(0, 30000));
}

// Annotates the dialogue text of every Dialogue event in an ASS document,
// leaving the header, styles, and all other lines byte-identical.
export function annotateAssContent(content: string, annotateAssText: (text: string) => string) {
	let inEvents = false;
	let textIndex = 9;
	return content
		.split(/\r?\n/)
		.map((line) => {
			const trimmed = line.trim();
			if (trimmed.startsWith('[')) {
				inEvents = /^\[events\]$/i.test(trimmed);
				return line;
			}
			if (!inEvents) {
				return line;
			}
			if (/^Format:/i.test(trimmed)) {
				const columns = line
					.slice(line.indexOf(':') + 1)
					.split(',')
					.map((column) => column.trim().toLowerCase());
				// The Text column is last per spec; everything after its comma
				// belongs to the dialogue text even when it contains commas.
				textIndex = columns.indexOf('text');
				if (textIndex === -1) {
					textIndex = columns.length - 1;
				}
				return line;
			}
			if (!/^Dialogue:/i.test(trimmed)) {
				return line;
			}
			const prefixEnd = line.indexOf(':') + 1;
			const fields = line.slice(prefixEnd).split(',');
			if (fields.length <= textIndex) {
				return line;
			}
			const head = fields.slice(0, textIndex).join(',');
			const text = fields.slice(textIndex).join(',');
			return `${line.slice(0, prefixEnd)}${head},${annotateAssText(text)}`;
		})
		.join('\n');
}

function isAnnotatedHanChar(char: SegmentedChar) {
	return Boolean(char.result) && char.result !== char.origin && HAN_CHAR_RE.test(char.origin);
}

async function createJiebaTagger(jiebaModule: JiebaModule): Promise<JiebaTagger | null> {
	try {
		if (typeof jiebaModule.default === 'function') {
			await jiebaModule.default();
		}
		if (typeof jiebaModule.tag !== 'function') {
			return null;
		}
		return (text) => jiebaModule.tag?.(text, true) ?? [];
	} catch (error) {
		console.warn('Unable to initialize Chinese tokenizer for pinyin disambiguation', error);
		return null;
	}
}

function getTaggedWordRanges(text: string, tagger: JiebaTagger): PositionedJiebaTaggedWord[] {
	let cursor = 0;
	return tagger(text)
		.map((taggedWord) => {
			const start = text.indexOf(taggedWord.word, cursor);
			if (start === -1) {
				return null;
			}
			const end = start + taggedWord.word.length;
			cursor = end;
			return { ...taggedWord, start, end };
		})
		.filter((taggedWord): taggedWord is PositionedJiebaTaggedWord => taggedWord !== null);
}

function isPredicateTag(tag: string) {
	return tag.startsWith('v') || tag === 'a' || tag === 'ad' || tag === 'an';
}

function canStartModalDeiPredicate(taggedWords: PositionedJiebaTaggedWord[], index: number) {
	const word = taggedWords[index];
	if (!word) {
		return false;
	}
	if (isPredicateTag(word.tag) || word.tag === 'd' || word.tag === 'p') {
		return true;
	}
	// 得这样做 / 得这个人去: short pronominal bridges are still modal when a
	// predicate follows immediately after.
	if (word.tag === 'r') {
		return taggedWords.slice(index + 1, index + 3).some((nextWord) => isPredicateTag(nextWord.tag));
	}
	return false;
}

function isModalDeiTaggedWord(taggedWords: PositionedJiebaTaggedWord[], index: number) {
	const word = taggedWords[index];
	if (!word || word.word !== '得') {
		return false;
	}

	const previousWord = taggedWords[index - 1];
	if (previousWord && isPredicateTag(previousWord.tag)) {
		return false;
	}

	return canStartModalDeiPredicate(taggedWords, index + 1);
}

function getModalDeiOffsets(text: string, tagger: JiebaTagger | null) {
	if (!tagger) {
		return new Set<string>();
	}

	const taggedWords = getTaggedWordRanges(text, tagger);
	return new Set(
		taggedWords
			.flatMap((taggedWord, index) =>
				isModalDeiTaggedWord(taggedWords, index) ? [taggedWord] : []
			)
			.map((taggedWord) => `${taggedWord.start}:${taggedWord.end}`)
	);
}

function applyContextualPinyinDisambiguation(
	text: string,
	segments: SegmentedChar[][],
	tagger: JiebaTagger | null
) {
	const modalDeiOffsets = getModalDeiOffsets(text, tagger);
	if (modalDeiOffsets.size === 0) {
		return segments;
	}

	let offset = 0;
	return segments.map((word) =>
		word.map((char) => {
			const start = offset;
			const end = start + char.origin.length;
			offset = end;
			return char.origin === '得' && modalDeiOffsets.has(`${start}:${end}`)
				? { ...char, result: MODAL_DEI_PINYIN }
				: char;
		})
	);
}

function buildAnnotators(segmentWords: (text: string) => SegmentedChar[][]): PinyinAnnotators {
	const annotateChunk = (
		chunk: string,
		renderWord: (origin: string, chars: SegmentedChar[]) => string
	) => {
		if (!textLooksChinese(chunk)) {
			return chunk;
		}
		let annotated = '';
		for (const word of segmentWords(chunk)) {
			const origin = word.map((char) => char.origin).join('');
			// Words with characters the dictionary cannot read stay unannotated
			// rather than rendering misaligned or empty annotations.
			annotated += word.every(isAnnotatedHanChar) ? renderWord(origin, word) : origin;
		}
		return annotated;
	};

	const renderRubyWord = (_origin: string, chars: SegmentedChar[]) =>
		`<ruby>${chars.map((char) => `${char.origin}<rt>${char.result}</rt>`).join('')}</ruby>`;

	const annotateHtmlLine = (line: string) =>
		line
			.split(HTML_TAG_SPLIT_RE)
			.map((part) =>
				part.startsWith('<') && part.endsWith('>') ? part : annotateChunk(part, renderRubyWord)
			)
			.join('');

	// Lines are annotated independently so a Japanese line in a merged cue
	// does not suppress pinyin on the Chinese lines around it.
	const annotateHtml = (text: string) => text.split('\n').map(annotateHtmlLine).join('\n');

	const annotateAss = (text: string) => {
		const renderAssPinyinWord = (_origin: string, chars: SegmentedChar[]) =>
			chars.map((char) => char.result).join(ASS_PINYIN_GAP);

		const getPinyinChunk = (chunk: string) => {
			if (!textLooksChinese(chunk)) {
				return { hasPinyin: false, text: chunk.replace(LATIN_WORD_GLOBAL_RE, '') };
			}

			let hasPinyin = false;
			let annotated = '';
			for (const word of segmentWords(chunk)) {
				const origin = word.map((char) => char.origin).join('');
				if (word.every(isAnnotatedHanChar)) {
					const pinyin = renderAssPinyinWord(origin, word);
					annotated += annotated && pinyin ? `${ASS_PINYIN_GAP}${pinyin}` : pinyin;
					hasPinyin = true;
				} else {
					annotated += LATIN_WORD_RE.test(origin) ? '' : origin;
				}
			}
			return { hasPinyin, text: annotated };
		};

		const annotateAssLine = (line: string) => {
			let pinyinText = '';
			let leadingTags = '';
			let seenVisibleText = false;
			let hasPinyin = false;

			for (const part of line.split(ASS_BLOCK_SPLIT_RE)) {
				if (!part) {
					continue;
				}
				if (part.startsWith('{') && part.endsWith('}')) {
					if (!seenVisibleText) {
						leadingTags += part;
					}
					continue;
				}

				if (ASS_VISIBLE_TEXT_RE.test(part)) {
					seenVisibleText = true;
				}
				const chunk = getPinyinChunk(part);
				hasPinyin ||= chunk.hasPinyin;
				pinyinText += chunk.text;
			}

			if (!hasPinyin) {
				return line;
			}

			const compactPinyin = pinyinText.replace(/\s+/g, ASS_PINYIN_GAP).trim();
			if (!compactPinyin) {
				return line;
			}
			return `${leadingTags}{\\fscx${ASS_PINYIN_SCALE}\\fscy${ASS_PINYIN_SCALE}\\c${ASS_PINYIN_COLOR}}${compactPinyin}{\\r}\\N${line}`;
		};

		return text
			.split(ASS_LINE_SPLIT_RE)
			.map((part) => (ASS_LINE_SPLIT_RE.test(part) ? part : annotateAssLine(part)))
			.join('');
	};

	return { annotateAss, annotateHtml };
}

export function loadPinyinAnnotator() {
	annotatorsPromise ??= Promise.all([
		import('pinyin-pro'),
		import('@pinyin-pro/data/modern'),
		import('@pinyin-pro/data/traditional'),
		import('jieba-wasm')
	])
		.then(async ([pinyinModule, modernDict, traditionalDict, jiebaModule]) => {
			pinyinModule.addDict(modernDict.default);
			pinyinModule.addTraditionalDict(traditionalDict.default);
			const tagger = await createJiebaTagger(jiebaModule);
			return buildAnnotators((text) => {
				const segments = pinyinModule.segment(text, {
					format: pinyinModule.OutputFormat.AllArray,
					traditional: true
				}) as SegmentedChar[][];
				return applyContextualPinyinDisambiguation(text, segments, tagger);
			});
		})
		.catch((error) => {
			annotatorsPromise = null;
			throw error;
		});
	return annotatorsPromise;
}
