import { backendFetch } from '@/lib/plex-access';
import type { EncodedCodec, HDRPreference, RawPart, RawPlaybackTrack } from './raw-types';
import { normalizeHDRPreference } from './raw-hdr';

const preferenceKey = 'sparkle.raw.hdr';
export function readHDRPreference(): HDRPreference {
	try {
		const value = localStorage.getItem(preferenceKey);
		if (value && ['auto', 'compatible', 'sdr', 'av1', 'hevc'].includes(value)) {
			const preference = normalizeHDRPreference(value as HDRPreference);
			if (preference !== value) saveHDRPreference(preference);
			return preference;
		}
	} catch {
		/* Storage may be unavailable in embedded/private contexts. */
	}
	return 'auto';
}
export function saveHDRPreference(value: HDRPreference) {
	try {
		localStorage.setItem(preferenceKey, normalizeHDRPreference(value));
	} catch {
		/* Playback still works. */
	}
}

export interface EncodedPart {
	aiHDR?: boolean;
	aiHDRMode?: 'sdr-expansion' | 'hdr-expansion';
	base: string;
	fingerprint: string;
	playlist?: 'master.m3u8';
	codec: EncodedCodec;
	output: 'SDR' | 'HDR10' | 'HLG';
	duration: number;
	width: number;
	height: number;
	audio: boolean;
	/** Largest encoded track width; absent on older servers. */
	audioChannels?: number;
	audioTracks?: {
		sourceChannels: number;
		channels: number;
		layout: string;
		conversion: 'preserved' | 'padded' | 'downmix' | 'unknown';
	}[];
	subtitleTracks: (RawPlaybackTrack & { default?: boolean })[];
	hasFonts: boolean;
	segmentSeconds: number;
	/** Server can serve initialization headers from the requested segment. */
	timestampStart?: boolean;
}
export function encodedAudioDescription(part: EncodedPart | undefined, index: number) {
	const track = part?.audioTracks?.[index];
	if (track?.conversion === 'unknown') return 'Stereo mix (unknown layout)';
	if (track?.conversion === 'downmix') return `${track.layout} mix`;
	return undefined;
}
export function encodedURL(part: EncodedPart, resource: string, startSeconds = 0) {
	const segment =
		part.timestampStart && Number.isFinite(startSeconds) && part.segmentSeconds > 0
			? Math.floor(Math.max(0, Math.min(startSeconds, part.duration - 0.001)) / part.segmentSeconds)
			: 0;
	return `${part.base}/${resource}?v=${encodeURIComponent(part.fingerprint)}${part.aiHDR ? '&aiHDR=1' : ''}${segment > 0 ? `&startSegment=${segment}` : ''}`;
}
export function supportsNativeVideo(contentType: string) {
	const mse =
		globalThis.MediaSource ??
		(globalThis as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
	return mse?.isTypeSupported(contentType) ?? false;
}
export function encodedNativeAudio(part: EncodedPart | undefined) {
	// A generic Opus MIME probe says nothing about multichannel decoding or
	// speaker mapping (in particular on Safari). Use the Compatible PCM path
	// for every track in a surround title, including after local track changes.
	const channels = part?.audioChannels ?? 0;
	return (
		part?.playlist === 'master.m3u8' &&
		(!part.audio ||
			(Number.isInteger(channels) &&
				channels >= 1 &&
				channels <= 2 &&
				supportsNativeVideo('audio/mp4; codecs="opus"')))
	);
}
export async function encodedCapabilities(
	base: string,
	width: number,
	height: number,
	signal: AbortSignal,
	onAIHDR?: (allowed: boolean, codecs: EncodedCodec[]) => void
): Promise<EncodedCodec[]> {
	try {
		const response = await backendFetch(`${base}/encoding/capabilities`, { signal });
		if (!response.ok) return [];
		const data = await response.json();
		const available: EncodedCodec[] = [];
		for (const codec of ['av1', 'hevc'] as const) {
			if (!data.codecs?.includes(codec)) continue;
			const contentType =
				codec === 'av1'
					? 'video/mp4; codecs="av01.0.13M.10"'
					: 'video/mp4; codecs="hvc1.2.4.L153.B0"';
			if (!supportsNativeVideo(contentType)) continue;
			if (navigator.mediaCapabilities) {
				const support = await navigator.mediaCapabilities
					.decodingInfo({
						type: 'media-source',
						video: {
							contentType,
							width: width || 1920,
							height: height || 1080,
							bitrate: 20_000_000,
							framerate: 30
						}
					})
					.catch(() => null);
				if (!support?.supported) continue;
			}
			available.push(codec);
		}
		onAIHDR?.(
			data.aiHDREnabled === true,
			available.filter((codec) => data.aiHDRCodecs?.includes(codec))
		);
		return available;
	} catch {
		return [];
	}
}

export async function loadEncodedPart(
	base: string,
	part: RawPart,
	codec: EncodedCodec,
	signal: AbortSignal,
	aiHDR = false
): Promise<EncodedPart> {
	const url = `${base}${part.url.replace(/\/file$/, '')}/encoded/${codec}`;
	const response = await backendFetch(`${url}/manifest${aiHDR ? '?aiHDR=1' : ''}`, {
		signal,
		cache: 'no-store'
	});
	if (!response.ok)
		throw new Error(
			aiHDR
				? 'AI HDR is unavailable for this media or its color metadata. Turn off AI HDR to resume normal playback.'
				: 'Server encoding is unavailable for this media. Choose another encoded mode or select Compatible.'
		);
	const result: EncodedPart = { ...(await response.json()), base: url };
	if (!!result.aiHDR !== aiHDR || (aiHDR && result.output !== 'HDR10'))
		throw new Error('The server did not return the requested HDR output.');
	const subtitles = part.streams.filter((s) => s.streamType === 3);
	result.subtitleTracks = result.subtitleTracks.map((track, index) => ({
		...track,
		index: subtitles[index]?.index,
		language: subtitles[index]?.languageCode || subtitles[index]?.language,
		codec: subtitles[index]?.codec,
		default: subtitles[index]?.default,
		title: subtitles[index]?.displayTitle || track.title
	}));
	return result;
}
