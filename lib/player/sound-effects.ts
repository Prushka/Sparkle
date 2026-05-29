export type SoundEffectCategory =
	| 'reactions'
	| 'alerts'
	| 'discord'
	| 'game'
	| 'minecraft'
	| 'roblox'
	| 'mario'
	| 'zelda'
	| 'undertale'
	| 'anime'
	| 'naruto'
	| 'jojo'
	| 'memes'
	| 'ui'
	| 'transitions'
	| 'animals'
	| 'voices'
	| 'magic'
	| 'technology';

export type SoundEffect = {
	id: string;
	name: string;
	icon: string;
	category: SoundEffectCategory;
	src: string;
	duration: string;
	source: 'Mixkit' | 'MyInstants';
	tags: string[];
};

export const soundEffectCategories: { id: SoundEffectCategory; label: string }[] = [
	{ id: 'reactions', label: 'Reactions' },
	{ id: 'alerts', label: 'Alerts' },
	{ id: 'discord', label: 'Discord' },
	{ id: 'game', label: 'Game' },
	{ id: 'minecraft', label: 'Minecraft' },
	{ id: 'roblox', label: 'Roblox' },
	{ id: 'mario', label: 'Mario' },
	{ id: 'zelda', label: 'Zelda' },
	{ id: 'undertale', label: 'Undertale' },
	{ id: 'anime', label: 'Anime' },
	{ id: 'naruto', label: 'Naruto' },
	{ id: 'jojo', label: 'JoJo' },
	{ id: 'memes', label: 'Memes' },
	{ id: 'ui', label: 'UI' },
	{ id: 'transitions', label: 'Transitions' },
	{ id: 'animals', label: 'Animals' },
	{ id: 'voices', label: 'Voices' },
	{ id: 'magic', label: 'Magic' },
	{ id: 'technology', label: 'Technology' }
];

