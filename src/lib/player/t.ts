

export type PlayerState = {
	paused?: boolean;
	time?: number;
	name: string;
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
