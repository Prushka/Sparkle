import type { ChatEmojiRef } from '@/lib/player/emoji';
import { getCueForgeLanguageName } from '@/lib/player/languages';

export interface DiscordUser {
	username: string;
	discriminator: string;
	id: string;
	public_flags: number;
	avatar?: string | null | undefined;
	global_name?: string | null | undefined;
}

export interface Discord {
	access_token?: string;
	user: DiscordUser;
	scopes: string[];
	expires: string;
	application: {
		id: string;
		description: string;
		name: string;
		icon?: string | null | undefined;
		rpc_origins?: string[] | undefined;
	};
	channelId: string;
	guildId?: string | null;
}

export function getName(discord: DiscordUser | null | undefined): string | undefined {
	if (discord?.global_name) {
		return discord.global_name;
	}
	return discord?.username;
}

export function getAvatarUrl(discord: DiscordUser) {
	if (discord.avatar) {
		if (discord.avatar.startsWith('a_')) {
			return `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.gif`;
		}
		return `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.webp`;
	}
	if (discord.username) {
		try {
			return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(discord.id) >> 22n) % 6n)}.png`;
		} catch {
			return `https://cdn.discordapp.com/embed/avatars/${Number.parseInt(discord.id, 10) % 6}.png`;
		}
	}
	return `https://cdn.discordapp.com/embed/avatars/${Number.parseInt(discord.discriminator, 10) % 5}.png`;
}

export function isExpired(datetimeString: string): boolean {
	const currentDateTime = new Date();
	const givenDateTime = new Date(datetimeString);
	if (givenDateTime < currentDateTime) {
		console.log('Token expired');
	}
	return givenDateTime < currentDateTime;
}

export interface Watching {
	id: string;
	title: string;
	se: string;
	seTitle: string;
	duration: number;
	totalDuration: number;
	roomPlayers: number;
	thumbnail: string;
	paused: boolean;
	timeEntered: number;
}

export interface Player {
	paused?: boolean;
	time?: number;
	name: string;
	id: string;
	profileId?: string;
	inBg: boolean;
	lastSeen?: number;
	audio: string;
	codec: string;
	subtitle: string;
	discordUser: DiscordUser | null | undefined;
}

export interface PlayerStatus {
	id: string;
	time: number;
	paused: boolean;
	inBg: boolean;
	lastSeen: number;
}

export interface ChatAuthor {
	name: string;
	id: string;
	profileId?: string;
	discordUser?: DiscordUser | null | undefined;
}

export interface YouTubeTabSyncState {
	id: string;
	open: boolean;
	url: string;
	videoId: string;
	time: number;
	paused: boolean;
	playbackRate: number;
	updatedAt: number;
}

export interface YouTubeSyncState {
	tabs: YouTubeTabSyncState[];
	updatedAt: number;
}

export type ChessColor = 'w' | 'b';
export type ChessTabPhase = 'setup' | 'playing' | 'ended';
export type ChessPieceSet = 'classic' | 'pixel' | 'pixel-wood' | 'pixel-simple';
export type ChessBoardTheme = 'green' | 'blue' | 'walnut';
export type ChessResultWinner = ChessColor | 'draw' | '';

export interface ChessPlayerSyncState {
	id: string;
	name: string;
	profileId?: string;
}

export interface ChessSettingsSyncState {
	pieceSet: ChessPieceSet;
	boardTheme: ChessBoardTheme;
	timed: boolean;
	minutes: number;
	incrementSeconds: number;
}

export interface ChessMoveSyncState {
	from: string;
	to: string;
	promotion?: string;
	san: string;
}

export interface ChessClockSyncState {
	w: number;
	b: number;
	lastTickAt: number;
}

export interface ChessCloseRequestSyncState {
	requestedBy: ChessPlayerSyncState;
	requestedAt: number;
	expiresAt: number;
}

export interface ChessDrawOfferSyncState {
	offeredBy: ChessPlayerSyncState;
	offeredAt: number;
}

