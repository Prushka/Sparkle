export interface RawTrack {
	id: number;
	index: number;
	streamType: number;
	codec: string;
	language?: string;
	languageCode?: string;
	title?: string;
	displayTitle?: string;
	default?: boolean;
	forced?: boolean;
	channels?: number;
	bitDepth?: number;
	colorPrimaries?: string;
	colorSpace?: string;
	colorRange?: string;
	colorTrc?: string;
	DOVIPresent?: boolean;
	DOVIProfile?: number;
	DOVILevel?: number;
	DOVIBLCompatID?: number;
	DOVIELPresent?: boolean;
	HDR10PlusPresent?: boolean;
}
export interface RawPart {
	id: string;
	url: string;
	size: number;
	duration: number;
	start: number;
	streams: RawTrack[];
}
export interface RawMedia {
	container: string;
	videoCodec: string;
	parts: RawPart[];
	versions: { id: string; label: string }[];
}
export type HDROutput =
	| 'SDR'
	| 'HDR10'
	| 'HLG'
	| 'Dolby Vision'
	| 'HDR10+'
	| 'SDR tone mapping'
	| 'Native dynamic HDR (unverified)'
	| 'unsupported';
export type EncodedCodec = 'av1' | 'hevc';
export type HDRPreference = 'auto' | 'compatible' | 'sdr' | EncodedCodec;
export interface RawPlaybackStatus {
	ready: boolean;
	changing: boolean;
	sourceHDR: string;
	output: HDROutput;
	hdrPreference?: HDRPreference;
	encodedCodec?: EncodedCodec;
	encodedAvailable?: EncodedCodec[];
	bitrate?: { video?: number; audio?: number };
	renderer?: 'native' | 'software';
	reason?: string;
	audioTracks: { id: number; title: string }[];
	subtitleTracks: { id: number; title: string }[];
	audio?: number;
	subtitle?: number;
	subtitleLayers?: number[];
	part: number;
}
