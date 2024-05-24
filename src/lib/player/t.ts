export const themes = ['sunset', 'dark', 'nord', 'emerald'];
export const lightThemes = ['nord', 'emerald'];
export const defaultTheme = themes[0];

export const codecsPriority = ['av1', 'hevc', 'h264-10bit', 'h264-8bit'];

export const supportedCodecs = ['av1', 'hevc', 'h264-10bit', 'h264-8bit'];
export const audioTrackFeature = false
export const codecMap: {[key: string]: string} = {
	'av1': 'av01.0.01M.08',
	'hevc': 'hvc1.1.6.L93.B0',
	'h264-8bit': 'avc1.42C01E',
	'h264-10bit': 'avc1.6E001F',
}

export function getSupportedCodecs() {
	const supported = []
	try{
		for (const codec of supportedCodecs) {
			const obj = document.createElement("video");
			const toTest = `video/mp4; codecs="${codecMap[codec]}"`
			const canPlayType = obj.canPlayType(toTest)
			console.log(codecMap[codec], canPlayType);
			if (canPlayType !== "") {
				supported.push(codec);
			}
		}
	}catch (e) {
		console.log(e);
	}
	return supported;
}

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

export function formatPair(stream: Stream, includeIndex = false, includeCodec = false): string {
	if(stream){
		let lang = languageMap[stream.Language] || stream.Language
		if (includeIndex && includeCodec) {
			lang = lang.split("-")[0]
		}
		return (includeIndex ? stream.Index + "-" : "")  + lang + (includeCodec ? ` (${stream.CodecName})` : "");
	}
	return ""
}

export interface Job {
	Id: string;
	InputParent: string;
	Input: string;
	State: string;
	SHA256: string;
	EncodedCodecs: string[];
	MappedAudio: { [key: string]: Stream[] };
	Files: { [key: string]: number };
	Streams: Stream[];
	Duration: number;
	Width: number;
	Height: number;
	EncodedExt: string;
}

export interface Stream {
	Bitrate: number;
	CodecName: string;
	CodecType: string;
	Index: number;
	Location: string;
	Language: string;
	Title: string;
	Filename: string;
	MimeType: string;
	Channels: number;
	SampleRate: number;
}

export function audiosExistForCodec(job :Job | undefined, codec: string){
	return job && job.MappedAudio && job.MappedAudio[codec] && Object.entries(job.MappedAudio[codec]).length > 0
}

export function getAudioLocForCodec(job :Job | undefined, codec: string, language: string = "") : string {
	if(audiosExistForCodec(job, codec)) {
		const audioMapping = Object.values(job!.MappedAudio[codec]).find((am) => am.Language === language);
		if (audioMapping) {
			return `${codec}-${audioMapping.Index}-${audioMapping.Language}`;
		}
	}
	return codec;
}

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
	"nor": "Norwegian-Norsk",
	"ind": "Indonesian-Bahasa Indonesia",
};

export const languageSrcMap: {[key: string]:string} = {
	"eng": "en-US",
	"ara": "ar-SA",
	"ger": "de-DE",
	"spa": "es-ES",
	"fre": "fr-FR",
	"ita": "it-IT",
	"por": "pt-PT",
	"rus": "ru-RU",
	"chi": "zh-CN",
	"jpn": "ja-JP",
	"kor": "ko-KR",
	"hin": "hi-IN",
	"urd": "ur-PK",
	"tur": "tr-TR",
	"vie": "vi-VN",
	"tha": "th-TH",
	"dut": "nl-NL",
	"swe": "sv-SE",
	"dan": "da-DK",
	"nor": "no-NO"
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
	const id = randomString(18);
	localStorage.setItem('id', id);
	return id;
}

export function getMbps(job: Job | undefined | null, codec: string): number {
	if (!job?.Files?.[codec + ".mp4"] || !job?.Duration) {
		return 0;
	}
	return job?.Files[codec + ".mp4"] / 1024 / 1024 / job?.Duration / 0.125
}

export function formatMbps(job: Job | undefined | null, codec: string): string {
	const mbps = getMbps(job, codec);
	if (mbps === 0) {
		return '';
	}
	return `: ${mbps.toFixed(2)} Mbps`;
}
