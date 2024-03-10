export const themes = [
	'light',
	'dark',
	'cupcake'
]

export function nextTheme() {
	const html = document.querySelector('html')
	const currentTheme = localStorage.getItem("theme") || 'light'
	const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length]
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
}

export type Jobs = Job[]

export interface Job {
	Id: string
	FileRawPath: string
	FileRawFolder: string
	FileRawName: string
	FileRawExt: string
	Input: string
	OutputPath: string
	State: string
	SHA256: string
	Subtitles: string[]
}

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
