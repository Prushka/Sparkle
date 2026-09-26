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
	base: string;
	fingerprint: string;
	playlist?: 'master.m3u8';
	codec: EncodedCodec;
	output: 'SDR' | 'HDR10' | 'HLG';
	duration: number;
	width: number;
	height: number;
	audio: boolean;
	subtitleTracks: (RawPlaybackTrack & { default?: boolean })[];
	hasFonts: boolean;
	segmentSeconds: number;
}
export function encodedURL(part: EncodedPart, resource: string) {
	return `${part.base}/${resource}?v=${encodeURIComponent(part.fingerprint)}`;
}
export function supportsNativeVideo(contentType: string) {
	const mse =
		globalThis.MediaSource ??
		(globalThis as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
	return mse?.isTypeSupported(contentType) ?? false;
}
export async function encodedCapabilities(
	base: string,
	width: number,
	height: number,
	signal: AbortSignal
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
		return available;
	} catch {
		return [];
	}
}

export async function loadEncodedPart(
	base: string,
	part: RawPart,
	codec: EncodedCodec,
	signal: AbortSignal
): Promise<EncodedPart> {
	const url = `${base}${part.url.replace(/\/file$/, '')}/encoded/${codec}`;
	const response = await backendFetch(`${url}/manifest`, { signal, cache: 'no-store' });
	if (!response.ok)
		throw new Error(
			'Server encoding is unavailable for this media. Choose another encoded mode or select Compatible.'
		);
	const result: EncodedPart = { ...(await response.json()), base: url };
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
