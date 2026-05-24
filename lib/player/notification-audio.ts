export function createNotificationAudioUrl() {
	const sampleRate = 44100;
	const durationSeconds = 0.14;
	const frequency = 784;
	const sampleCount = Math.floor(sampleRate * durationSeconds);
	const bytes = new Uint8Array(44 + sampleCount * 2);
	const view = new DataView(bytes.buffer);

	const writeString = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) {
			bytes[offset + i] = value.charCodeAt(i);
		}
	};

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + sampleCount * 2, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeString(36, 'data');
	view.setUint32(40, sampleCount * 2, true);

	for (let i = 0; i < sampleCount; i++) {
		const progress = i / sampleCount;
		const envelope = Math.sin(Math.PI * Math.min(progress * 2, (1 - progress) * 2));
		const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * envelope * 0.24;
		view.setInt16(44 + i * 2, sample * 0x7fff, true);
	}

	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return `data:audio/wav;base64,${btoa(binary)}`;
}
