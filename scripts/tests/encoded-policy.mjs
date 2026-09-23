import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = await build({
	entryPoints: ['lib/player/raw-encoded.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { readHDRPreference, saveHDRPreference, slowNetwork, encodedCapabilities } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const preferences = new Map();
globalThis.localStorage = {
	getItem: (key) => preferences.get(key) ?? null,
	setItem: (key, value) => preferences.set(key, value)
};
for (const mode of ['auto', 'compatible', 'sdr', 'av1', 'hevc']) {
	saveHDRPreference(mode);
	assert.equal(readHDRPreference(), mode);
}
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
		connection: { effectiveType: '3g' },
		mediaCapabilities: {
			decodingInfo: async ({ video }) => ({ supported: video.contentType.includes('hvc1') })
		}
	}
});
globalThis.MediaSource = { isTypeSupported: () => true };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ codecs: ['av1', 'hevc'] }) });
assert.deepEqual(await encodedCapabilities('', 1920, 1080, new AbortController().signal), ['hevc']);
assert.equal(
	await slowNetwork('', { size: 100000000, duration: 100 }, new AbortController().signal),
	true
);
navigator.connection = { effectiveType: '4g', downlink: 10 };
let cancelled = false;
globalThis.fetch = async () => ({
	status: 200,
	body: {
		cancel: async () => {
			cancelled = true;
		}
	}
});
assert.equal(
	await slowNetwork(
		'',
		{ url: '/file', size: 100000000, duration: 100 },
		new AbortController().signal
	),
	false
);
assert.equal(cancelled, true, 'range-ignoring servers must not cause a whole-file download');
console.log('Encoded preference, native codec selection, and bounded network-probe checks passed.');
