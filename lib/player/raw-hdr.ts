import type { RawTrack, HDROutput, HDRPreference } from './raw-types';

export function sourceHDR(track?: RawTrack) {
	if (!track) return 'Unknown';
	const formats: string[] = [];
	if (track.DOVIPresent) formats.push(`Dolby Vision Profile ${track.DOVIProfile ?? '?'}`);
	if (track.HDR10PlusPresent) formats.push('HDR10+');
	const base = compatibleHDR(track);
	if (base) formats.push(base);
	return formats.join(' / ') || 'SDR';
}

export function compatibleHDR(track?: RawTrack): 'HDR10' | 'HLG' | null {
	if (!track) return null;
	if (track.DOVIPresent) {
		if (track.DOVIProfile === 7) return 'HDR10';
		if (track.DOVIProfile !== 8) return null;
		// Profile 5 is IPT-PQ, not an ordinary HDR10 representation.
		if (track.DOVIBLCompatID === 1 || track.DOVIBLCompatID === 6) return 'HDR10';
		if (track.DOVIBLCompatID === 4) return 'HLG';
		return null;
	}
	if (/2084|pq/i.test(track.colorTrc ?? '') || track.HDR10PlusPresent) return 'HDR10';
	if (/b67|hlg/i.test(track.colorTrc ?? '')) return 'HLG';
	return null;
}

// Runtime admission does not certify the external display's dynamic HDR output.
export const dynamicHDRQualifications: readonly {
	userAgent: string;
	codec: string;
	profile: number;
	output: HDROutput;
	evidence: string;
}[] = [];

export type HDRProbe = (mime: string, mode: 'HDR10' | 'HLG' | 'HDR10+') => Promise<boolean>;
export interface HDRPlan {
	renderer: 'native' | 'software';
	output: HDROutput;
	mime: string;
	baseOnly: boolean;
	reason?: string;
}

export function dolbyVisionMime(mime: string, track: RawTrack, configuration?: Uint8Array) {
	if (!configuration || configuration.length < 5 || ![5, 8].includes(track.DOVIProfile ?? 0))
		return null;
	// Dual-layer composition must not be mistaken for a base-layer decode.
	if (track.DOVIELPresent || configuration[3] & 2) return null;
	const level = track.DOVILevel;
	if (!level || level > 13 || !/codecs="(?:hvc1|hev1)\./.test(mime)) return null;
	const tag = mime.includes('hev1.') ? 'dvhe' : 'dvh1';
	return `video/mp4; codecs="${tag}.${String(track.DOVIProfile).padStart(2, '0')}.${String(level).padStart(2, '0')}"`;
}

export async function planHDR(
	track: RawTrack,
	mime: string,
	configuration: Uint8Array | undefined,
	preference: HDRPreference,
	hdrDisplay: boolean,
	probe: HDRProbe
): Promise<HDRPlan> {
	const base = compatibleHDR(track);
	const dynamic = track.DOVIPresent || track.HDR10PlusPresent;
	if (preference === 'auto') {
		const dolby = dolbyVisionMime(mime, track, configuration);
		if (dolby && (await probe(dolby, base || 'HDR10')))
			return {
				renderer: 'native',
				mime: dolby,
				baseOnly: false,
				output: hdrDisplay ? 'Native dynamic HDR (unverified)' : 'SDR tone mapping',
				reason: `Native Dolby Vision Profile ${track.DOVIProfile} decoding is reported by this browser. ${hdrDisplay ? 'Dynamic HDR output to this display has not been physically qualified.' : 'The browser manages conversion to the SDR display.'}`
			};
		if (track.HDR10PlusPresent && base === 'HDR10' && (await probe(mime, 'HDR10+')))
			return {
				renderer: 'native',
				mime,
				baseOnly: !!track.DOVIPresent,
				output: hdrDisplay ? 'Native dynamic HDR (unverified)' : 'SDR tone mapping',
				reason:
					'Native HDR10+ decoding is reported by this browser. Dynamic HDR display output is unverified.' +
					(track.DOVIProfile === 7 ? ' Dolby Vision enhancement layers are not used.' : '')
			};
	}
	if (!base) {
		// Older MKV muxers may omit the container DV record. The software
		// renderer still requires and validates RPU metadata on every frame.
		if (track.DOVIProfile === 5 && !track.DOVIELPresent)
			return {
				renderer: 'software',
				mime,
				baseOnly: false,
				output: 'SDR tone mapping',
				reason:
					'Client-side Dolby Vision RPU reshaping and SDR tone mapping. No Dolby Vision display signal is produced. High-resolution decoding depends on this device’s CPU.'
			};
		throw new Error(
			`Dolby Vision Profile ${track.DOVIProfile ?? '?'} needs a supported Dolby-aware decoder on this device. Choose a compatible media version.`
		);
	}
	const fallback = dynamic
		? `Using the compatible ${base} representation; ${track.DOVIProfile === 7 ? 'Dolby Vision enhancement layers are not used' : 'dynamic HDR processing is unavailable'}. `
		: '';
	if (preference !== 'sdr' && (await probe(mime, base)))
		return {
			renderer: 'native',
			mime,
			baseOnly: !!track.DOVIPresent,
			output: hdrDisplay ? base : 'SDR tone mapping',
			reason:
				fallback +
				(hdrDisplay
					? 'Native color-managed video output.'
					: 'The browser manages HDR conversion to the SDR display.')
		};
	return {
		renderer: 'software',
		mime,
		baseOnly: !!track.DOVIPresent,
		output: 'SDR tone mapping',
		reason:
			fallback +
			'Client-side 10-bit decoding and color-managed SDR tone mapping. High-resolution playback depends on this device’s CPU.'
	};
}

export async function supportsNativeHDR(
	mime: string,
	mode: 'HDR10' | 'HLG' | 'HDR10+',
	width: number,
	height: number,
	framerate = 24,
	bitrate = 40_000_000
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
				bitrate,
				framerate,
				colorGamut: 'rec2020',
				transferFunction: mode === 'HLG' ? 'hlg' : 'pq',
				...(mode === 'HDR10+' ? { hdrMetadataType: 'smpteSt2094-40' as const } : {})
			}
		});
		return result.supported;
	} catch {
		return false;
	}
}
