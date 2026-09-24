import type { EncodedCodec, HDRPreference, RawPart } from './raw-types';

const preferenceKey = 'sparkle.raw.hdr';
export function readHDRPreference(): HDRPreference {
	try {
		const value = localStorage.getItem(preferenceKey);
		if (value && ['auto', 'compatible', 'sdr', 'av1', 'hevc'].includes(value))
			return value as HDRPreference;
	} catch {
		/* Storage may be unavailable in embedded/private contexts. */
	}
	return 'auto';
}
export function saveHDRPreference(value: HDRPreference) {
	try {
		localStorage.setItem(preferenceKey, value);
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
	subtitleTracks: { id: number; title: string; default?: boolean }[];
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
		const response = await fetch(`${base}/encoding/capabilities`, { signal });
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

/** A capped range sample, never a whole-file download or a guess from Chromium's
 * privacy-rounded (often 10 Mbps even on LAN) Network Information estimate. */
export async function slowNetwork(
	base: string,
	part: RawPart,
	signal: AbortSignal
): Promise<boolean> {
	const connection = (
		navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }
	).connection;
	if (connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? ''))
		return true;
	const bitrate = (part.size * 8) / part.duration;
	if (!Number.isFinite(bitrate) || bitrate < 2_000_000) return false;
	const timeout = AbortSignal.timeout(4000);
	const sampleSignal = AbortSignal.any([signal, timeout]);
	try {
		const bytes = Math.min(1024 * 1024, part.size);
		const started = performance.now();
		const response = await fetch(`${base}${part.url}`, {
			headers: { Range: `bytes=0-${bytes - 1}` },
			cache: 'no-store',
			signal: sampleSignal
		});
		if (response.status !== 206 || Number(response.headers.get('Content-Length')) > bytes) {
			await response.body?.cancel();
			return false;
		}
		const reader = response.body?.getReader();
		if (!reader) return false;
		let received = 0;
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			received += next.value.byteLength;
			if (received > bytes) {
				await reader.cancel();
				return false;
			}
		}
		const elapsed = performance.now() - started;
		return received === bytes && elapsed > 600 && (received * 8000) / elapsed < bitrate * 1.25;
	} catch {
		return timeout.aborted && !signal.aborted;
	}
}

export async function loadEncodedPart(
	base: string,
	part: RawPart,
	codec: EncodedCodec,
	signal: AbortSignal
): Promise<EncodedPart> {
	const url = `${base}${part.url.replace(/\/file$/, '')}/encoded/${codec}`;
	const response = await fetch(`${url}/manifest`, { signal, cache: 'no-store' });
	if (!response.ok)
		throw new Error(
			'Server encoding is unavailable for this media. Choose Automatic or Compatible.'
		);
	const result: EncodedPart = { ...(await response.json()), base: url };
	const subtitles = part.streams.filter((s) => s.streamType === 3);
	result.subtitleTracks = result.subtitleTracks.map((track, index) => ({
		...track,
		default: subtitles[index]?.default,
		title: subtitles[index]?.displayTitle || track.title
	}));
	return result;
}
