import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = await build({
	entryPoints: ['lib/player/raw-encoded.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { readHDRPreference, saveHDRPreference, encodedCapabilities } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const preferences = new Map();
globalThis.localStorage = {
	getItem: (key) => preferences.get(key) ?? null,
	setItem: (key, value) => preferences.set(key, value)
};
for (const mode of ['auto', 'compatible', 'av1', 'hevc']) {
	saveHDRPreference(mode);
	assert.equal(readHDRPreference(), mode);
}
preferences.set('sparkle.raw.hdr', 'sdr');
assert.equal(readHDRPreference(), 'compatible');
assert.equal(preferences.get('sparkle.raw.hdr'), 'compatible', 'migrate persisted software mode');
saveHDRPreference('sdr');
assert.equal(preferences.get('sparkle.raw.hdr'), 'compatible', 'reject new software selections');
preferences.set('sparkle.raw.hdr', 'invalid');
assert.equal(readHDRPreference(), 'auto');
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	get() {
		throw new Error('blocked storage');
	}
});
assert.equal(readHDRPreference(), 'auto');
assert.doesNotThrow(() => saveHDRPreference('av1'));

Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: {
		mediaCapabilities: {
			decodingInfo: async ({ video }) => ({ supported: video.contentType.includes('hvc1') })
		}
	}
});
globalThis.MediaSource = { isTypeSupported: () => true };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ codecs: ['av1', 'hevc'] }) });
assert.deepEqual(await encodedCapabilities('', 1920, 1080, new AbortController().signal), ['hevc']);
navigator.mediaCapabilities.decodingInfo = async () => ({ supported: true });
assert.deepEqual(
	await encodedCapabilities('', 1920, 1080, new AbortController().signal),
	['av1', 'hevc'],
	'prefer AV1 when both native codecs are supported'
);
globalThis.MediaSource.isTypeSupported = (mime) => mime.includes('hvc1');
assert.deepEqual(await encodedCapabilities('', 1920, 1080, new AbortController().signal), ['hevc']);
globalThis.MediaSource.isTypeSupported = () => false;
assert.deepEqual(await encodedCapabilities('', 1920, 1080, new AbortController().signal), []);
globalThis.MediaSource.isTypeSupported = () => true;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ codecs: ['hevc'] }) });
assert.deepEqual(
	await encodedCapabilities('', 1920, 1080, new AbortController().signal),
	['hevc'],
	'only select a codec the server can encode'
);
globalThis.fetch = async () => ({ ok: false });
assert.deepEqual(await encodedCapabilities('', 1920, 1080, new AbortController().signal), []);
console.log('Encoded preference, native AV1/HEVC priority, and unavailable codec checks passed.');
