export const themes = ['nord', 'emerald', 'dark', 'halloween'];
export const defaultTheme = themes[0];

export const codecsPriority = ['av1', 'hevc'];

export enum SyncTypes {
	NewPlayer = 'new player',
	NameSync = 'name',
	TimeSync = 'time',
	PauseSync = 'pause',
	ChatSync = 'chat',
	FullSync = 'full',
	PlayersStatusSync = 'players',
	PfpSync = 'pfp'
}

export interface PlayerPayload {
	type: string;
	time: number;
	name: string;
	paused: boolean;
	chat: string;
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
	EncodedExt: string;
	Subtitles: { [key: number]: Pair<Subtitle> };
	Videos: { [key: number]: Pair<Video> };
	Audios: { [key: number]: Pair<Audio> };
};


export function formatSeconds(seconds: number | undefined): string {
	if (seconds === undefined) {
		return '00:00';
	}
	// convert seconds to minutes and seconds
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	// add leading zero if seconds < 10
	const secondsStr = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds;
	return `${minutes}:${secondsStr}`;
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