export interface ChessResultSyncState {
	winner: ChessResultWinner;
	reason: string;
	message: string;
}

export interface ChessSoundEffectContext {
	tabId: string;
	whiteId: string;
	blackId: string;
	winner: ChessResultWinner;
	reason?: string;
}

export interface ChessTabSyncState {
	id: string;
	open: boolean;
	phase: ChessTabPhase;
	settings: ChessSettingsSyncState;
	white: ChessPlayerSyncState | null;
	black: ChessPlayerSyncState | null;
	fen: string;
	moves: ChessMoveSyncState[];
	clocks: ChessClockSyncState;
	result: ChessResultSyncState | null;
	closeRequest: ChessCloseRequestSyncState | null;
	drawOffer: ChessDrawOfferSyncState | null;
	updatedAt: number;
}

export interface ChessSyncState {
	tabs: ChessTabSyncState[];
	updatedAt: number;
}

export type WordleMode = 'competitive' | 'coop';
export type WordlePhase = 'setup' | 'playing' | 'ended';
export type WordleTileStatus = 'empty' | 'typed' | 'absent' | 'present' | 'correct';

export interface WordlePlayerSyncState {
	id: string;
	name: string;
	profileId?: string;
}

export interface WordleSettingsSyncState {
	mode: WordleMode;
	turns: number;
}

export interface WordleRowSyncState {
	statuses: WordleTileStatus[];
	typed: number;
	submitted: boolean;
	playerId?: string;
	guess?: string;
}

export interface WordleBoardSyncState {
	id: string;
	playerId?: string;
	rows: WordleRowSyncState[];
	currentRow: number;
	solved: boolean;
	finished: boolean;
	finishedAt: number;
}

export interface WordleResultSyncState {
	winnerIds: string[];
	message: string;
}

export interface WordleTabSyncState {
	id: string;
	open: boolean;
	phase: WordlePhase;
	settings: WordleSettingsSyncState;
	players: WordlePlayerSyncState[];
	boards: WordleBoardSyncState[];
	activeBoardId: string;
	turnPlayerId: string;
	startedAt: number;
	result: WordleResultSyncState | null;
	updatedAt: number;
}

export interface WordleSyncState {
	tabs: WordleTabSyncState[];
	updatedAt: number;
}

export type CottagePlayerAction = 'idle' | 'walking' | 'sitting' | 'sleeping' | 'interacting';
export type CottagePlayerFacing = 'up' | 'down' | 'left' | 'right';

export interface CottagePlayerSyncState {
	id: string;
	name: string;
	profileId?: string;
	x: number;
	y: number;
	targetX?: number;
	targetY?: number;
	action: CottagePlayerAction;
	facing: CottagePlayerFacing;
	interactionId?: string;
	updatedAt: number;
}

export interface CottageSyncState {
	players: CottagePlayerSyncState[];
	updatedAt: number;
}

export type Chat = {
	message: string;
	emojis?: string[];
	emojiRefs?: ChatEmojiRef[];
	author?: ChatAuthor;
	timestamp: number;
	mediaSec: number;
	uid: string;
	isStateUpdate: boolean;
	isSystem?: boolean;
	timeStr: string;
};

export const codecsPriority = ['av1', 'hevc', 'h264-10bit', 'h264-8bit'];
export const hideControlsOnChatFocused = 1.5;
export const supportedCodecs = ['av1', 'hevc', 'h264-8bit'];
export const codecMap: { [key: string]: string } = {
	av1: 'av01.0.01M.08',
	hevc: 'hvc1.1.6.L93.B0',
	'h264-8bit': 'avc1.42C01E',
	'h264-10bit': 'avc1.6E001F'
};
export const moveSeconds = 5;

export const codecDisplayMap: { [key: string]: string } = {
	av1: 'AV1',
	hevc: 'HEVC',
	'h264-8bit': 'H.264',
	auto: 'Auto'
};

