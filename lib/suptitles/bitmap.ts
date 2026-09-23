import type { Palette } from './segments';

/** Decode PGS RLE into a fixed-size bitmap; malformed runs cannot grow memory. */
export function decodeBitmap(data: Uint8Array, palette: Palette[], width: number, height: number) {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0 ||
		width > 8192 ||
		height > 8192 ||
		width * height > 16 * 1024 * 1024
	)
		throw new Error('Invalid subtitle dimensions');
	const rgba = new Uint8ClampedArray(width * height * 4);
	// Blu-ray PGS palettes use limited-range BT.709 YCbCr.
	const colors = palette.map((p) => {
		const y = ((p.Y - 16) * 255) / 219,
			cb = ((p.Cb - 128) * 255) / 224,
			cr = ((p.Cr - 128) * 255) / 224;
		return [y + 1.5748 * cr, y - 0.1873 * cb - 0.4681 * cr, y + 1.8556 * cb, p.Alpha];
	});
	let offset = 0,
		x = 0,
		y = 0;
	const byte = () => {
		if (offset >= data.length) throw new Error('Truncated subtitle run');
		return data[offset++];
	};
	while (offset < data.length) {
		let color = byte(),
			count = 1;
		if (color === 0) {
			const flags = byte();
			if (flags === 0) {
				x = 0;
				if (++y > height) throw new Error('Too many subtitle rows');
				continue;
			}
			count = flags & 0x3f;
			if (flags & 0x40) count = (count << 8) | byte();
			color = flags & 0x80 ? byte() : 0;
		}
		if (y >= height || x + count > width || !colors[color])
			throw new Error('Subtitle run exceeds bitmap');
		for (let end = x + count; x < end; x++) rgba.set(colors[color], (y * width + x) * 4);
	}
	return rgba;
}
