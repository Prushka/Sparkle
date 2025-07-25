import { type DiscordUser, getName } from '../../store';

export const codecsPriority = ['av1', 'hevc', 'h264-10bit', 'h264-8bit'];
export const hideControlsOnChatFocused = 1.5;
export const supportedCodecs = ['av1', 'hevc', 'h264-8bit'];
export const codecMap: { [key: string]: string } = {
	'av1': 'av01.0.01M.08',
	'hevc': 'hvc1.1.6.L93.B0',
	'h264-8bit': 'avc1.42C01E',
	'h264-10bit': 'avc1.6E001F'
};
export const moveSeconds = 5;

export const codecDisplayMap: { [key: string]: string } = {
	'av1': 'AV1',
	'hevc': 'HEVC',
	'h264-8bit': 'H.264',
	'auto': 'Auto'
};

const subtitlePriorityNormal = ['ass', 'vtt', 'sup'];
const subtitlePriorityMobile = ['vtt', 'ass', 'sup'];

export const chatLayouts = ['show', 'hide'];

export function getSupportedCodecs() {
	const supported = [];
	try {
		for (const codec of supportedCodecs) {
			const obj = document.createElement('video');
			const toTest = `video/mp4; codecs="${codecMap[codec]}"`;
			const canPlayType = obj.canPlayType(toTest);
			console.log(codecMap[codec], canPlayType);
			if (canPlayType !== '') {
				supported.push(codec);
			}
		}
	} catch (e) {
		console.log(e);
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
	PfpSync = 'pfp',
	StateSync = 'state',
	BroadcastSync = 'broadcast',
	AudioSwitch = 'audio',
	CodecSwitch = 'codec',
	SubtitleSwitch = 'subtitle',
	ExitSync = 'exit',
	PlayerLeft = 'left',
	PlayerJoined = 'joined'
}

export enum BroadcastTypes {
	MoveTo = 'moveTo'
}

export interface SendPayload {
	type: string;
	time?: number;
	paused: boolean;
	firedBy?: Player;
	chats: Chat[];
	players: Player[];
	timestamp: number;
	broadcast?: BroadcastPayload;
	audio?: string;
	codec?: string;
	subtitle?: string;
	moveToText?: string;
}

export interface BroadcastPayload {
	type: string;
	moveTo?: string;
}

export type Player = {
	paused?: boolean;
	time?: number;
	name: string;
	id: string;
	inBg: boolean;
	audio: string;
	codec: string;
	subtitle: string;
	discordUser: DiscordUser | null | undefined;
}

export type Chat = {
	message: string;
	timestamp: number;
	mediaSec: number;
	uid: string;
	isStateUpdate: boolean;
	timeStr: string;
}

export function getRealName(player: Player | undefined) {
	const discordName = getName(player?.discordUser);
	return discordName ? discordName : (player?.name || "Unknown");
}

export function formatPair(stream: Stream, includeIndex = false, includeCodec = false): string {
	if (stream) {
		let lang = languageMap[stream.Language] || stream.Language;
		if (includeIndex && includeCodec) {
			lang = lang.split('-')[0];
		}
		const extension = stream.Location.split('.').pop();
		return (includeIndex ? stream.Index + '-' : '') + lang + (includeCodec ? ` (${extension})` : '') + ((stream.Title && stream.Title !== lang) ? ` - ${stream.Title}` : '');
	}
	return '';
}

export interface Job {
	Id: string;
	// InputParent: string;
	Input: string;
	State: string;
	// SHA256: string;
	EncodedCodecs: string[];
	MappedAudio: { [key: string]: Stream[] };
	Files: { [key: string]: number };
	Streams: Stream[];
	Duration: number;
	// Width: number;
	// Height: number;
	// EncodedExt: string;
	Chapters: Chapter[];
	DominantColors: string[];
	ExtractedQuality: string;
	JobModTime: number;
	Title: Title;
}

export interface Chapter {
	// id: number;
	// start_time: string;
	// end_time: string;
	start: number;
	end: number;
	// time_base: string;
	tags: { [key: string]: any };
}

export interface Stream {
	// Bitrate: number;
	// CodecName: string;
	CodecType: string;
	Index: number;
	Location: string;
	Language: string;
	Title: string;
	// Filename: string;
	// MimeType: string;
	// Channels: number;
	// SampleRate: number;
}

export function audiosExistForCodec(job: Job, codec: string) {
	return job.MappedAudio && job.MappedAudio[codec] && Object.entries(job.MappedAudio[codec]).length > 0;
}

export const languageMap: { [key: string]: string } = {
	'eng': 'English-English',
	'ara': 'Arabic-العربية',
	'ger': 'German-Deutsch',
	'spa': 'Spanish-Español',
	'fre': 'French-Français',
	'ita': 'Italian-Italiano',
	'por': 'Portuguese-Português',
	'rus': 'Russian-Русский',
	'chi': 'Chinese-中文',
	'jpn': 'Japanese-日本語',
	'kor': 'Korean-한국어',
	'hin': 'Hindi-हिन्दी',
	'urd': 'Urdu-اردو',
	'tur': 'Turkish-Türkçe',
	'vie': 'Vietnamese-Tiếng Việt',
	'tha': 'Thai-ไทย',
	'dut': 'Dutch-Nederlands',
	'swe': 'Swedish-Svenska',
	'dan': 'Danish-Dansk',
	'nor': 'Norwegian-Norsk',
	'ind': 'Indonesian-Bahasa Indonesia',
	'baq': 'Basque-Euskara',
	'cat': 'Catalan-Català',
	'hrv': 'Croatian-Hrvatski',
	'cze': 'Czech-Čeština',
	'fin': 'Finnish-Suomi',
	'glg': 'Galician-Galego',
	'gre': 'Greek-Ελληνικά',
	'heb': 'Hebrew-עברית',
	'hun': 'Hungarian-Magyar',
	'may': 'Malay-Bahasa Melayu',
	'nob': 'Norwegian Bokmål-Norsk Bokmål',
	'pol': 'Polish-Polski',
	'rum': 'Romanian-Română',
	'ukr': 'Ukrainian-Українська',
	'fil': 'Filipino-Filipino'
};

export const languageSrcMap: { [key: string]: string } = {
	'eng': 'en-US',
	'ara': 'ar-SA',
	'ger': 'de-DE',
	'spa': 'es-ES',
	'fre': 'fr-FR',
	'ita': 'it-IT',
	'por': 'pt-PT',
	'rus': 'ru-RU',
	'chi': 'zh-CN',
	'jpn': 'ja-JP',
	'kor': 'ko-KR',
	'hin': 'hi-IN',
	'urd': 'ur-PK',
	'tur': 'tr-TR',
	'vie': 'vi-VN',
	'tha': 'th-TH',
	'dut': 'nl-NL',
	'swe': 'sv-SE',
	'dan': 'da-DK',
	'nor': 'no-NO',
	'baq': 'eu-ES',
	'cat': 'ca-ES',
	'hrv': 'hr-HR',
	'cze': 'cs-CZ',
	'fin': 'fi-FI',
	'glg': 'gl-ES',
	'gre': 'el-GR',
	'heb': 'he-IL',
	'hun': 'hu-HU',
	'may': 'ms-MY',
	'nob': 'nb-NO',
	'pol': 'pl-PL',
	'rum': 'ro-RO',
	'ukr': 'uk-UA',
	'fil': 'fil-PH'
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
	} else {
		return `${hoursStr}:${minutesStr}:${secondsStr}`;
	}
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

export function setGetLS(key: string, value: string, onNotExist=(_v:string)=>{}): string {
	const v = localStorage.getItem(key);
	if (v) {
		return v;
	}
	onNotExist(value);
	localStorage.setItem(key, value);
	return value;
}

export function setGetLsBoolean(key: string, value: boolean): boolean {
	const v = localStorage.getItem(key);
	if (v) {
		return v === 'true';
	}
	localStorage.setItem(key, value.toString());
	return value;
}

export function setGetLsNumber(key: string, value: number): number {
	const v = localStorage.getItem(key);
	if (v) {
		return parseFloat(v);
	}
	localStorage.setItem(key, value.toString());
	return value;
}

export function getMbps(job: Job | undefined | null, codec: string): number {
	if (!job?.Files?.[codec + '.mp4'] || !job?.Duration) {
		return 0;
	}
	return job?.Files[codec + '.mp4'] / 1024 / 1024 / job?.Duration / 0.125;
}

export function formatMbps(job: Job | undefined | null, codec: string): string {
	let suffix = '';
	if (job?.MappedAudio[codec]?.[0]) {
		suffix = `-${job.MappedAudio[codec][0].Index}-${job.MappedAudio[codec][0].Language}`;
	}
	const mbps = getMbps(job, codec+suffix);
	if (mbps === 0) {
		return '';
	}
	return `: ${mbps.toFixed(2)} Mbps`;
}

export const profiles = [
	"Bluray-2160p Remux",
	"Bluray-2160p",
	"WEBDL-2160p",
	"WEBRip-2160p",
	"Remux-2160p",
	"HDTV-2160p",

	"Bluray-1080p Remux",
	"Bluray-1080p",
	"WEBDL-1080p",
	"WEBRip-1080p",
	"Remux-1080p",
	"HDTV-1080p",

	"Bluray-720p Remux",
	"Bluray-720p",
	"WEBDL-720p",
	"WEBRip-720p",
	"Remux-720p",
	"HDTV-720p",

	"Bluray-576p Remux",
	"Bluray-576p",
	"WEBDL-576p",
	"WEBRip-576p",
	"Remux-576p",
	"HDTV-576p",

	"Bluray-480p Remux",
	"Bluray-480p",
	"WEBDL-480p",
	"WEBRip-480p",
	"Remux-480p",
	"HDTV-480p",

	"Raw-HD",
	"BR-DISK",
	"DVD",
	"DVD-R",
	"DVDSCR",
	"REGIONAL",
	"TELECINE",
	"TELESYNC",
	"CAM",
	"WORKPRINT",
	"SDTV",
	"Unknown"
]

const replaceKeywordsAtEnd = (str: string, replacement: string) => {
	const pattern = new RegExp(`(${profiles.join('|')}).*$`, 'i');
	let replacedWord = null;
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
		for (const codec of job.EncodedCodecs) {
			if (!supportedCodecs.includes(codec)) {
				job.EncodedCodecs.splice(job.EncodedCodecs.indexOf(codec), 1);
			}
		}
	}
	if (!job.Streams) {
		job.Streams = []
		console.error("No streams found for job", job.Id, job.Input);
	}
	for (const stream of job.Streams) {
		stream.Language = stream.Language ?? '';
		stream.Location = stream.Location ?? '';
		stream.Title = stream.Title ?? '';
		stream.CodecType = stream.CodecType ?? '';
	}
	const existingSubtitles = job.Streams.filter((s) => s.CodecType === 'subtitle').map((s) => s.Location);
	let largestIndex = job.Streams.reduce((acc, stream) => {
		return Math.max(acc, stream.Index);
	}, 0);
	for (const file in job.Files) {
		if(!existingSubtitles.includes(file) && !file.includes("storyboard")){
			if (file.endsWith('.ass') || file.endsWith('.vtt') || file.endsWith('.srt') || file.endsWith(".sup")) {
				largestIndex++
				job.Streams.push({
					Index: largestIndex,
					CodecType: "subtitle",
					Location: file,
					Title: "External - " + file.split(".")[0],
					Language: file.split(".")[0],
				})
			}
		}
	}
	job.Title = extractTitle(job);
	return job;
}

