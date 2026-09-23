// Extract static HEVC HDR metadata before writing the MSE initialization segment.
// Chrome's MP4 parser consumes mdcv/clli; leaving these only in SEI is insufficient
// for a complete decoder configuration. Video samples remain byte-for-byte intact.
export type HDRBoxes = { mdcv?: Uint8Array; clli?: Uint8Array };

function readSEI(nal: Uint8Array, boxes: HDRBoxes) {
	if (nal.length < 2) return;
	const type = (nal[0] >> 1) & 63;
	if ((type !== 39 && type !== 40) || nal.length > 65536) return;
	const rbsp = new Uint8Array(nal.length - 2);
	let size = 0;
	for (let i = 2; i < nal.length; i++) {
		if (i >= 4 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
		rbsp[size++] = nal[i];
	}
	for (let p = 0, messages = 0; p + 2 <= size && messages++ < 256;) {
		let type = 0,
			length = 0;
		while (p < size && rbsp[p] === 255) {
			type += 255;
			p++;
		}
		if (p >= size) break;
		type += rbsp[p++];
		while (p < size && rbsp[p] === 255) {
			length += 255;
			p++;
		}
		if (p >= size) break;
		length += rbsp[p++];
		if (p + length > size) break;
		// HEVC mastering primaries are already in G, B, R order and use the
		// same integer units as the ISO BMFF boxes; do not reorder or rescale.
		if (type === 137 && length === 24 && !boxes.mdcv) boxes.mdcv = rbsp.slice(p, p + length);
		if (type === 144 && length === 4 && !boxes.clli) boxes.clli = rbsp.slice(p, p + length);
		p += length;
	}
}

export function hevcHDRBoxes(
	configuration: Uint8Array,
	packet?: Uint8Array,
	annexB = false
): HDRBoxes {
	const boxes: HDRBoxes = {};
	// hvcC can carry prefix SEI arrays even when no container-level HDR tags exist.
	if (configuration.length >= 23 && configuration[0] === 1) {
		let p = 23;
		for (let array = 0; array < configuration[22] && p + 3 <= configuration.length; array++) {
			p++;
			const count = configuration[p++] * 256 + configuration[p++];
			for (let i = 0; i < count && p + 2 <= configuration.length; i++) {
				const length = configuration[p++] * 256 + configuration[p++];
				if (length < 2 || p + length > configuration.length) return boxes;
				readSEI(configuration.subarray(p, p + length), boxes);
				p += length;
			}
		}
	}
	if (!packet) return boxes;
	if (annexB) {
		// Annex B transport streams: inspect only a bounded prefix for header SEI.
		const end = Math.min(packet.length, 1024 * 1024);
		let start = -1;
		for (let i = 2; i < end; i++) {
			if (packet[i] !== 1 || packet[i - 1] !== 0 || packet[i - 2] !== 0) continue;
			if (start >= 0) readSEI(packet.subarray(start, i - 2), boxes);
			start = i + 1;
		}
		if (start >= 0 && end === packet.length) readSEI(packet.subarray(start), boxes);
	} else {
		const width = configuration.length >= 23 ? (configuration[21] & 3) + 1 : 4;
		for (let p = 0, count = 0; p + width + 2 <= packet.length && count++ < 1024;) {
			let length = 0;
			for (let i = 0; i < width; i++) length = length * 256 + packet[p++];
			if (length < 2 || p + length > packet.length) break;
			readSEI(packet.subarray(p, p + length), boxes);
			p += length;
		}
	}
	return boxes;
}