const customSoundEffects: SoundEffect[] = [
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
	},
	{
		id: 'long_pop',
		name: 'Long Pop',
		icon: '🔊',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['pop', 'alert', 'notification']
	},
	{
		id: 'confirmation_tone',
		name: 'Confirmation',
		icon: '✅',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/2867/2867-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['confirm', 'success', 'alert']
	},
	{
		id: 'clear_announce',
		name: 'Clear Announce',
		icon: '📢',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/2861/2861-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['announce', 'alert', 'tone']
	},
	{
		id: 'correct_reward',
		name: 'Correct Reward',
		icon: '🏅',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/952/952-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['correct', 'reward', 'win']
	},
	{
		id: 'happy_bell_alert',
		name: 'Happy Bell',
		icon: '🔔',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/601/601-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['bell', 'happy', 'alert']
	},
	{
		id: 'guitar_alert',
		name: 'Guitar Alert',
		icon: '🎸',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/2320/2320-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['guitar', 'alert', 'notification']
	},
	{
		id: 'flute_notification',
		name: 'Flute Notice',
		icon: '🎶',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/2310/2310-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['flute', 'music', 'notification']
	},
	{
		id: 'urgent_simple_tone',
		name: 'Urgent Tone',
		icon: '🚨',
		category: 'alerts',
		src: 'https://assets.mixkit.co/active_storage/sfx/2976/2976-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['urgent', 'alert', 'loop']
	},
	{
		id: 'martial_punch',
		name: 'Fast Punch',
		icon: '🥊',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2047/2047-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['punch', 'hit', 'fight']
	},
	{
		id: 'player_fail',
		name: 'Player Fail',
		icon: '💥',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2042/2042-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fail', 'lose', 'game']
	},
	{
		id: 'ball_tap',
		name: 'Ball Tap',
		icon: '⚽',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2073/2073-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['ball', 'tap', 'game']
	},
	{
		id: 'player_jump',
		name: 'Player Jump',
		icon: '🕹️',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2043/2043-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['jump', 'game', 'platform']
	},
	{
		id: 'bonus_earned',
		name: 'Bonus Earned',
		icon: '⭐',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2058/2058-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['bonus', 'earned', 'game']
	},
	{
		id: 'casino_bling',
		name: 'Casino Bling',
		icon: '🎰',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2067/2067-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['casino', 'bling', 'achievement']
	},
	{
		id: 'retro_click',
		name: 'Retro Click',
		icon: '🕹️',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/237/237-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['retro', 'click', 'game']
	},
	{
		id: 'laser_bubble',
		name: 'Laser Bubble',
		icon: '🔫',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/277/277-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['laser', 'bubble', 'game']
	},
	{
		id: 'arcade_bling',
		name: 'Arcade Bling',
		icon: '👾',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/210/210-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['arcade', 'bling', 'game']
	},
	{
		id: 'level_up',
		name: 'Level Up',
		icon: '🆙',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2062/2062-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['level', 'up', 'game']
	},
	{
		id: 'final_bonus',
		name: 'Final Bonus',
		icon: '🏁',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/2061/2061-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['bonus', 'final', 'game']
	},
	{
		id: 'mystery_alert',
		name: 'Mystery Alert',
		icon: '❔',
		category: 'game',
		src: 'https://assets.mixkit.co/active_storage/sfx/234/234-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['mystery', 'alert', 'game']
	},
	{
		id: 'toy_whistle',
		name: 'Toy Whistle',
		icon: '🧸',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/616/616-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['toy', 'whistle', 'funny']
	},
	{
		id: 'creature_laugh',
		name: 'Creature Laugh',
		icon: '😂',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/414/414-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['laugh', 'creature', 'funny']
	},
	{
		id: 'failure_piano',
		name: 'Failure Piano',
		icon: '🎹',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/473/473-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fail', 'piano', 'funny']
	},
	{
		id: 'cartoon_dazzle',
		name: 'Cartoon Dazzle',
		icon: '💫',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/746/746-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['cartoon', 'dazzle', 'hit']
	},
	{
		id: 'cartoon_fart',
		name: 'Cartoon Fart',
		icon: '💨',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/2891/2891-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['cartoon', 'fart', 'funny']
	},
	{
		id: 'funny_giggle',
		name: 'Funny Giggle',
		icon: '🤭',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/2885/2885-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['giggle', 'funny', 'laugh']
	},
	{
		id: 'falling_whistle',
		name: 'Falling Whistle',
		icon: '🪂',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/395/395-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fall', 'whistle', 'cartoon']
	},
	{
		id: 'cartoon_melody',
		name: 'Cartoon Melody',
		icon: '🎵',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/2881/2881-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['cartoon', 'melody', 'funny']
	},
	{
		id: 'sad_party_horn',
		name: 'Sad Party Horn',
		icon: '📯',
		category: 'memes',
		src: 'https://assets.mixkit.co/active_storage/sfx/527/527-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['sad', 'party', 'horn']
	},
	{
		id: 'software_start',
		name: 'Software Start',
		icon: '▶️',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2574/2574-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['software', 'start', 'ui']
	},
	{
		id: 'software_back',
		name: 'Software Back',
		icon: '↩️',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2575/2575-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['software', 'back', 'ui']
	},
	{
		id: 'select_click',
		name: 'Select Click',
		icon: '🖱️',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/1109/1109-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['select', 'click', 'ui']
	},
	{
		id: 'software_remove',
		name: 'Software Remove',
		icon: '➖',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2576/2576-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['software', 'remove', 'ui']
	},
	{
		id: 'cool_click',
		name: 'Cool Click',
		icon: '🧊',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['cool', 'click', 'ui']
	},
	{
		id: 'click_error',
		name: 'Click Error',
		icon: '⚠️',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/1110/1110-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['click', 'error', 'ui']
	},
	{
		id: 'negative_tap',
		name: 'Negative Tap',
		icon: '🚫',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['negative', 'tap', 'ui']
	},
	{
		id: 'device_click',
		name: 'Device Click',
		icon: '📱',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2577/2577-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['device', 'click', 'ui']
	},
	{
		id: 'page_back',
		name: 'Page Back',
		icon: '📖',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/1108/1108-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['page', 'back', 'ui']
	},
	{
		id: 'open_interface',
		name: 'Open Interface',
		icon: '🪟',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['open', 'interface', 'ui']
	},
	{
		id: 'game_ui_tone',
		name: 'Game UI Tone',
		icon: '🎛️',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['game', 'interface', 'ui']
	},
	{
		id: 'page_turn_chime',
		name: 'Page Turn',
		icon: '📄',
		category: 'ui',
		src: 'https://assets.mixkit.co/active_storage/sfx/1106/1106-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['page', 'turn', 'chime']
	},
	{
		id: 'rocket_whoosh',
		name: 'Rocket Whoosh',
		icon: '🚀',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/1714/1714-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['rocket', 'whoosh', 'transition']
	},
	{
		id: 'cinematic_whoosh',
		name: 'Cinematic Whoosh',
		icon: '🌪️',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/1492/1492-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['cinematic', 'whoosh', 'transition']
	},
	{
		id: 'small_sweep',
		name: 'Small Sweep',
		icon: '💨',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/166/166-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['sweep', 'transition', 'fast']
	},
	{
		id: 'epic_orchestra',
		name: 'Epic Orchestra',
		icon: '🎬',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/2290/2290-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['epic', 'orchestra', 'transition']
	},
	{
		id: 'movie_impact',
		name: 'Movie Impact',
		icon: '💥',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/2909/2909-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['impact', 'movie', 'trailer']
	},
	{
		id: 'air_zoom',
		name: 'Air Zoom',
		icon: '🌀',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/2608/2608-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['air', 'zoom', 'transition']
	},
	{
		id: 'laser_thunder',
		name: 'Laser Thunder',
		icon: '⚡',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/1287/1287-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['laser', 'thunder', 'cinematic']
	},
	{
		id: 'intro_transition',
		name: 'Intro Transition',
		icon: '🎞️',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/1146/1146-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['intro', 'transition', 'video']
	},
	{
		id: 'windy_swoosh',
		name: 'Windy Swoosh',
		icon: '🌬️',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/1474/1474-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['wind', 'swoosh', 'transition']
	},
	{
		id: 'terror_sweep',
		name: 'Terror Sweep',
		icon: '🌑',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/2630/2630-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['terror', 'dark', 'sweep']
	},
	{
		id: 'tech_slide',
		name: 'Tech Slide',
		icon: '🖥️',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/3120/3120-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['technology', 'slide', 'transition']
	},
	{
		id: 'helicopter_riser',
		name: 'Helicopter Riser',
		icon: '🚁',
		category: 'transitions',
		src: 'https://assets.mixkit.co/active_storage/sfx/2719/2719-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['helicopter', 'riser', 'cinematic']
	},
	{
		id: 'birds_trees',
		name: 'Birds Singing',
		icon: '🐦',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/17/17-preview.mp3',
		duration: '0:05',
		source: 'Mixkit',
		tags: ['birds', 'trees', 'animal']
	},
	{
		id: 'dog_bark',
		name: 'Dog Bark',
		icon: '🐕',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/1/1-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['dog', 'bark', 'animal']
	},
	{
		id: 'wolf_forest',
		name: 'Wolf Forest',
		icon: '🐺',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/2485/2485-preview.mp3',
		duration: '0:04',
		source: 'Mixkit',
		tags: ['wolf', 'forest', 'animal']
	},
	{
		id: 'rooster_morning',
		name: 'Rooster Morning',
		icon: '🐓',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/2462/2462-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['rooster', 'morning', 'animal']
	},
	{
		id: 'kitty_meow',
		name: 'Kitty Meow',
		icon: '🐱',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/93/93-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['cat', 'kitty', 'meow']
	},
	{
		id: 'beast_roar',
		name: 'Beast Roar',
		icon: '🐲',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/13/13-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['beast', 'roar', 'animal']
	},
	{
		id: 'wolf_howl',
		name: 'Wolf Howl',
		icon: '🌕',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/1775/1775-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['wolf', 'howl', 'animal']
	},
	{
		id: 'cricket_screech',
		name: 'Cricket',
		icon: '🦗',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/1780/1780-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['cricket', 'animal', 'night']
	},
	{
		id: 'horse_gallop',
		name: 'Horse Gallop',
		icon: '🐎',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/83/83-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['horse', 'gallop', 'animal']
	},
	{
		id: 'monkey_giggle',
		name: 'Monkey Giggle',
		icon: '🐒',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/108/108-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['monkey', 'giggle', 'animal']
	},
	{
		id: 'owl_forest',
		name: 'Owl Forest',
		icon: '🦉',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/2466/2466-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['owl', 'forest', 'animal']
	},
	{
		id: 'farm_morning',
		name: 'Farm Morning',
		icon: '🐄',
		category: 'animals',
		src: 'https://assets.mixkit.co/active_storage/sfx/7/7-preview.mp3',
		duration: '0:04',
		source: 'Mixkit',
		tags: ['farm', 'morning', 'animals']
	},
	{
		id: 'cheer_applause',
		name: 'Cheer Applause',
		icon: '👏',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/518/518-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['cheer', 'applause', 'people']
	},
	{
		id: 'baby_sneeze',
		name: 'Baby Sneeze',
		icon: '👶',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2214/2214-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['baby', 'sneeze', 'voice']
	},
	{
		id: 'astonished_gasp',
		name: 'Gasp',
		icon: '😮',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/964/964-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['gasp', 'voice', 'surprise']
	},
	{
		id: 'child_laugh',
		name: 'Child Laugh',
		icon: '😄',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2265/2265-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['child', 'laugh', 'voice']
	},
	{
		id: 'cute_kiss',
		name: 'Cute Kiss',
		icon: '😘',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2192/2192-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['kiss', 'cute', 'voice']
	},
	{
		id: 'fighter_scream',
		name: 'Fighter Scream',
		icon: '😫',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2768/2768-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['scream', 'fighter', 'voice']
	},
	{
		id: 'crunch_chew',
		name: 'Crunch Chew',
		icon: '😋',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2244/2244-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['chew', 'crunch', 'mouth']
	},
	{
		id: 'young_cough',
		name: 'Cough',
		icon: '😷',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2227/2227-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['cough', 'voice']
	},
	{
		id: 'mouth_blow',
		name: 'Mouth Blow',
		icon: '🌬️',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2659/2659-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['blow', 'mouth', 'voice']
	},
	{
		id: 'pain_ow',
		name: 'Ow Pain',
		icon: '😖',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2204/2204-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['pain', 'ow', 'voice']
	},
	{
		id: 'tired_yawn',
		name: 'Tired Yawn',
		icon: '🥱',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2278/2278-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['yawn', 'tired', 'voice']
	},
	{
		id: 'zombie_breath',
		name: 'Zombie Breath',
		icon: '🧟',
		category: 'voices',
		src: 'https://assets.mixkit.co/active_storage/sfx/2233/2233-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['zombie', 'breath', 'voice']
	},
	{
		id: 'energy_flow',
		name: 'Energy Flow',
		icon: '✨',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/2589/2589-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['energy', 'magic', 'flow']
	},
	{
		id: 'magic_sparkle_whoosh',
		name: 'Sparkle Whoosh',
		icon: '🪄',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/2350/2350-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['magic', 'sparkle', 'whoosh']
	},
	{
		id: 'fairy_glitter',
		name: 'Fairy Glitter',
		icon: '✨',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/867/867-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fairy', 'glitter', 'magic']
	},
	{
		id: 'fairy_magic_sparkle',
		name: 'Fairy Sparkle',
		icon: '🧚',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/871/871-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fairy', 'sparkle', 'magic']
	},
	{
		id: 'fantasy_success',
		name: 'Fantasy Success',
		icon: '🏆',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fantasy', 'success', 'magic']
	},
	{
		id: 'harp_sweep',
		name: 'Harp Sweep',
		icon: '🎶',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/2628/2628-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['harp', 'sweep', 'magic']
	},
	{
		id: 'magic_light_transition',
		name: 'Magic Light',
		icon: '🌟',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/2583/2583-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['magic', 'light', 'transition']
	},
	{
		id: 'spellcaster_swoosh',
		name: 'Spellcaster',
		icon: '🧙',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/1463/1463-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['spell', 'swoosh', 'magic']
	},
	{
		id: 'magic_wand_sparkle',
		name: 'Wand Sparkle',
		icon: '🪄',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/3062/3062-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['wand', 'sparkle', 'magic']
	},
	{
		id: 'light_spell',
		name: 'Light Spell',
		icon: '💡',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/873/873-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['light', 'spell', 'magic']
	},
	{
		id: 'magic_bubbles',
		name: 'Magic Bubbles',
		icon: '🫧',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/2999/2999-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['bubbles', 'spell', 'magic']
	},
	{
		id: 'fairy_teleport',
		name: 'Fairy Teleport',
		icon: '🧚',
		category: 'magic',
		src: 'https://assets.mixkit.co/active_storage/sfx/868/868-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['fairy', 'teleport', 'magic']
	},
	{
		id: 'classic_alarm',
		name: 'Classic Alarm',
		icon: '⏰',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['alarm', 'classic', 'technology']
	},
	{
		id: 'countdown_bleeps',
		name: 'Countdown',
		icon: '⏱️',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/916/916-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['countdown', 'bleep', 'technology']
	},
	{
		id: 'emergency_alarm',
		name: 'Emergency Alarm',
		icon: '🚨',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/1000/1000-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['emergency', 'alarm', 'technology']
	},
	{
		id: 'modern_select',
		name: 'Modern Select',
		icon: '🖱️',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/3124/3124-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['modern', 'select', 'technology']
	},
	{
		id: 'futuristic_hum',
		name: 'Futuristic Hum',
		icon: '🛸',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/2133/2133-preview.mp3',
		duration: '0:04',
		source: 'Mixkit',
		tags: ['futuristic', 'hum', 'technology']
	},
	{
		id: 'electric_glitch',
		name: 'Electric Glitch',
		icon: '⚡',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/2594/2594-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['electric', 'glitch', 'technology']
	},
	{
		id: 'high_tech_bleep',
		name: 'High Tech Bleep',
		icon: '📟',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/2521/2521-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['bleep', 'high tech', 'technology']
	},
	{
		id: 'sci_fi_loading',
		name: 'Sci-Fi Loading',
		icon: '💽',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/2529/2529-preview.mp3',
		duration: '0:03',
		source: 'Mixkit',
		tags: ['sci-fi', 'loading', 'technology']
	},
	{
		id: 'power_up',
		name: 'Power Up',
		icon: '🔌',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/2602/2602-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['power', 'up', 'technology']
	},
	{
		id: 'technology_alert',
		name: 'Tech Alert',
		icon: '🚨',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/3121/3121-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['alert', 'technology', 'transition']
	},
	{
		id: 'robot_item',
		name: 'Robot Item',
		icon: '🤖',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/3205/3205-preview.mp3',
		duration: '0:02',
		source: 'Mixkit',
		tags: ['robot', 'item', 'technology']
	},
	{
		id: 'alien_button',
		name: 'Alien Button',
		icon: '👽',
		category: 'technology',
		src: 'https://assets.mixkit.co/active_storage/sfx/3118/3118-preview.mp3',
		duration: '0:01',
		source: 'Mixkit',
		tags: ['alien', 'button', 'technology']
	},
	{
		id: 'anime_wow',
		name: 'Anime Wow',
		icon: '😲',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'wow', 'reaction']
	},
	{
		id: 'tuturu',
		name: 'Tuturu',
		icon: '🌸',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/tuturu_1.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'cute', 'steins gate']
	},
	{
		id: 'za_warudo',
		name: 'Za Warudo',
		icon: '⏱️',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/za-warudo-stop-time-sound.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'time stop']
	},
	{
		id: 'anime_punch',
		name: 'Anime Punch',
		icon: '🥊',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/strongpunch.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['anime', 'punch', 'hit']
	},
	{
		id: 'nya_cat_girl',
		name: 'Nya',
		icon: '🐾',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/nya_2xyALFL.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['anime', 'nya', 'cat']
	},
	{
		id: 'jutsu_activation',
		name: 'Jutsu',
		icon: '🔥',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/katon.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'jutsu']
	},
	{
		id: 'sugoi_sugoi',
		name: 'Sugoi Sugoi',
		icon: '✨',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/sugoi-sugoi.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'sugoi', 'reaction']
	},
	{
		id: 'anime_nani',
		name: 'Nani',
		icon: '❔',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/tmph3o88c10.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'nani', 'reaction']
	},
	{
		id: 'anime_good_job',
		name: 'Good Job',
		icon: '👏',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/good-job_d15pHHg.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'good job', 'praise']
	},
	{
		id: 'anime_senpai',
		name: 'Senpai',
		icon: '💌',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/anime-girl-senpai.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'senpai', 'voice']
	},
	{
		id: 'naruto_sad_song',
		name: 'Naruto Sad',
		icon: '🍃',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/naruto-sad-music-instant.mp3',
		duration: '0:05',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'sad']
	},
	{
		id: 'naruto_battle',
		name: 'Naruto Battle',
		icon: '⚔️',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/naruto-the-raising-fighting-spirit-extended-audiotrimmer_7wvXRts.mp3',
		duration: '0:05',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'battle']
	},
	{
		id: 'dattebayo',
		name: 'Dattebayo',
		icon: '🌀',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/d-a-t-t-e-b-a-y-o-meme-audiotrimmer.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'voice']
	},
	{
		id: 'shadow_clone',
		name: 'Shadow Clone',
		icon: '🥷',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/naruto_shadow_clones.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'jutsu']
	},
	{
		id: 'sharingan',
		name: 'Sharingan',
		icon: '👁️',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/itachi-mangekyou-sharingan-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'jutsu']
	},
	{
		id: 'rasengan',
		name: 'Rasengan',
		icon: '🌀',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/naruto-rasenganshippuden-mp3cut.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['anime', 'naruto', 'attack']
	},
	{
		id: 'jojo_to_be_continued',
		name: 'To Be Continued',
		icon: '➡️',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/untitled_1071.mp3',
		duration: '0:04',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'meme']
	},
	{
		id: 'giorno_theme',
		name: 'Giorno Theme',
		icon: '🎹',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/giornos-theme-but-only-the-best-part-is-in_vwd15lya_lyb0-online-audio-converter.mp3',
		duration: '0:05',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'theme']
	},
	{
		id: 'jojo_ayayay',
		name: 'Ayayay',
		icon: '🗿',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/jojos-bizarre-adventure-ay-ay-ay-ay-_-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'chant']
	},
	{
		id: 'jojo_yes',
		name: 'Yes Yes Yes',
		icon: '✅',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/yes-yes-yes-yes-yes.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'yes']
	},
	{
		id: 'wryyy',
		name: 'WRYYY',
		icon: '🧛',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/dio-wryyy.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'dio']
	},
	{
		id: 'ora_ora',
		name: 'Ora Ora',
		icon: '👊',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/jojos-bizarre-adventure-asb-ora-ora-ora.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'attack']
	},
	{
		id: 'kono_dio_da',
		name: 'Kono Dio Da',
		icon: '😈',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/kono-dio-da99.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'dio']
	},
	{
		id: 'muda_muda',
		name: 'Muda Muda',
		icon: '💢',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/muda_muda_muda_sound_effect.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'attack']
	},
	{
		id: 'goodbye_jojo',
		name: 'Goodbye Jojo',
		icon: '👋',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/goodbye-jojo.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'voice']
	},
	{
		id: 'rero_rero',
		name: 'Rero Rero',
		icon: '🍒',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/rero-rero-rero.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'meme']
	},
	{
		id: 'jojo_nice',
		name: 'Jojo Nice',
		icon: '👌',
		category: 'anime',
		src: 'https://www.myinstants.com/media/sounds/joseph-joestar-nice.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['anime', 'jojo', 'nice']
	},
	{
		id: 'metal_gear_alert',
		name: 'Metal Gear',
		icon: '❗',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/metalgearsolid.swf.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'alert', 'stealth']
	},
	{
		id: 'minecraft_drink',
		name: 'MC Drink',
		icon: '🧪',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/minecraft-drinking-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'drink']
	},
	{
		id: 'minecraft_hurt',
		name: 'MC Hurt',
		icon: '🟩',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/classic_hurt.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'hurt']
	},
	{
		id: 'minecraft_villager',
		name: 'Villager',
		icon: '🧑‍🌾',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/minecraft-villager-sound-effect.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'villager']
	},
	{
		id: 'minecraft_click',
		name: 'MC Click',
		icon: '🧱',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/minecraft_click.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'click']
	},
	{
		id: 'minecraft_xp',
		name: 'MC XP',
		icon: '🟢',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/orb.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'xp']
	},
	{
		id: 'minecraft_level_up',
		name: 'MC Level Up',
		icon: '⬆️',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/levelup.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'level']
	},
	{
		id: 'enderman_teleport',
		name: 'Enderman',
		icon: '🌌',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/teleport1_Cw1ot9l.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'teleport']
	},
	{
		id: 'creeper_explosion',
		name: 'Creeper Boom',
		icon: '💥',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/creeper-explosion.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'explosion']
	},
	{
		id: 'minecraft_drop',
		name: 'MC Drop',
		icon: '📦',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/minecraft-drop-block-sound-effect.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'drop']
	},
	{
		id: 'minecraft_totem',
		name: 'MC Totem',
		icon: '🪽',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/minecraft-totem-sound.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'totem']
	},
	{
		id: 'minecraft_bow',
		name: 'MC Bow',
		icon: '🏹',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/bow_shoot.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'minecraft', 'bow']
	},
	{
		id: 'roblox_oof',
		name: 'Roblox Oof',
		icon: '🧱',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'roblox', 'oof']
	},
	{
		id: 'roblox_explosion',
		name: 'Roblox Boom',
		icon: '💣',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/roblox-explosion-sound.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'roblox', 'explosion']
	},
	{
		id: 'roblox_sword',
		name: 'Roblox Sword',
		icon: '⚔️',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/roblox-sword.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'roblox', 'sword']
	},
	{
		id: 'gamecube_intro',
		name: 'GameCube',
		icon: '🟪',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/gamecube_intro.mp3',
		duration: '0:04',
		source: 'MyInstants',
		tags: ['game', 'nintendo', 'startup']
	},
	{
		id: 'dark_souls_death',
		name: 'You Died',
		icon: '☠️',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/dark-souls-you-died-sound-effect_hm5sYFG.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['game', 'dark souls', 'death']
	},
	{
		id: 'gameboy_startup',
		name: 'Game Boy',
		icon: '🎮',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/nintendo-game-boy-startup.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'nintendo', 'startup']
	},
	{
		id: 'mario_jump',
		name: 'Mario Jump',
		icon: '🍄',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/maro-jump-sound-effect_1.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'mario', 'jump']
	},
	{
		id: 'mario_death',
		name: 'Mario Death',
		icon: '💀',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/super-mario-death-sound-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'mario', 'death']
	},
	{
		id: 'mario_coin',
		name: 'Mario Coin',
		icon: '🪙',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/super-mario-coin-sound.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'mario', 'coin']
	},
	{
		id: 'mario_one_up',
		name: 'Mario 1-Up',
		icon: '🍄',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/mario-1-up.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'mario', 'life']
	},
	{
		id: 'mario_pipe',
		name: 'Mario Pipe',
		icon: '🟩',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/super-mario-bros.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'mario', 'pipe']
	},
	{
		id: 'mario_power_up',
		name: 'Mario Power',
		icon: '⭐',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/01-power-up-mario.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'mario', 'power']
	},
	{
		id: 'mario_yahoo',
		name: 'Mario Yahoo',
		icon: '🙌',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/super-mario-64-yahoo-sound.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'mario', 'voice']
	},
	{
		id: 'zelda_item_get',
		name: 'Zelda Item',
		icon: '🗡️',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/139-item-catch.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'zelda', 'item']
	},
	{
		id: 'zelda_chest',
		name: 'Zelda Chest',
		icon: '🎁',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/zelda-chest-opening-and-item-catch.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['game', 'zelda', 'chest']
	},
	{
		id: 'zelda_rupee',
		name: 'Rupee',
		icon: '💎',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/rupee-collect.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'zelda', 'rupee']
	},
	{
		id: 'hey_listen',
		name: 'Hey Listen',
		icon: '🧚',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/zelda-navi-listen.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'zelda', 'navi']
	},
	{
		id: 'zelda_secret',
		name: 'Zelda Secret',
		icon: '🔎',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/ringtones-zelda-1.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'zelda', 'secret']
	},
	{
		id: 'sans_talking',
		name: 'Sans Talk',
		icon: '💀',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/just-sans-talking.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'sans']
	},
	{
		id: 'gaster_blaster',
		name: 'Gaster Blaster',
		icon: '💀',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/gaster_blaster_sound_effect_1.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'attack']
	},
	{
		id: 'undertale_damage',
		name: 'UT Damage',
		icon: '❤️',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/undertale-damage-taken.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'damage']
	},
	{
		id: 'undertale_savepoint',
		name: 'Savepoint',
		icon: '💾',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/savepoint.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'save']
	},
	{
		id: 'soul_shatter',
		name: 'Soul Shatter',
		icon: '💔',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/undertale-soul-shatter.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'soul']
	},
	{
		id: 'undertale_game_over',
		name: 'UT Game Over',
		icon: '🪦',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/undertale-game-over.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'game over']
	},
	{
		id: 'undertale_select',
		name: 'UT Select',
		icon: '☑️',
		category: 'game',
		src: 'https://www.myinstants.com/media/sounds/undertale-select-sound.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['game', 'undertale', 'select']
	},
	{
		id: 'vine_boom',
		name: 'Vine Boom',
		icon: '💥',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/vine-boom.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'vine', 'boom']
	},
	{
		id: 'run_vine',
		name: 'Run Vine',
		icon: '🏃',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'vine', 'run']
	},
	{
		id: 'bruh_meme',
		name: 'Bruh',
		icon: '🫠',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/movie_1.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['meme', 'bruh', 'reaction']
	},
	{
		id: 'sad_violin_meme',
		name: 'Sad Violin',
		icon: '🎻',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/tf_nemesis.mp3',
		duration: '0:04',
		source: 'MyInstants',
		tags: ['meme', 'sad', 'violin']
	},
	{
		id: 'among_role_reveal',
		name: 'Role Reveal',
		icon: '🟥',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/among-us-role-reveal-sound.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['meme', 'among us', 'sus']
	},
	{
		id: 'emotional_damage',
		name: 'Emotional Damage',
		icon: '🧠',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'damage', 'reaction']
	},
	{
		id: 'instagram_thud',
		name: 'Thud',
		icon: '📉',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/vine-boom-sound-effect_KT89XIq.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'thud', 'boom']
	},
	{
		id: 'shocked_sound',
		name: 'Shocked',
		icon: '😱',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/shocked-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'shock', 'reaction']
	},
	{
		id: 'dun_dun_dun',
		name: 'Dun Dun Dun',
		icon: '🎺',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/dun-dun-dun-sound-effect-brass_8nFBccR.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'dramatic', 'sting']
	},
	{
		id: 'cat_laugh_meme',
		name: 'Cat Laugh',
		icon: '😹',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/cat-laugh-meme-1.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'cat', 'laugh']
	},
	{
		id: 'snore_mimimi',
		name: 'Mimimi',
		icon: '😴',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/snore-mimimimimimi.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['meme', 'sleep', 'snore']
	},
	{
		id: 'oh_my_god_meme',
		name: 'Oh My God',
		icon: '😳',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/oh-my-god-meme.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'reaction', 'omg']
	},
	{
		id: 'wide_putin',
		name: 'Wide Putin',
		icon: '🚶',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/my-movie-6_0RlWMvM.mp3',
		duration: '0:05',
		source: 'MyInstants',
		tags: ['meme', 'wide', 'song']
	},
	{
		id: 'what_da_dog_doin',
		name: 'Dog Doin',
		icon: '🐶',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/yt1s_wU4BGgD.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'dog', 'reaction']
	},
	{
		id: 'oh_no_no_tiktok',
		name: 'Oh No No',
		icon: '🙅',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/oh-no-no-no-tik-tok-song-sound-effect.mp3',
		duration: '0:04',
		source: 'MyInstants',
		tags: ['meme', 'oh no', 'tiktok']
	},
	{
		id: 'oh_hell_no',
		name: 'Oh Hell No',
		icon: '🚫',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/oh-hell-no-sound-effect-free-download.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'no', 'reaction']
	},
	{
		id: 'why_you_lying',
		name: 'Always Lying',
		icon: '🤥',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/why-you-always-lying-original.mp3',
		duration: '0:04',
		source: 'MyInstants',
		tags: ['meme', 'lying', 'vine']
	},
	{
		id: 'taco_bell_bong',
		name: 'Taco Bell',
		icon: '🔔',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/taco-bell.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'bell', 'bong']
	},
	{
		id: 'the_rock_meme',
		name: 'The Rock',
		icon: '🤨',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/the-rock-meme-sound-effect.mp3',
		duration: '0:02',
		source: 'MyInstants',
		tags: ['meme', 'rock', 'reaction']
	},
	{
		id: 'look_at_this_dude',
		name: 'Look At Dude',
		icon: '👀',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/look-at-this-dude.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['meme', 'reaction', 'look']
	},
	{
		id: 'among_emergency',
		name: 'Emergency',
		icon: '🚨',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/emergency-meeting-sound-among-us.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['meme', 'among us', 'emergency']
	},
	{
		id: 'body_reported',
		name: 'Body Reported',
		icon: '🦴',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/report_bobdyfound_1.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['meme', 'among us', 'reported']
	},
	{
		id: 'among_eject',
		name: 'Ejected',
		icon: '🚀',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/among-us-eject-sound-effect.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['meme', 'among us', 'eject']
	},
	{
		id: 'sus_sound',
		name: 'Sus',
		icon: '📮',
		category: 'memes',
		src: 'https://www.myinstants.com/media/sounds/sus_5644vtL.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['meme', 'among us', 'sus']
	},
	{
		id: 'discord_notification',
		name: 'Discord Ping',
		icon: '💬',
		category: 'ui',
		src: 'https://www.myinstants.com/media/sounds/discord-notification.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['discord', 'notification', 'ping']
	},
	{
		id: 'discord_call',
		name: 'Discord Call',
		icon: '📞',
		category: 'ui',
		src: 'https://www.myinstants.com/media/sounds/discord-call-sound.mp3',
		duration: '0:03',
		source: 'MyInstants',
		tags: ['discord', 'call', 'ring']
	},
	{
		id: 'discord_join',
		name: 'Discord Join',
		icon: '✅',
		category: 'ui',
		src: 'https://www.myinstants.com/media/sounds/discord-sounds.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['discord', 'join', 'voice']
	},
	{
		id: 'discord_leave',
		name: 'Discord Leave',
		icon: '↩️',
		category: 'ui',
		src: 'https://www.myinstants.com/media/sounds/discord-leave-noise.mp3',
		duration: '0:01',
		source: 'MyInstants',
		tags: ['discord', 'leave', 'voice']
	}
];