export function preprocessJobs(jobs: Job[]) {
	const filtered = jobs.filter(j => j.State === "complete")
	return filtered.map(preprocessJob).sort((a, b) => {
		return a.Input.localeCompare(b.Input);
	});
}

export function extractTitle(job: Job): Title {
	let title = job.Input;
	const parts = title.split(' - ');
	let se = null;
	let seTitle = null;
	let season = 0;
	let episode = 0;
	for (let i = 0; i < parts.length; i++) {
		const match = parts[i].match(/S(\d{2})E(\d{2})/i)
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
		titleId, title, id: job.Id,
		modTime: job.JobModTime,
		episode: se && seTitle ? { title: seTitle, id: job.Id, se, season, episode } : undefined
	};
}

export interface Show extends Title {
	rep?: TitleEpisode;
	episodes?: TitleEpisode[]
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

export interface Titles { [key: string]: Show }

export function getTitleComponentsByJobs(jobs: Job[]): Titles {
	const _titles = jobs.reduce((acc: Titles, job) => {
		if (!acc[job.Title.titleId]) {
			acc[job.Title.titleId] = {
				title: job.Title.title,
				id: job.Title.id,
				titleId: job.Title.titleId,
				modTime: job.Title.modTime
			};
		}
		if(job.Title.episode) {
			if (!acc[job.Title.titleId].episodes) {
				acc[job.Title.titleId].episodes = [];
			}
			acc[job.Title.titleId].episodes?.push(job.Title.episode);
			acc[job.Title.titleId].modTime = Math.max(acc[job.Title.titleId].modTime, job.JobModTime);
		}
		return acc;
	}, {});
	// set titles to sorted _titles with same structure, first sort by episodes is null, then by title
	return Object.keys(_titles).sort((a, b) => {
		if (!_titles[a].episodes && _titles[b].episodes) {
			return 1;
		} else if (_titles[a].episodes && !_titles[b].episodes) {
			return -1;
		} else {
			return _titles[a].modTime > _titles[b].modTime ? -1 : 1;
		}
	}).reduce((acc: Titles, key) => {
		const t = _titles[key];
		if (t.episodes) {
			t.episodes.sort(
				(a, b) => a.season === b.season ? (a.episode - b.episode) :
					(a.season - b.season)
			).reverse()
			for (let i = 0; i < t.episodes.length; i++) {
				const episode = t.episodes[i];
				const job = jobs.find((j) => j.Id === episode.id);
				if(job && job.Files["poster.jpg"]) {
					t.rep = episode;
					break;
				}
			}
		}
		acc[key] = t;
		return acc;
	}, {});
}

function isMobile() {
	const userAgent = navigator.userAgent.toLowerCase();
	const mobileKeywords = [/webos/, /iphone/, /ipad/, /ipod/, /blackberry/, /windows phone/];
	return mobileKeywords.some(keyword => userAgent.match(keyword));
	// not including android as it likely runs ass fullscreen
}

export function sortTracks(job: Job) {
	const streams = job.Streams;
	const files = job.Files;
	const subtitlePriority = isMobile() ? subtitlePriorityMobile : subtitlePriorityNormal;
	let aExt, bExt, aMapped, bMapped: string;
	const languagePriority = [navigator.language];
	if (navigator.language !== 'en-US') {
		languagePriority.push('en-US');
	}
	if (navigator.language !== 'zh-CN') {
		languagePriority.push('zh-CN');
	}
	const compare = (a: Stream, b: Stream) => {
		aMapped = languageSrcMap[a.Language];
		bMapped = languageSrcMap[b.Language];
		aExt = a.Location.slice(-3);
		bExt = b.Location.slice(-3);

		const aInPriority = languagePriority.includes(aMapped);
		const bInPriority = languagePriority.includes(bMapped);
		if (aInPriority && !bInPriority) {
			return -1;
		} else if (!aInPriority && bInPriority) {
			return 1;
		} else if (aInPriority && bInPriority) {
			const index = languagePriority.indexOf(aMapped) - languagePriority.indexOf(bMapped);
			if (index !== 0) {
				return index;
			}
			const extCompare = subtitlePriority.indexOf(aExt) - subtitlePriority.indexOf(bExt);
			if (extCompare !== 0) {
				return extCompare;
			} else {
				return files[b.Location] - files[a.Location];
			}
		} else {
			return a.Language.localeCompare(b.Language);
		}
	};
	streams.sort(compare);
	console.log(streams);
	return streams;
}

export interface ServerData {
	jobs: Job[];
	job: Job,
	video: string;
	preview: string;
	icon: string;
	rating: number;
	title: string;
	plot: string;
	dominantColor: string;
	oembedJson: string;
}

export function getLeftAndJoined(old: Player[], n: Player[], ignoreId: string){
	const left = old.filter((o) => o.id !== ignoreId && !n.find((p) => p.id === o.id));
	const joined = n.filter((p) => p.id !== ignoreId && !old.find((o) => o.id === p.id));
	return { left, joined };
}