const subtitleTypePriorityNormal = ['ass', 'sup', 'vtt'] as const;
const subtitleTypePriorityIOS = ['vtt', 'ass', 'sup'] as const;
const subtitleLanguagePriority = ['en'];

type SubtitleTypePriorityFormat = (typeof subtitleTypePriorityNormal)[number];

export const chatLayouts = ['show', 'hide'];

export function getSupportedCodecs() {
	const supported: string[] = [];
	try {
		if (typeof document === 'undefined') {
			return supported;
		}
		for (const codec of supportedCodecs) {
			const obj = document.createElement('video');
			const toTest = `video/mp4; codecs="${codecMap[codec]}"`;
			const canPlayType = obj.canPlayType(toTest);
			console.log(codecMap[codec], canPlayType);
			if (canPlayType !== '') {
				supported.push(codec);
			}
		}
	} catch (error) {
		console.log(error);
	}
	return supported;
}

export enum SyncTypes {
	NewPlayer = 'new player',
	ProfileSync = 'profile',
	TimeSync = 'time',
	PauseSync = 'pause',
	ChatSync = 'chat',
	PlayersStatusSync = 'players',
	PlayerStatusSync = 'playerStatus',
	HeartbeatSync = 'heartbeat',
	PfpSync = 'pfp',
	StateSync = 'state',
	BroadcastSync = 'broadcast',
	YouTubeSync = 'youtube',
	ChessSync = 'chess',
	WordleSync = 'wordle',
	CottageSync = 'cottage',
	AudioSwitch = 'audio',
	CodecSwitch = 'codec',
	SubtitleSwitch = 'subtitle',
	ExitSync = 'exit',
	PlayerLeft = 'left',
	PlayerJoined = 'joined'
}

export enum BroadcastTypes {
	MoveTo = 'moveTo',
	VoiceSignal = 'voiceSignal',
	SoundEffect = 'soundEffect'
}

export interface SendPayload {
	type: string;
	time?: number;
	targetId?: string;
	paused?: boolean;
	firedBy?: Player;
	chat?: Chat;
	chats?: Chat[];
	players?: Player[];
	playerStatuses?: PlayerStatus[];
	playersCount?: number;
	timestamp: number;
	broadcast?: BroadcastPayload;
	audio?: string;
	codec?: string;
	subtitle?: string;
	moveToText?: string;
	youtube?: YouTubeSyncState;
	chess?: ChessSyncState;
	wordle?: WordleSyncState;
	cottage?: CottageSyncState;
}

export interface BroadcastPayload {
	type: string;
	moveTo?: string;
	targetId?: string;
	signal?: VoiceSignalPayload;
	soundEffect?: SoundEffectPayload;
}

export interface SoundEffectPayload {
	id: string;
	chess?: ChessSoundEffectContext;
}

export type VoiceSignalKind = 'hello' | 'offer' | 'answer' | 'ice' | 'leave' | 'status';

export interface VoiceSignalPayload {
	kind: VoiceSignalKind;
	sessionId: string;
	description?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
	muted?: boolean;
}

export interface Job {
	Id: string;
	Input: string;
	State: string;
	EncodedCodecs: string[];
	MappedAudio: { [key: string]: Stream[] };
	Files: { [key: string]: number };
	Streams: Stream[];
	Duration: number;
	width?: number;
	height?: number;
	Chapters: Chapter[];
	DominantColors: string[];
	ExtractedQuality: string;
	JobModTime: number;
	Title: Title;
}

export type LibraryJob = Pick<
	Job,
	| 'Id'
	| 'Input'
	| 'EncodedCodecs'
	| 'Files'
	| 'Duration'
	| 'DominantColors'
	| 'ExtractedQuality'
	| 'JobModTime'
	| 'Title'
> & { State?: string };

export interface Chapter {
	start: number;
	end: number;
	start_time?: string;
	end_time?: string;
	time_base?: string;
	tags: { [key: string]: any };
}

