export type ChatEmojiCategory = 'pepe' | 'peepo' | 'anime' | 'animals' | 'gaming' | 'memes';
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
	{ id: 'peepo', label: 'Peepo' },
	{ id: 'anime', label: 'Anime' },
	{ id: 'animals', label: 'Animals' },
	{ id: 'gaming', label: 'Gaming' },
	{ id: 'memes', label: 'Memes' }
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
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5a16ee718c22a247ead62d4a/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'happy', 'smile']
	},
	{
		id: 'peepo_sad',
		label: 'Peepo Sad',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5a16ddca8c22a247ead62ceb/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'sad']
	},
	{
		id: 'widepeepo_happy',
		label: 'Wide Peepo Happy',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5e1a76dd8af14b5f1b438c04/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'happy', 'wide']
	},
	{
		id: 'peepo_clap',
		label: 'Peepo Clap',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5d38aaa592fc550c2d5996b8/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'clap', 'applause']
	},
	{
		id: 'peepo_leave',
		label: 'Peepo Leave',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5d324913ff6ed36801311fd2/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'leave', 'run']
	},
	{
		id: 'peepo_shy',
		label: 'Peepo Shy',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5eaa12a074046462f768344b/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'shy', 'cute']
	},
	{
		id: 'peepo_arrive',
		label: 'Peepo Arrive',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5d922afbc0652668c9e52ead/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'arrive', 'hello']
	},
	{
		id: 'peepo_hey',
		label: 'Peepo Hey',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5c0e1a3c6c146e7be4ff5c0c/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'hey', 'wave']
	},
	{
		id: 'peepo_run',
		label: 'Peepo Run',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5bc7ff14664a3b079648dd66/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'run', 'fast']
	},
	{
		id: 'peepo_love',
		label: 'Peepo Love',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5a5e0e8d80f53146a54a516b/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['peepo', 'love', 'heart']
	},
	{
		id: 'pet_the_peepo',
		label: 'Pet The Peepo',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5ec059009af1ea16863b2dec/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'pet', 'cute']
	},
	{
		id: 'peepo_comfy',
		label: 'Peepo Comfy',
		category: 'peepo',
		src: 'https://cdn.betterttv.net/emote/5e0502e69e2cd00d968d5677/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['peepo', 'comfy', 'cozy']
	},
	{
		id: 'kekw',
		label: 'KEKW',
		category: 'memes',
		src: 'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['laugh', 'lol', 'meme']
	},
	{
		id: 'omegalul',
		label: 'OMEGALUL',
		category: 'memes',
		src: 'https://cdn.betterttv.net/emote/583089f4737a8e61abb0186b/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['laugh', 'lol']
	},
	{
		id: 'sadge',
		label: 'Sadge',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5e0fa9d40550d42106b8a489/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['sad', 'pepe']
	},
	{
		id: 'prayge',
		label: 'Prayge',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5f3ef6123212445d6fb49f1a/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['pray', 'hope', 'pepe']
	},
	{
		id: 'catjam',
		label: 'Cat Jam',
		category: 'animals',
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
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/603fb515306b602acc596446/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['cat', 'banana', 'run']
	},
	{
		id: 'pepe_meltdown',
		label: 'Pepe Meltdown',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5ba84271c9f0f66a9efc1c86/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'panic']
	},
	{
		id: 'pepe_dance',
		label: 'Pepe Dance',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5b1740221c5a6065a7bad4b5/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'dance']
	},
	{
		id: 'sadge_cry',
		label: 'Sadge Cry',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5efd9d2572ac200523c5e455/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['sadge', 'cry', 'sad']
	},
	{
		id: 'prayge_dance',
		label: 'Prayge Dance',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/61145aca76ea4e2b9f76b228/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['prayge', 'dance', 'pray']
	},
	{
		id: 'pepe_clap',
		label: 'Pepe Clap',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/59688b35172b8b255ec3f6ac/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'clap', 'applause']
	},
	{
		id: 'pepe_why',
		label: 'Pepe Why',
		category: 'pepe',
		src: 'https://cdn.betterttv.net/emote/5a9def77b7319a74f5bbdeda/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['pepe', 'why', 'question']
	},
	{
		id: 'anime_lick',
		label: 'Anime Lick',
		category: 'anime',
		src: 'https://cdn.betterttv.net/emote/5d6a9a5a4932b21d9c335e31/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['anime', 'lick']
	},
	{
		id: 'anime_cry',
		label: 'Anime Cry',
		category: 'anime',
		src: 'https://cdn.betterttv.net/emote/60b084dff8b3f62601c34767/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['anime', 'cry', 'sad']
	},
	{
		id: 'anime_wow',
		label: 'Anime Wow',
		category: 'anime',
		src: 'https://cdn.betterttv.net/emote/60eff8888ed8b373e4222b5d/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['anime', 'wow', 'surprise']
	},
	{
		id: 'hyper_chika_crazy',
		label: 'Hyper Chika Crazy',
		category: 'anime',
		src: 'https://cdn.betterttv.net/emote/5c7986feee6ff62c3d92905d/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['anime', 'chika', 'dance', 'crazy']
	},
	{
		id: 'pop_cat',
		label: 'Pop Cat',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/5fa8f232eca18f6455c2b2e1/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['cat', 'pop', 'animal']
	},
	{
		id: 'cat_kiss',
		label: 'Cat Kiss',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/5f455410b2efd65d77e8cb14/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['cat', 'kiss', 'animal']
	},
	{
		id: 'confused_cat',
		label: 'Confused Cat',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/5d5d9fe322f52e1d9b41ac91/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['cat', 'confused', 'animal']
	},
	{
		id: 'sad_cat',
		label: 'Sad Cat',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/5b96e7f1bbf4663f648795b1/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['cat', 'sad', 'animal']
	},
	{
		id: 'doge_dance',
		label: 'Doge Dance',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/592ed12be9f5aa0463767b7f/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['doge', 'dog', 'dance', 'animal']
	},
	{
		id: 'dog_jam',
		label: 'Dog Jam',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/5f2e2fcf6f378244660275ae/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['dog', 'jam', 'music', 'animal']
	},
	{
		id: 'doge_pls',
		label: 'Doge Pls',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/55c7eb723d8fd22f20ac9cc1/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['doge', 'dog', 'dance', 'animal']
	},
	{
		id: 'cute_dog',
		label: 'Cute Dog',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/56d6fbb4d5d429963e27410c/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['dog', 'cute', 'animal']
	},
	{
		id: 'duck_pls',
		label: 'Duck Pls',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/607ee5f939b5010444d02dd4/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['duck', 'dance', 'animal']
	},
	{
		id: 'duck_dance',
		label: 'Duck Dance',
		category: 'animals',
		src: 'https://cdn.betterttv.net/emote/609b07c467644f1d67e84603/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['duck', 'dance', 'animal']
	},
	{
		id: 'party_kirby',
		label: 'Party Kirby',
		category: 'gaming',
		src: 'https://cdn.betterttv.net/emote/5c3a9d8bbaa7ba09c9cfca37/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['gaming', 'kirby', 'party']
	},
	{
		id: 'kirby_dance',
		label: 'Kirby Dance',
		category: 'gaming',
		src: 'https://cdn.betterttv.net/emote/5f3323cf4510395d822b557a/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['gaming', 'kirby', 'dance']
	},
	{
		id: 'mario_blj',
		label: 'Mario BLJ',
		category: 'gaming',
		src: 'https://cdn.betterttv.net/emote/5f8153df2bd46e4a86b12955/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['gaming', 'mario']
	},
	{
		id: 'toad_pls',
		label: 'Toad Pls',
		category: 'gaming',
		src: 'https://cdn.betterttv.net/emote/5dcbbf2fab289c5efc1665bc/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['gaming', 'toad', 'dance']
	},
	{
		id: 'pokemon_trainer',
		label: 'Pokemon Trainer',
		category: 'gaming',
		src: 'https://cdn.betterttv.net/emote/5ba76e716ee0c23989d53088/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['gaming', 'pokemon', 'trainer']
	},
	{
		id: 'pokemon_pog',
		label: 'Pokemon Pog',
		category: 'gaming',
		src: 'https://cdn.betterttv.net/emote/6411fdf4746c2603905a3eeb/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['gaming', 'pokemon', 'pog']
	},
	{
		id: 'kekw_laugh',
		label: 'KEKW Laugh',
		category: 'memes',
		src: 'https://cdn.betterttv.net/emote/5d793f2e14011815db9377d2/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['laugh', 'lol', 'meme', 'kekw']
	},
	{
		id: 'poggers',
		label: 'POGGERS',
		category: 'memes',
		src: 'https://cdn.betterttv.net/emote/58ae8407ff7b7276f8e594f2/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['pog', 'hype', 'meme']
	},
	{
		id: 'pog_u',
		label: 'PogU',
		category: 'memes',
		src: 'https://cdn.betterttv.net/emote/5e4e7a1f08b4447d56a92967/2x',
		source: 'BetterTTV',
		animated: false,
		kind: 'emoji',
		tags: ['pog', 'hype', 'meme']
	},
	{
		id: 'rick_roll',
		label: 'Rick Roll',
		category: 'memes',
		src: 'https://cdn.betterttv.net/emote/5fdcbdb0f0c5583492694d44/2x',
		source: 'BetterTTV',
		animated: true,
		kind: 'sticker',
		tags: ['meme', 'rickroll', 'dance']
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
