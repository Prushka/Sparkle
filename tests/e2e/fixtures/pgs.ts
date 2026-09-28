/** Small authored PGS display set: one opaque white pixel, positioned by cue number. */
export function pgsPacket(cue: number) {
	const segment = (type: number, bytes: number[]) => [
		type,
		bytes.length >> 8,
		bytes.length & 255,
		...bytes
	];
	return Buffer.from([
		...segment(0x16, [
			0,
			32,
			0,
			2,
			0x10,
			cue >> 8,
			cue & 255,
			0x80,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			0,
			cue % 32,
			0,
			0
		]),
		...segment(0x14, [0, 0, 0, 16, 128, 128, 0, 1, 235, 128, 128, 255]),
		...segment(0x15, [0, 0, 0, 0xc0, 0, 0, 7, 0, 1, 0, 1, 1, 0, 0]),
		...segment(0x80, [])
	]).toString('base64');
}
