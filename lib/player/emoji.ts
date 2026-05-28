export type ChatEmojiCategory = 'pepe' | 'reactions' | 'anime' | 'stickers';
export type ChatEmojiSource = '7TV' | 'BetterTTV' | 'FrankerFaceZ' | 'Tenor';
export type ChatEmojiKind = 'emoji' | 'sticker';

export type ChatEmojiRef = {
	id: string;
	label: string;
	src: string;
	source: ChatEmojiSource;
	animated: boolean;
	kind: ChatEmojiKind;
	previewSrc?: string;
	itemUrl?: string;
};

export type ChatEmoji = ChatEmojiRef & {
	category: ChatEmojiCategory;
	tags: string[];
};

export const emojiCategories: { id: ChatEmojiCategory; label: string }[] = [
	{ id: 'pepe', label: 'Pepe' },
	{ id: 'reactions', label: 'Reactions' },
	{ id: 'anime', label: 'Anime' },
	{ id: 'stickers', label: 'Stickers' }
];

export const chatEmojis: ChatEmoji[] = [
	{
		id: 'pepe_smile',
		label: 'Pepe Smile',
		category: 'pepe',
		src: 'https://cdn.7tv.app/emote/01JDZG9MDEC42MENKVYB24A2DK/2x.webp',
		source: '7TV',
		animated: false,
		kind: 'emoji',
		tags: ['pepe', 'smile', 'happy']
	},
	{
		id: 'pepe_laugh',
		label: 'Pepe Laugh',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5c548025009a2e73916b3a37/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'emoji',
		tags: ['pepe', 'laugh', 'lol']
	},
	{
		id: 'pepe_hands',
		label: 'Pepe Hands',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/59f27b3f4ebd8047f54dee29/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['pepe', 'sad', 'cry']
	},
	{
		id: 'pepe_jam',
		label: 'Pepe Jam',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5b77ac3af7bddc567b1d5fb2/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'dance', 'music', 'jam']
	},
	{
		id: 'pepega',
		label: 'Pepega',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5aca62163e290877a25481ad/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['pepe', 'meme']
	},
	{
		id: 'pepe_pls',
		label: 'Pepe Pls',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/55898e122612142e6aaa935b/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'dance', 'party']
	},
	{
		id: 'monkas',
		label: 'MonkaS',
		category: 'pepe',
		src: 'https://cdn.frankerfacez.com/emote/130762/2',
		source: 'FrankerFaceZ',
		animated: false,
		kind: 'emoji',
		tags: ['monka', 'nervous', 'sweat']
	},
	{
		id: 'monka_w',
		label: 'MonkaW',
		category: 'pepe',
		src: 'https://cdn.frankerfacez.com/emote/214681/2',
		source: 'FrankerFaceZ',
		animated: false,
		kind: 'emoji',
		tags: ['monka', 'scared', 'wide']
	},
	{
		id: 'peepo_happy',
		label: 'Peepo Happy',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5a16ee718c22a247ead62d4a/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'happy', 'smile']
	},
	{
		id: 'peepo_sad',
		label: 'Peepo Sad',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5a16ddca8c22a247ead62ceb/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'sad']
	},
	{
		id: 'widepeepo_happy',
		label: 'Wide Peepo Happy',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5e1a76dd8af14b5f1b438c04/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'happy', 'wide']
	},
	{
		id: 'kekw',
		label: 'KEKW',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['laugh', 'lol', 'meme']
	},
	{
		id: 'omegalul',
		label: 'OMEGALUL',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/583089f4737a8e61abb0186b/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['laugh', 'lol']
	},
	{
		id: 'sadge',
		label: 'Sadge',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5e0fa9d40550d42106b8a489/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['sad', 'pepe']
	},
	{
		id: 'prayge',
		label: 'Prayge',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5f3ef6123212445d6fb49f1a/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['pray', 'hope']
	},
	{
		id: 'catjam',
		label: 'Cat Jam',
		category: 'reactions',
		src: 'https://cdn.betterttv.net/emote/5f1b0186cf6d2144653d2970/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['cat', 'dance', 'music', 'jam']
	},
	{
		id: 'ayaya',
		label: 'AYAYA',
		category: 'anime',
		src: 'https://cdn.7tv.app/emote/01KQXPJTS2RM5TX8K1VWFKETEX/2x.webp',
		source: '7TV',
		animated: true,
		kind: 'emoji',
		tags: ['anime', 'happy']
	},
	{
		id: 'anime_think',
		label: 'Anime Think',
		category: 'anime',
		src: 'https://cdn.frankerfacez.com/emote/318480/2',
		source: 'FrankerFaceZ',
		animated: false,
		kind: 'emoji',
		tags: ['anime', 'think']
	},
	{
		id: 'anime_smile',
		label: 'Anime Smile',
		category: 'anime',
		src: 'https://cdn.7tv.app/emote/01GCFEWZMG000EXFG0ZT5HJRYK/2x.webp',
		source: '7TV',
		animated: false,
		kind: 'emoji',
		tags: ['anime', 'smile', 'happy']
	},
	{
		id: 'anime_rave',
		label: 'Anime Rave',
		category: 'anime',
		src: 'https://cdn.7tv.app/emote/01HD49H64G000506K0FGX9C807/2x.webp',
		source: '7TV',
		animated: true,
		kind: 'sticker',
		tags: ['anime', 'dance', 'rave']
	},
	{
		id: 'anime_thump',
		label: 'Anime Thump',
		category: 'anime',
		src: 'https://cdn.frankerfacez.com/emote/41191/2',
		source: 'FrankerFaceZ',
		animated: false,
		kind: 'emoji',
		tags: ['anime', 'cry', 'sad']
	},
	{
		id: 'chika_yo',
		label: 'Chika Yo',
		category: 'anime',
		src: 'https://cdn.betterttv.net/emote/5c69f5caadab351034b3fcc1/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'emoji',
		tags: ['anime', 'chika']
	},
	{
		id: 'chika_pls',
		label: 'Chika Pls',
		category: 'anime',
		src: 'https://cdn.betterttv.net/emote/5c5af65502062a20389a218f/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['anime', 'chika', 'dance']
	},
	{
		id: 'chika_angery',
		label: 'Chika Angery',
		category: 'anime',
		src: 'https://cdn.frankerfacez.com/emote/335910/2',
		source: 'FrankerFaceZ',
		animated: false,
		kind: 'emoji',
		tags: ['anime', 'chika', 'angry']
	},
	{
		id: 'banana_cat',
		label: 'Banana Cat',
		category: 'stickers',
		src: 'https://cdn.betterttv.net/emote/603fb515306b602acc596446/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['cat', 'banana', 'run']
	},
	{
		id: 'pepe_meltdown',
		label: 'Pepe Meltdown',
		category: 'stickers',
		src: 'https://cdn.betterttv.net/emote/5ba84271c9f0f66a9efc1c86/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'panic']
	},
	{
		id: 'pepe_dance',
		label: 'Pepe Dance',
		category: 'stickers',
		src: 'https://cdn.betterttv.net/emote/5b1740221c5a6065a7bad4b5/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'dance']
	},
	{
		id: 'sadge_cry',
		label: 'Sadge Cry',
		category: 'stickers',
		src: 'https://cdn.betterttv.net/emote/5efd9d2572ac200523c5e455/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['sadge', 'cry', 'sad']
	},
	{
		id: 'prayge_dance',
		label: 'Prayge Dance',
		category: 'stickers',
		src: 'https://cdn.betterttv.net/emote/61145aca76ea4e2b9f76b228/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['prayge', 'dance', 'pray']
	}
];

