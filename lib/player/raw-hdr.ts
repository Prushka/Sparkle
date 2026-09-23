import type { RawTrack, HDROutput } from './raw-types';

export function sourceHDR(track?: RawTrack) {
	if (!track) return 'Unknown';
	const formats: string[] = [];
	if (track.DOVIPresent) formats.push(`Dolby Vision Profile ${track.DOVIProfile ?? '?'}`);
	if (track.HDR10PlusPresent) formats.push('HDR10+');
	if (/2084|pq/i.test(track.colorTrc ?? '')) formats.push('HDR10');
	if (/b67|hlg/i.test(track.colorTrc ?? '')) formats.push('HLG');
	return formats.join(' / ') || 'SDR';
}

export function compatibleHDR(track?: RawTrack): 'HDR10' | 'HLG' | null {
	if (!track) return null;
	// Profile 5 is not a backwards-compatible HDR10 representation.
	if (track.DOVIPresent && ![7, 8].includes(track.DOVIProfile ?? 0)) return null;
	if (
		track.DOVIPresent &&
		track.DOVIProfile === 8 &&
		![1, 4, 6].includes(track.DOVIBLCompatID ?? 0)
	)
		return null;
	if (/2084|pq/i.test(track.colorTrc ?? '')) return 'HDR10';
	if (/b67|hlg/i.test(track.colorTrc ?? '')) return 'HLG';
	return null;
}

// An empty qualification registry is intentional. Browser codec probes do not
// establish RPU/EL processing or HDR10+ output. Add entries only with recorded
// hardware, OS, exact browser build, codec/profile and reference-signal evidence.
export const dynamicHDRQualifications: readonly {
	userAgent: string;
	codec: string;
	profile: number;
	output: HDROutput;
	evidence: string;
}[] = [];

export async function supportsNativeHDR(
	mime: string,
	mode: 'HDR10' | 'HLG',
	width: number,
	height: number
) {
	const mse =
		globalThis.MediaSource ??
		(globalThis as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
	if (!mse?.isTypeSupported(mime) || !navigator.mediaCapabilities) return false;
	try {
		const result = await navigator.mediaCapabilities.decodingInfo({
			type: 'media-source',
			video: {
				contentType: mime,
				width,
				height,
				bitrate: 40_000_000,
				framerate: 24,
				colorGamut: 'rec2020',
				transferFunction: mode === 'HLG' ? 'hlg' : 'pq'
			}
		});
		return result.supported;
	} catch {
		return false;
	}
}
