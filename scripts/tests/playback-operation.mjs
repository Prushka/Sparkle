import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
	entryPoints: ['lib/player/playback-operation.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { playbackOperation, recoverableEngine } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const cancel = new AbortController();
let finish;
const engine = {
	seek() {
		return new Promise((resolve) => {
			finish = resolve;
		});
	},
	destroy() {
		return Promise.resolve('destroyed');
	},
	time: 12,
	get currentTime() {
		return this.time;
	}
};
const protectedEngine = recoverableEngine(engine, cancel.signal);
const pending = protectedEngine.seek();
cancel.abort();
await assert.rejects(pending, { name: 'AbortError' });
finish(); // A late worker reply must not revive a cancelled command.
await assert.rejects(protectedEngine.seek(), { name: 'AbortError' });
assert.equal(protectedEngine.currentTime, 12);
assert.equal(
	await protectedEngine.destroy(),
	'destroyed',
	'teardown remains callable after cancellation'
);
await assert.rejects(
	playbackOperation(new Promise(() => {}), new AbortController().signal, 10),
	/stopped responding/
);
assert.equal(await playbackOperation(Promise.resolve(7), new AbortController().signal, 100), 7);
const rejected = Promise.reject(new Error('late failure'));
await assert.rejects(playbackOperation(rejected, cancel.signal), { name: 'AbortError' });
console.log('Playback operation cancellation and deadline checks passed');