export const chatEmojiById = new Map(chatEmojis.map((emoji) => [emoji.id, emoji]));

const emojiTokenRegex = /:([a-z0-9][a-z0-9_+-]{1,39}):/gi;

export function getChatEmoji(id: string): ChatEmoji | undefined {
	return chatEmojiById.get(id.toLowerCase());
}

export function getChatEmojiAsset(
	id: string,
	emojiRefs: ChatEmojiRef[] = []
): ChatEmojiRef | undefined {
	const normalized = id.toLowerCase();
	return (
		emojiRefs.find((emoji) => emoji.id.toLowerCase() === normalized) ?? getChatEmoji(normalized)
	);
}

export function getEmojiIdsFromText(text: string): string[] {
	const ids = new Set<string>();
	for (const match of text.matchAll(emojiTokenRegex)) {
		const emoji = getChatEmoji(match[1]);
		if (emoji) {
			ids.add(emoji.id);
		}
	}
	return [...ids];
}

export function getEmojiRefsFromText(text: string, emojiRefs: ChatEmojiRef[]): ChatEmojiRef[] {
	const ids = new Set<string>();
	for (const match of text.matchAll(emojiTokenRegex)) {
		ids.add(match[1].toLowerCase());
	}

	const seen = new Set<string>();
	const refs: ChatEmojiRef[] = [];
	for (const emoji of emojiRefs) {
		const id = emoji.id.toLowerCase();
		if (!ids.has(id) || seen.has(id)) {
			continue;
		}
		seen.add(id);
		refs.push({
			id,
			label: emoji.label,
			src: emoji.src,
			source: emoji.source,
			animated: emoji.animated,
			kind: emoji.kind,
			previewSrc: emoji.previewSrc,
			itemUrl: emoji.itemUrl
		});
	}
	return refs;
}

export function findActiveEmojiToken(text: string, cursorIndex: number) {
	if (cursorIndex < 0) {
		return null;
	}
	const prefix = text.slice(0, cursorIndex);
	const match = /(^|\s):([a-z0-9_+-]{0,40})$/i.exec(prefix);
	if (!match) {
		return null;
	}
	return {
		query: match[2].toLowerCase(),
		from: cursorIndex - match[2].length - 1,
		to: cursorIndex
	};
}

export function searchChatEmojis(query: string, limit = 8): ChatEmoji[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return chatEmojis.slice(0, limit);
	}
	const scored = chatEmojis
		.map((emoji) => {
			const idScore = emoji.id.startsWith(normalized) ? 0 : emoji.id.includes(normalized) ? 2 : 9;
			const label = emoji.label.toLowerCase();
			const labelScore = label.startsWith(normalized) ? 1 : label.includes(normalized) ? 3 : 9;
			const tagScore = emoji.tags.some((tag) => tag.startsWith(normalized))
				? 4
				: emoji.tags.some((tag) => tag.includes(normalized))
					? 5
					: 9;
			const score = Math.min(idScore, labelScore, tagScore);
			return { emoji, score };
		})
		.filter(({ score }) => score < 9)
		.sort((a, b) => a.score - b.score || a.emoji.id.localeCompare(b.emoji.id));
	return scored.slice(0, limit).map(({ emoji }) => emoji);
}
