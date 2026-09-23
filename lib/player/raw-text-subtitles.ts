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
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
