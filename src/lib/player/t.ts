export const themes = ['sunset', 'dark', 'nord', 'emerald'];
export const defaultTheme = themes[0];

export const codecsPriority = ['av1', 'hevc', 'h264'];

export enum SyncTypes {
	NewPlayer = 'new player',
	NameSync = 'name',
	TimeSync = 'time',
	PauseSync = 'pause',
	ChatSync = 'chat',
	FullSync = 'full',
	PlayersStatusSync = 'players',
	PfpSync = 'pfp',
	StateSync = 'state'
}

export interface SendPayload {
	type: string;
	time?: number;
	paused: boolean;
	firedBy?: Player;
	chats: Chat[];
	players: Player[];
	timestamp: number;
}

export type Player = {
	paused?: boolean;
	time?: number;
	name: string;
	id: string;
	inBg: boolean;
}

export type Chat = {
	username: string;
	message: string;
	timestamp: number;
	mediaSec: number;
	uid: string;
	isStateUpdate: boolean;
}

export type Jobs = Job[]

type Pair<T> = {
	Raw: T | null;
	Enc: T | null;
};

type Stream = {
	Bitrate: number;
	CodecName: string;
	Index: number;
	Location: string;
};

interface Subtitle extends Stream {
	Language: string;
}

interface Video extends Stream {
	Width: number;
	Height: number;
	Framerate: string;
}

interface Audio extends Stream {
	Channels: number;
	SampleRate: number;
}

export type Job = {
	Id: string;
	FileRawPath: string;
	FileRawFolder: string;
	FileRawName: string;
	FileRawExt: string;
	Input: string;
	OutputPath: string;
	State: string;
	SHA256: string;
	EncodedCodecs: string[];
	EncodedCodecsSize: { [key: string]: number };
	EncodedExt: string;
	Subtitles: { [key: number]: Pair<Subtitle> };
	Videos: { [key: number]: Pair<Video> };
	Audios: { [key: number]: Pair<Audio> };
	Width: number;
	Height: number;
	Duration: number;
};

export const languageMap: {[key: string]:string} = {
	"eng": "English-English",
	"ara": "Arabic-العربية",
	"ger": "German-Deutsch",
	"spa": "Spanish-Español",
	"fre": "French-Français",
	"ita": "Italian-Italiano",
	"por": "Portuguese-Português",
	"rus": "Russian-Русский",
	"chi": "Chinese-中文",
	"jpn": "Japanese-日本語",
	"kor": "Korean-한국어",
	"hin": "Hindi-हिन्दी",
	"urd": "Urdu-اردو",
	"tur": "Turkish-Türkçe",
	"vie": "Vietnamese-Tiếng Việt",
	"tha": "Thai-ไทย",
	"dut": "Dutch-Nederlands",
	"swe": "Swedish-Svenska",
	"dan": "Danish-Dansk",
	"nor": "Norwegian-Norsk"
};

export function formatSeconds(seconds: number | undefined): string {
	if (seconds === undefined) {
		return '00:00';
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	const secondsStr = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds;
	const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
	return `${minutesStr}:${secondsStr}`;
}

export function randomString(length: number): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	let result = '';
	for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
	return result;
}

export function secondsSince(date: Date): number {
	return Math.floor((new Date().getTime() - date.getTime()) / 1000);
}

export function setGetPlayerId(): string {
	const lsId = localStorage.getItem('id')
	if (lsId) {
		return lsId;
	}
	const id = randomString(36);
	localStorage.setItem('id', id);
	return id;
}

export function getMbps(job: Job | undefined | null, codec: string): number {
	if (!job?.EncodedCodecsSize[codec] || !job?.Duration) {
		return 0;
	}
	return job?.EncodedCodecsSize[codec] / 1024 / 1024 / job?.Duration / 0.125
}

export function formatMbps(job: Job | undefined | null, codec: string): string {
	const mbps = getMbps(job, codec);
	if (mbps === 0) {
		return '';
	}
	return `: ${mbps.toFixed(2)} Mbps`;
}
