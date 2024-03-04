

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