export interface Stream {
	CodecType: string;
	Index: number;
	Location: string;
	Language: string;
	Title: string;
}

type CueForgeSubtitleInfo = {
	annotated: boolean;
	languageId: string;
	languageName: string;
};

const cueForgeSubtitlePattern = /^cueforge_([a-z0-9-]+?)(?:_annotated)?$/i;

function normalizeCueForgeSubtitleCandidate(value: string) {
	const clean = value.split(/[?#]/)[0].split('/').pop() || value;
	return clean
		.replace(/\.[^.]+$/, '')
		.replace(/^external\s*-\s*/i, '')
		.trim();
}

export function getCueForgeSubtitleInfo(
	stream: Pick<Stream, 'Language' | 'Location' | 'Title'>
): CueForgeSubtitleInfo | null {
	for (const value of [stream.Location, stream.Language, stream.Title]) {
		if (!value) {
			continue;
		}
		const candidate = normalizeCueForgeSubtitleCandidate(value);
		const match = cueForgeSubtitlePattern.exec(candidate);
		if (!match) {
			continue;
		}
		const languageId = match[1].toLowerCase();
		const languageName = getCueForgeLanguageName(languageId);
		if (!languageName) {
			continue;
		}
		return {
			annotated: /_annotated$/i.test(candidate),
			languageId,
			languageName
		};
	}
	return null;
}

export function getCueForgeSubtitleDisplayName(
	stream: Pick<Stream, 'Language' | 'Location' | 'Title'>
) {
	const info = getCueForgeSubtitleInfo(stream);
	if (!info) {
		return '';
	}
	return `${info.languageName} (${info.annotated ? 'Annotated' : 'Translated'})`;
}

export function audiosExistForCodec(job: Job, codec: string) {
	return (
		job.MappedAudio && job.MappedAudio[codec] && Object.entries(job.MappedAudio[codec]).length > 0
	);
}

export function formatPair(stream: Stream, includeIndex = false, includeCodec = false): string {
	if (stream) {
		const mappedLanguage = languageMap[stream.Language];
		let lang = mappedLanguage || getCueForgeLanguageName(stream.Language) || stream.Language;
		if (includeIndex && includeCodec && mappedLanguage) {
			lang = lang.split('-')[0];
		}
		const extension = stream.Location.split('.').pop();
		return (
			(includeIndex ? `${stream.Index}-` : '') +
			lang +
			(includeCodec ? ` (${extension})` : '') +
			(stream.Title && stream.Title !== lang ? ` - ${stream.Title}` : '')
		);
	}
	return '';
}

export function formatSubtitlePair(stream: Stream, includeIndex = false, includeCodec = false) {
	return getCueForgeSubtitleDisplayName(stream) || formatPair(stream, includeIndex, includeCodec);
}

export function getSubtitleSortName(stream: Stream) {
	return getCueForgeSubtitleDisplayName(stream) || formatPair(stream, false, false);
}

export const languageMap: { [key: string]: string } = {
	eng: 'English-English',
	ara: 'Arabic-العربية',
	ger: 'German-Deutsch',
	spa: 'Spanish-Español',
	fre: 'French-Français',
	ita: 'Italian-Italiano',
	por: 'Portuguese-Português',
	rus: 'Russian-Русский',
	chi: 'Chinese-中文',
	jpn: 'Japanese-日本語',
	kor: 'Korean-한국어',
	hin: 'Hindi-हिन्दी',
	urd: 'Urdu-اردو',
	tur: 'Turkish-Türkçe',
	vie: 'Vietnamese-Tiếng Việt',
	tha: 'Thai-ไทย',
	dut: 'Dutch-Nederlands',
	swe: 'Swedish-Svenska',
	dan: 'Danish-Dansk',
	nor: 'Norwegian-Norsk',
	ind: 'Indonesian-Bahasa Indonesia',
	baq: 'Basque-Euskara',
	cat: 'Catalan-Català',
	hrv: 'Croatian-Hrvatski',
	cze: 'Czech-Čeština',
	fin: 'Finnish-Suomi',
	glg: 'Galician-Galego',
	gre: 'Greek-Ελληνικά',
	heb: 'Hebrew-עברית',
	hun: 'Hungarian-Magyar',
	may: 'Malay-Bahasa Melayu',
	nob: 'Norwegian Bokmål-Norsk Bokmål',
	pol: 'Polish-Polski',
	rum: 'Romanian-Română',
	ukr: 'Ukrainian-Українська',
	fil: 'Filipino-Filipino'
};

export const languageSrcMap: { [key: string]: string } = {
	eng: 'en-US',
	ara: 'ar-SA',
	ger: 'de-DE',
	spa: 'es-ES',
	fre: 'fr-FR',
	ita: 'it-IT',
	por: 'pt-PT',
	rus: 'ru-RU',
	chi: 'zh-CN',
	jpn: 'ja-JP',
	kor: 'ko-KR',
	hin: 'hi-IN',
	urd: 'ur-PK',
	tur: 'tr-TR',
	vie: 'vi-VN',
	tha: 'th-TH',
	dut: 'nl-NL',
	swe: 'sv-SE',
	dan: 'da-DK',
	nor: 'no-NO',
	baq: 'eu-ES',
	cat: 'ca-ES',
	hrv: 'hr-HR',
	cze: 'cs-CZ',
	fin: 'fi-FI',
	glg: 'gl-ES',
	gre: 'el-GR',
	heb: 'he-IL',
	hun: 'hu-HU',
	may: 'ms-MY',
	nob: 'nb-NO',
	pol: 'pl-PL',
	rum: 'ro-RO',
	ukr: 'uk-UA',
	fil: 'fil-PH'
};

export const defaultFallback: string[] = ['Noto Sans SC Thin', 'NotoSansSC-VariableFont_wght.ttf'];

export const fallbackFontsMap: { [key: string]: string[] } = {
	'zh-CN': ['Noto Sans SC Thin', 'NotoSansSC-VariableFont_wght.ttf'],
	'ja-JP': ['Noto Sans JP Thin', 'NotoSansJP-VariableFont_wght.ttf'],
	'ko-KR': ['NanumGothicCoding', 'NanumGothicCoding-Regular.ttf']
};

export function formatSeconds(seconds: number | undefined): string {
	if (seconds === undefined) {
		return '00:00';
	}
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);

	const secondsStr = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds;
	const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
	const hoursStr = hours < 10 ? `0${hours}` : hours;

	if (hours === 0) {
		return `${minutesStr}:${secondsStr}`;
	}
	return `${hoursStr}:${minutesStr}:${secondsStr}`;
}

export function randomString(length: number): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	let result = '';
	for (let i = length; i > 0; --i) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

export function secondsSince(date: Date): number {
	return Math.floor((new Date().getTime() - date.getTime()) / 1000);
}

export function setGetLS(key: string, value: string, onNotExist = (_v: string) => {}): string {
	if (typeof window === 'undefined') {
		return value;
	}
	const v = localStorage.getItem(key);
	if (v) {
		return v;
	}
	onNotExist(value);
	localStorage.setItem(key, value);
	return value;
}

export function setGetLsBoolean(key: string, value: boolean): boolean {
	if (typeof window === 'undefined') {
		return value;
	}
	const v = localStorage.getItem(key);
	if (v) {
		return v === 'true';
	}
	localStorage.setItem(key, value.toString());
	return value;
}

export function setGetLsNumber(key: string, value: number): number {
	if (typeof window === 'undefined') {
		return value;
	}
	const v = localStorage.getItem(key);
	if (v !== null) {
		const parsed = parseFloat(v);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	localStorage.setItem(key, value.toString());
	return value;
}

export function getMbps(job: Job | undefined | null, codec: string): number {
	if (!job?.Files?.[`${codec}.mp4`] || !job?.Duration) {
		return 0;
	}
	return job.Files[`${codec}.mp4`] / 1024 / 1024 / job.Duration / 0.125;
}

export function formatMbps(job: Job | undefined | null, codec: string): string {
	let suffix = '';
	if (job?.MappedAudio[codec]?.[0]) {
		suffix = `-${job.MappedAudio[codec][0].Index}-${job.MappedAudio[codec][0].Language}`;
	}
	const mbps = getMbps(job, `${codec}${suffix}`);
	if (mbps === 0) {
		return '';
	}
	return `: ${mbps.toFixed(2)} Mbps`;
}

export const profiles = [
	'Bluray-2160p Remux',
	'Bluray-2160p',
	'WEBDL-2160p',
	'WEBRip-2160p',
	'Remux-2160p',
	'HDTV-2160p',
	'Bluray-1080p Remux',
	'Bluray-1080p',
	'WEBDL-1080p',
	'WEBRip-1080p',
	'Remux-1080p',
	'HDTV-1080p',
	'Bluray-720p Remux',
	'Bluray-720p',
	'WEBDL-720p',
	'WEBRip-720p',
	'Remux-720p',
	'HDTV-720p',
	'Bluray-576p Remux',
	'Bluray-576p',
	'WEBDL-576p',
	'WEBRip-576p',
	'Remux-576p',
	'HDTV-576p',
	'Bluray-480p Remux',
	'Bluray-480p',
	'WEBDL-480p',
	'WEBRip-480p',
	'Remux-480p',
	'HDTV-480p',
	'Raw-HD',
	'BR-DISK',
	'DVD',
	'DVD-R',
	'DVDSCR',
	'REGIONAL',
	'TELECINE',
	'TELESYNC',
	'CAM',
	'WORKPRINT',
	'SDTV',
	'Unknown'
];

const replaceKeywordsAtEnd = (str: string, replacement: string) => {
	const pattern = new RegExp(`(${profiles.join('|')}).*$`, 'i');
	let replacedWord = null as string | null;
	const result = str.replace(pattern, (match) => {
		replacedWord = match;
		return replacement;
	});
	return { result, replacedWord };
};

export function preprocessJob(job: Job) {
	const i = job.Input.replace(/\.[^/.]+$/, '');
	const ks = replaceKeywordsAtEnd(i, '');
	job.Input = ks.result;
	job.ExtractedQuality = `${ks.replacedWord || ''}`;
	if (job.EncodedCodecs) {
		job.EncodedCodecs.sort((a, b) => {
			return codecsPriority.indexOf(a) - codecsPriority.indexOf(b);
		});
		for (const codec of [...job.EncodedCodecs]) {
			if (!supportedCodecs.includes(codec)) {
				job.EncodedCodecs.splice(job.EncodedCodecs.indexOf(codec), 1);
			}
		}
	}
	if (!job.Streams) {
		job.Streams = [];
		console.error('No streams found for job', job.Id, job.Input);
	}
	for (const stream of job.Streams) {
		stream.Language = stream.Language ?? '';
		stream.Location = stream.Location ?? '';
		stream.Title = stream.Title ?? '';
		stream.CodecType = stream.CodecType ?? '';
	}
	const existingSubtitles = job.Streams.filter((stream) => stream.CodecType === 'subtitle').map(
		(stream) => stream.Location
	);
	let largestIndex = job.Streams.reduce((acc, stream) => Math.max(acc, stream.Index), 0);
	for (const file in job.Files) {
		if (!existingSubtitles.includes(file) && !file.includes('storyboard')) {
			if (
				file.endsWith('.ass') ||
				file.endsWith('.vtt') ||
				file.endsWith('.srt') ||
				file.endsWith('.sup')
			) {
				largestIndex += 1;
				job.Streams.push({
					Index: largestIndex,
					CodecType: 'subtitle',
					Location: file,
					Title: 'External - ' + file.split('.')[0],
					Language: file.split('.')[0]
				});
			}
		}
	}
	job.Title = extractTitle(job);
	return job;
}

export function preprocessJobs(jobs: Job[]) {
	const filtered = jobs.filter((job) => job.State === 'complete');
	return filtered.map(preprocessJob).sort((a, b) => a.Input.localeCompare(b.Input));
}

export function preprocessLibraryJobs(jobs: LibraryJob[]) {
	const filtered = jobs.filter((job) => !job.State || job.State === 'complete');
	return filtered
		.map((job) => {
			const i = job.Input.replace(/\.[^/.]+$/, '');
			const ks = replaceKeywordsAtEnd(i, '');
			job.Input = ks.result;
			job.ExtractedQuality = `${ks.replacedWord || ''}`;
			if (job.EncodedCodecs) {
				job.EncodedCodecs.sort((a, b) => codecsPriority.indexOf(a) - codecsPriority.indexOf(b));
				for (const codec of [...job.EncodedCodecs]) {
					if (!supportedCodecs.includes(codec)) {
						job.EncodedCodecs.splice(job.EncodedCodecs.indexOf(codec), 1);
					}
				}
			}
			job.Files = job.Files ?? {};
			job.Title = extractTitle(job as Job);
			return job;
		})
		.sort((a, b) => a.Input.localeCompare(b.Input));
}

export interface Title {
	titleId: string;
	title: string;
	id: string;
	episode?: TitleEpisode;
	modTime: number;
}

export interface TitleEpisode {
	title: string;
	id: string;
	se: string;
	season: number;
	episode: number;
}

export interface Show extends Title {
	rep?: TitleEpisode;
	episodes?: TitleEpisode[];
}

export interface Titles {
	[key: string]: Show;
}

export function extractTitle(job: Job): Title {
	let title = job.Input;
	const parts = title.split(' - ');
	let se: string | null = null;
	let seTitle: string | null = null;
	let season = 0;
	let episode = 0;
	for (let i = 0; i < parts.length; i++) {
		const match = parts[i].match(/S(\d{2})E(\d{2})/i);
		if (match) {
			se = parts[i];
			seTitle = parts.slice(i + 1).join(' - ');
			title = parts.slice(0, i).join(' - ');
			season = parseInt(match[1], 10);
			episode = parseInt(match[2], 10);
			break;
		}
	}
	const titleId = title.toLowerCase().replace(/[^a-z0-9]/gi, '');
	return {
		titleId,
		title,
		id: job.Id,
		modTime: job.JobModTime,
		episode: se && seTitle ? { title: seTitle, id: job.Id, se, season, episode } : undefined
	};
}

export function getTitleComponentsByJobs(jobs: LibraryJob[]): Titles {
	const jobsById = new Map(jobs.map((job) => [job.Id, job]));
	const _titles = jobs.reduce((acc: Titles, job) => {
		if (!acc[job.Title.titleId]) {
			acc[job.Title.titleId] = {
				title: job.Title.title,
				id: job.Title.id,
				titleId: job.Title.titleId,
				modTime: job.Title.modTime
			};
		}
		if (job.Title.episode) {
			if (!acc[job.Title.titleId].episodes) {
				acc[job.Title.titleId].episodes = [];
			}
			acc[job.Title.titleId].episodes?.push(job.Title.episode);
			acc[job.Title.titleId].modTime = Math.max(acc[job.Title.titleId].modTime, job.JobModTime);
		}
		return acc;
	}, {});

	return Object.keys(_titles)
		.sort((a, b) => {
			if (!_titles[a].episodes && _titles[b].episodes) {
				return 1;
			}
			if (_titles[a].episodes && !_titles[b].episodes) {
				return -1;
			}
			return _titles[a].modTime > _titles[b].modTime ? -1 : 1;
		})
		.reduce((acc: Titles, key) => {
			const title = _titles[key];
			if (title.episodes) {
				title.episodes
					.sort((a, b) => (a.season === b.season ? a.episode - b.episode : a.season - b.season))
					.reverse();
				for (let i = 0; i < title.episodes.length; i++) {
					const episode = title.episodes[i];
					const job = jobsById.get(episode.id);
					if (job && job.Files['poster.jpg']) {
						title.rep = episode;
						break;
					}
				}
			}
			acc[key] = title;
			return acc;
		}, {});
}

function isIOS() {
	if (typeof navigator === 'undefined') {
		return false;
	}
	const userAgent = navigator.userAgent.toLowerCase();
	const platform = navigator.platform?.toLowerCase() || '';
	return (
		/iphone|ipad|ipod/.test(userAgent) || (platform === 'macintel' && navigator.maxTouchPoints > 1)
	);
}

export function getSubtitleTypePriority(): readonly SubtitleTypePriorityFormat[] {
	return isIOS() ? subtitleTypePriorityIOS : subtitleTypePriorityNormal;
}

export function getSubtitleStreamType(stream: Pick<Stream, 'Location'>) {
	const cleanLocation = stream.Location.split(/[?#]/)[0].toLowerCase();
	return cleanLocation.split('.').pop() || '';
}

export function getSubtitleTypeRank(stream: Pick<Stream, 'Location'>) {
	const subtitlePriority = getSubtitleTypePriority();
	const index = subtitlePriority.indexOf(
		getSubtitleStreamType(stream) as SubtitleTypePriorityFormat
	);
	return index === -1 ? subtitlePriority.length : index;
}

export function sortTracks(job: Job) {
	const streams = job.Streams;
	const files = job.Files;
	const getLanguageRank = (stream: Stream) => {
		const mappedLanguage = languageSrcMap[stream.Language] || stream.Language;
		const baseLanguage =
			mappedLanguage.split('-')[0]?.toLowerCase() || mappedLanguage.toLowerCase();
		const index = subtitleLanguagePriority.indexOf(baseLanguage);
		return index === -1 ? subtitleLanguagePriority.length : index;
	};
	const compare = (a: Stream, b: Stream) => {
		if (a.CodecType === 'subtitle' && b.CodecType === 'subtitle') {
			const nameCompare = getSubtitleSortName(a).localeCompare(getSubtitleSortName(b), undefined, {
				numeric: true,
				sensitivity: 'base'
			});
			if (nameCompare !== 0) {
				return nameCompare;
			}
		}
		const typeCompare = getSubtitleTypeRank(a) - getSubtitleTypeRank(b);
		if (typeCompare !== 0) {
			return typeCompare;
		}
		const languageCompare = getLanguageRank(a) - getLanguageRank(b);
		if (languageCompare !== 0) {
			return languageCompare;
		}
		if (a.Language === b.Language) {
			return (files[b.Location] ?? 0) - (files[a.Location] ?? 0);
		}
		return a.Language.localeCompare(b.Language);
	};
	streams.sort(compare);
	return streams;
}

export interface ServerData {
	jobs: Job[];
	job: Job;
	video: string;
	preview: string;
	icon: string;
	rating: number;
	title: string;
	displayTitle: string;
	plot: string;
	dominantColor: string;
	oembedJson: string;
	staticBaseUrl: string;
	backendBaseUrl: string;
	roomId: string;
}

export function getRealName(player: Pick<Player, 'name' | 'discordUser'> | ChatAuthor | undefined) {
	const discordName = getName(player?.discordUser);
	return discordName ? discordName : player?.name || 'Unknown';
}

export function getLeftAndJoined(oldPlayers: Player[], newPlayers: Player[], ignoreId: string) {
	const left = oldPlayers.filter(
		(oldPlayer) =>
			oldPlayer.id !== ignoreId && !newPlayers.find((candidate) => candidate.id === oldPlayer.id)
	);
	const joined = newPlayers.filter(
		(player) =>
			player.id !== ignoreId && !oldPlayers.find((candidate) => candidate.id === player.id)
	);
	return { left, joined };
}
