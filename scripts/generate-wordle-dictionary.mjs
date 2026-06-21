import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dictionaryEn from 'dictionary-en';
import wordListPath from 'word-list';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsOutputPath = path.join(repoRoot, 'lib/player/wordleWords.ts');
const goOutputPath = path.join(repoRoot, 'backend/internal/realtime/wordle_words_generated.go');
const require = createRequire(import.meta.url);
const letterpressWords = require('an-array-of-english-words');
const scowlWordLists = require('wordlist-english');
const fiveLetterWord = /^[a-z]{5}$/;

function normalizeWord(word) {
	return String(word).trim().toLowerCase();
}

function collectFiveLetterWords(wordSource) {
	const sourceWords = new Set();
	for (const word of wordSource) {
		const normalized = normalizeWord(word);
		if (fiveLetterWord.test(normalized)) {
			sourceWords.add(normalized);
		}
	}
	return sourceWords;
}

function parseAffixRules(affixText) {
	const groups = new Map();

	for (const line of affixText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const parts = trimmed.split(/\s+/);
		const [type, flag] = parts;
		if ((type !== 'PFX' && type !== 'SFX') || parts.length < 4) {
			continue;
		}

		if (parts.length === 4) {
			groups.set(`${type}:${flag}`, { crossProduct: parts[2] === 'Y', rules: [], type });
			continue;
		}

		const group = groups.get(`${type}:${flag}`);
		if (!group) {
			continue;
		}

		const condition = parts[4];
		group.rules.push({
			add: parts[3] === '0' ? '' : parts[3],
			condition: new RegExp(type === 'SFX' ? `${condition}$` : `^${condition}`),
			strip: parts[2] === '0' ? '' : parts[2],
			type
		});
	}

	return groups;
}

function applyAffixRule(word, rule) {
	if (!rule.condition.test(word)) {
		return null;
	}

	if (rule.type === 'SFX') {
		if (rule.strip && !word.endsWith(rule.strip)) {
			return null;
		}
		return `${word.slice(0, word.length - rule.strip.length)}${rule.add}`;
	}

	if (rule.strip && !word.startsWith(rule.strip)) {
		return null;
	}
	return `${rule.add}${word.slice(rule.strip.length)}`;
}

function expandDictionaryEnWords(dictionary) {
	const decoder = new TextDecoder();
	const affixGroups = parseAffixRules(decoder.decode(dictionary.aff));
	const expandedWords = new Set();

	for (const line of decoder.decode(dictionary.dic).split(/\r?\n/).slice(1)) {
		const entry = line.trim().split(/\s+/, 1)[0];
		if (!entry) {
			continue;
		}

		const [rawWord, rawFlags = ''] = entry.split('/');
		const word = normalizeWord(rawWord);
		if (!/^[a-z]+$/.test(word)) {
			continue;
		}

		expandedWords.add(word);
		const flags = [...rawFlags];
		const prefixGroups = flags.map((flag) => affixGroups.get(`PFX:${flag}`)).filter(Boolean);
		const suffixGroups = flags.map((flag) => affixGroups.get(`SFX:${flag}`)).filter(Boolean);

		for (const group of [...prefixGroups, ...suffixGroups]) {
			for (const rule of group.rules) {
				const affixed = applyAffixRule(word, rule);
				if (affixed) {
					expandedWords.add(affixed);
				}
			}
		}

		for (const prefixGroup of prefixGroups.filter((group) => group.crossProduct)) {
			for (const suffixGroup of suffixGroups.filter((group) => group.crossProduct)) {
				for (const suffixRule of suffixGroup.rules) {
					const suffixed = applyAffixRule(word, suffixRule);
					if (!suffixed) {
						continue;
					}
					for (const prefixRule of prefixGroup.rules) {
						const combined = applyAffixRule(suffixed, prefixRule);
						if (combined) {
							expandedWords.add(combined);
						}
					}
				}
			}
		}
	}

	return expandedWords;
}

const sources = [
	['word-list', fs.readFileSync(wordListPath, 'utf8').split(/\r?\n/)],
	['an-array-of-english-words', letterpressWords],
	['wordlist-english', Object.values(scowlWordLists).flat()],
	['dictionary-en', expandDictionaryEnWords(dictionaryEn)]
];

const sourceCounts = [];
const wordSet = new Set();
for (const [sourceName, sourceWords] of sources) {
	const sourceWordSet = collectFiveLetterWords(sourceWords);
	sourceCounts.push(`${sourceName}: ${sourceWordSet.size}`);
	for (const word of sourceWordSet) {
		wordSet.add(word);
	}
}

const requiredWords = ['boobs', 'emoji'];
for (const word of requiredWords) {
	if (!wordSet.has(word)) {
		throw new Error(`wordle dictionary missing required word: ${word}`);
	}
}

const words = [...wordSet].sort();

if (words.length < 12500) {
	throw new Error(`wordle dictionary yielded only ${words.length} five-letter words`);
}

const generatedHeader = [
	'Generated from word-list, an-array-of-english-words, wordlist-english, and dictionary-en npm packages.',
	'Run npm run generate:wordle-dictionary after updating those packages.'
].join(' ');

const tsWords = words.map((word) => `\t'${word.toUpperCase()}'`).join(',\n');
fs.writeFileSync(
	tsOutputPath,
	`// ${generatedHeader}\n` +
		`// Source packages: https://github.com/sindresorhus/word-list, https://github.com/words/an-array-of-english-words, https://github.com/jacksonrayhamilton/wordlist-english, https://github.com/wooorm/dictionaries\n\n` +
		`export const WORDLE_WORDS: readonly string[] = [\n${tsWords}\n];\n\n` +
		`export const WORDLE_WORD_SET: ReadonlySet<string> = new Set(WORDLE_WORDS);\n\n` +
		`export function isValidWordleWord(word: string) {\n` +
		`\treturn WORDLE_WORD_SET.has(word.trim().toUpperCase());\n` +
		`}\n`
);

const goWords = words.map((word) => `\t"${word.toUpperCase()}",`).join('\n');
fs.writeFileSync(
	goOutputPath,
	`// Code generated by scripts/generate-wordle-dictionary.mjs; DO NOT EDIT.\n` +
		`// ${generatedHeader}\n` +
		`// Source packages: https://github.com/sindresorhus/word-list, https://github.com/words/an-array-of-english-words, https://github.com/jacksonrayhamilton/wordlist-english, https://github.com/wooorm/dictionaries\n\n` +
		`package realtime\n\n` +
		`var wordleWords = []string{\n${goWords}\n}\n\n` +
		`var wordleWordSet = func() map[string]struct{} {\n` +
		`\tset := make(map[string]struct{}, len(wordleWords))\n` +
		`\tfor _, word := range wordleWords {\n` +
		`\t\tset[word] = struct{}{}\n` +
		`\t}\n` +
		`\treturn set\n` +
		`}()\n`
);

console.log(`Generated ${words.length} five-letter Wordle words (${sourceCounts.join(', ')})`);
