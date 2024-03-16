export const themes = ["autumn", "dark", "cupcake", "valentine", "lofi", "cyberpunk"]
export const defaultTheme = "autumn"

export const codecsPriority = ["av1", "hevc"]
export function nextTheme() {
	const html = document.querySelector('html')
	const currentTheme = localStorage.getItem("theme") || defaultTheme
	const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length]
	console.log('nextTheme', nextTheme)
	html?.setAttribute('data-theme', nextTheme)
	localStorage.setItem('theme', nextTheme)
}

export type PlayerState = {
	paused?: boolean;
	time?: number;
	name: string;
}

export type Message = {
	username: string;
	message: string;
	timestamp: number;
	mediaSec: number;
	uid: string;
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
		return '00:00'
	}
	// convert seconds to minutes and seconds
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = Math.floor(seconds % 60)
	// add leading zero if seconds < 10
	const secondsStr = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds
	return `${minutes}:${secondsStr}`
}

export function randomString(length: number): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
	let result = ''
	for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
	return result
}