function refineSoundEffectCategory(effect: SoundEffect): SoundEffectCategory {
	const text = `${effect.id} ${effect.name} ${effect.tags.join(' ')}`.toLowerCase();
	if (/discord/.test(text)) return 'discord';
	if (/minecraft|\bmc\b|creeper|enderman|villager|totem/.test(text)) return 'minecraft';
	if (/roblox/.test(text)) return 'roblox';
	if (/mario|luigi|yoshi|mushroom/.test(text)) return 'mario';
	if (/zelda|rupee|navi|korok|link/.test(text)) return 'zelda';
	if (/undertale|\but\b|sans|gaster|flowey|soul/.test(text)) return 'undertale';
	if (/naruto|jutsu|rasengan|sharingan|dattebayo/.test(text)) return 'naruto';
	if (/jojo|dio|giorno|ora|muda|warudo|wryyy|rero/.test(text)) return 'jojo';
	if (/anime|senpai|\bnya\b|sugoi|nani|tuturu/.test(text)) return 'anime';
	if (
		/meme|vine|bruh|among|sus|emotional|thud|tiktok|putin|dog doin|oh hell|oh my god|snore|wide/.test(
			text
		)
	) {
		return 'memes';
	}
	return effect.category;
}

export const soundEffects: SoundEffect[] = customSoundEffects.map((effect) => ({
	...effect,
	category: refineSoundEffectCategory(effect)
}));

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
