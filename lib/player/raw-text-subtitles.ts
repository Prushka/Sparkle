import type { SubtitleMergeCue } from './text-subtitle-cues';

/** Active and prefetched packets only, on libmedia's part-local video clock. */
export class RawTextCueWindow {
	cues: SubtitleMergeCue[] = [];
	private bytes = 0;
	add(codec: number, data: Uint8Array, pts: number, duration: number, ms: number) {
		this.prune(ms);
		const end = pts + (duration || 5000);
		if (!Number.isFinite(pts) || !Number.isFinite(end) || end <= pts || end <= ms) return;
		const text = decodeRawTextSubtitle(codec, data);
		const bytes = text.length * 2;
		if (!text || bytes > 24 * 1024 * 1024) return;
		// Seeks can replay packets still present in the retained prefetch window.
		if (
			this.cues.some(
				(cue) => cue.startTime === pts / 1000 && cue.endTime === end / 1000 && cue.text === text
			)
		)
			return;
		while (this.cues.length >= 256 || this.bytes + bytes > 24 * 1024 * 1024) {
			this.bytes -= this.cues.shift()!.text.length * 2;
		}
		this.cues.push({ startTime: pts / 1000, endTime: end / 1000, text });
		this.bytes += bytes;
	}
	prune(ms: number) {
		const retained = this.cues.filter((cue) => cue.endTime > ms / 1000);
		if (retained.length === this.cues.length) return false;
		this.cues = retained;
		this.bytes = retained.reduce((sum, cue) => sum + cue.text.length * 2, 0);
		return true;
	}
	clear() {
		this.cues = [];
		this.bytes = 0;
	}
}

/** Decode text only; never expose MP4 tx3g style boxes as caption text. */
export function decodeRawTextSubtitle(codec: number, packet: Uint8Array): string {
	let data = packet;
	if (codec === 0x17005) {
		// AV_CODEC_ID_MOV_TEXT: uint16 length followed by UTF-8/UTF-16.
		if (data.length < 2) return '';
		const size = (data[0] << 8) | data[1];
		if (size > data.length - 2) return '';
		data = data.subarray(2, size + 2);
	}
	const encoding =
		data[0] === 0xfe && data[1] === 0xff
			? 'utf-16be'
			: data[0] === 0xff && data[1] === 0xfe
				? 'utf-16le'
				: 'utf-8';
	return new TextDecoder(encoding)
		.decode(data)
		.replace(/<br\s*\/?\s*>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(
			/&(?:amp|lt|gt|quot|apos|nbsp);/g,
			(value) =>
				({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[
					value
				]!
		)
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.trim();
}
