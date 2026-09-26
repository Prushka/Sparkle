import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
	entryPoints: ['lib/player/raw-fullscreen.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { RawFullscreen } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const changes = [];
let supportUpdates = 0;
const adapter = new RawFullscreen(
	(active) => changes.push(active),
	() => supportUpdates++
);
assert.equal(adapter.supported, false);
await assert.rejects(adapter.enter(), /cannot show raw playback in fullscreen/);

const native = new EventTarget();
native.webkitSupportsFullscreen = false;
let enters = 0,
	exits = 0;
native.webkitEnterFullscreen = () => {
	enters++;
	native.dispatchEvent(new Event('webkitbeginfullscreen'));
};
native.webkitExitFullscreen = () => {
	exits++;
	native.dispatchEvent(new Event('webkitendfullscreen'));
};
adapter.attach(native);
assert.equal(adapter.supported, false, 'wait for native fullscreen capability');
native.webkitSupportsFullscreen = true;
const beforeMetadata = supportUpdates;
native.dispatchEvent(new Event('loadedmetadata'));
assert.equal(supportUpdates, beforeMetadata + 1, 'refresh controls after native metadata arrives');
assert.equal(adapter.supported, true);
const entering = adapter.enter();
assert.equal(enters, 1, 'call native API before losing tap activation');
await entering;
assert.equal(adapter.active, true);
await adapter.enter();
assert.equal(enters, 1, 'ignore duplicate enter requests');
native.dispatchEvent(new Event('webkitendfullscreen'));
assert.equal(adapter.active, false, 'native Done button updates Vidstack');
await adapter.enter();
await adapter.exit();
assert.equal(exits, 1);
assert.deepEqual(changes, [true, false, true, false]);

const presentation = new EventTarget();
presentation.webkitPresentationMode = 'inline';
presentation.webkitSupportsPresentationMode = (mode) => mode === 'fullscreen';
presentation.webkitSetPresentationMode = (mode) => {
	presentation.webkitPresentationMode = mode;
	presentation.dispatchEvent(new Event('webkitpresentationmodechanged'));
};
adapter.attach(presentation);
assert.equal(adapter.supported, true);
await adapter.enter();
assert.equal(presentation.webkitPresentationMode, 'fullscreen');
assert.equal(adapter.active, true);
presentation.webkitSetPresentationMode('picture-in-picture');
assert.equal(adapter.active, false, 'other presentation modes are not fullscreen');
await adapter.enter();
await adapter.exit();
assert.equal(presentation.webkitPresentationMode, 'inline');
await adapter.enter();
adapter.attach(null);
assert.equal(adapter.active, false, 'detach resets fullscreen during media teardown');
assert.equal(adapter.supported, false);
const afterDetach = supportUpdates;
native.dispatchEvent(new Event('webkitbeginfullscreen'));
native.dispatchEvent(new Event('loadedmetadata'));
presentation.dispatchEvent(new Event('webkitpresentationmodechanged'));
assert.equal(adapter.active, false, 'detached videos cannot change the new provider state');
assert.equal(supportUpdates, afterDetach, 'detach removes metadata listeners');
adapter.attach(new EventTarget());
assert.equal(adapter.supported, false, 'unsupported renderers do not advertise fullscreen');

native.webkitEnterFullscreen = () => {
	throw new Error('User activation required');
};
adapter.attach(native);
await assert.rejects(adapter.enter(), /User activation required/);
assert.equal(adapter.active, false, 'failed requests must not report fullscreen');
adapter.attach(null);
console.log(
	'Raw fullscreen: native/presentation APIs, readiness, native exit, rejection and teardown passed'
);
