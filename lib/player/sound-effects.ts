export type SoundEffectCategory = 'reactions' | 'game' | 'memes' | 'ui';

export type SoundEffect = {
	id: string;
	name: string;
	icon: string;
	category: SoundEffectCategory;
	src: string;
	duration: string;
	source: 'Mixkit';
	tags: string[];
};

export const soundEffectCategories: { id: SoundEffectCategory; label: string }[] = [
	{ id: 'reactions', label: 'Reactions' },
	{ id: 'game', label: 'Game' },
	{ id: 'memes', label: 'Memes' },
	{ id: 'ui', label: 'UI' }
];

export const soundEffects: SoundEffect[] = [
	{
		id: 'correct_tone',
		name: 'Correct Answer',
		icon: '✅',
		category: 'reactions',
		src: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['correct', 'yes', 'success']
	},
	{
		id: 'wrong_fail',
		name: 'Wrong Answer',
		icon: '❌',
		category: 'reactions',
		src: 'https://assets.mixkit.co/active_storage/sfx/946/946-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['wrong', 'fail', 'no']
	},
	{
		id: 'positive_ping',
		name: 'Positive Ping',
		icon: '✨',
		category: 'reactions',
		src: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['positive', 'ping', 'nice']
	},
	{
		id: 'happy_bells',
		name: 'Happy Bells',
		icon: '🔔',
		category: 'reactions',
		src: 'https://assets.mixkit.co/active_storage/sfx/937/937-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['happy', 'bells', 'win']
	},
	{
		id: 'coin_win',
		name: 'Coin Win',
		icon: '🪙',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2069/2069-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['coin', 'win', 'game']
	},
	{
		id: 'level_complete',
		name: 'Level Complete',
		icon: '🏆',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2059/2059-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['level', 'complete', 'win']
	},
	{
		id: 'unlock_item',
		name: 'Unlock Item',
		icon: '🔓',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/253/253-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['unlock', 'item', 'reward']
	},
	{
		id: 'game_over',
		name: 'Game Over',
		icon: '💀',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/276/276-preview.mp3',
		duration: '0:05',
		source: 'Mixkit',
		tags: ['lose', 'game over', 'fail']
	},
	{
		id: 'health_recharge',
		name: 'Health Recharge',
		icon: '💚',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2837/2837-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['health', 'recharge', 'heal']
	},
	{
		id: 'treasure',
		name: 'Treasure',
		icon: '💎',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2066/2066-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['treasure', 'reward', 'loot']
	},
	{
		id: 'trombone',
		name: 'Trombone',
		icon: '🎺',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/744/744-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['sad', 'fail', 'meme']
	},
	{
		id: 'cartoon_laugh',
		name: 'Cartoon Laugh',
		icon: '😂',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/2882/2882-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['laugh', 'funny', 'meme']
	},
	{
		id: 'boing',
		name: 'Boing',
		icon: '🌀',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/2894/2894-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['boing', 'hit', 'bounce']
	},
	{
		id: 'clown_horn',
		name: 'Clown Horn',
		icon: '📣',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/2886/2886-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['horn', 'funny', 'meme']
	},
	{
		id: 'message_pop',
		name: 'Message Pop',
		icon: '💬',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['message', 'pop', 'alert']
	},
	{
		id: 'bell_notification',
		name: 'Bell',
		icon: '🔔',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/933/933-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['bell', 'notification', 'ding']
	},
	{
		id: 'sci_fi_click',
		name: 'Sci-Fi Click',
		icon: '🛸',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/900/900-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['click', 'sci-fi', 'ui']
	},
	{
		id: 'interface_select',
		name: 'Interface Select',
		icon: '☑️',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['select', 'interface', 'ui']
	},
	{
		id: 'page_chime',
		name: 'Page Chime',
		icon: '📄',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/1107/1107-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['page', 'chime', 'ui']
	}
];

export const soundEffectById = new Map(soundEffects.map((effect) => [effect.id, effect]));

export function getSoundEffect(id: string | null | undefined): SoundEffect | undefined {
	if (!id) {
		return undefined;
	}
	return soundEffectById.get(id);
}

export function searchSoundEffects(query: string, limit = 24): SoundEffect[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return soundEffects.slice(0, limit);
	}
	return soundEffects
		.map((effect) => {
			const idScore = effect.id.startsWith(normalized) ? 0 : effect.id.includes(normalized) ? 2 : 9;
			const name = effect.name.toLowerCase();
			const nameScore = name.startsWith(normalized) ? 1 : name.includes(normalized) ? 3 : 9;
			const tagScore = effect.tags.some((tag) => tag.startsWith(normalized))
				? 4
				: effect.tags.some((tag) => tag.includes(normalized))
					? 5
					: 9;
			return { effect, score: Math.min(idScore, nameScore, tagScore) };
		})
		.filter(({ score }) => score < 9)
		.sort((a, b) => a.score - b.score || a.effect.name.localeCompare(b.effect.name))
		.slice(0, limit)
		.map(({ effect }) => effect);
}
