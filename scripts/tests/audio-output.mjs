import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
	entryPoints: ['scripts/libmedia/audio-output.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const { acquireSpeakerOutput } = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
function context(max, rejected = [], previous = Math.min(max || 2, 2)) {
	let channels = previous;
	return {
		destination: {
			maxChannelCount: max,
			get channelCount() {
				return channels;
			},
			set channelCount(value) {
				if (value > max || rejected.includes(value)) throw new Error('unsupported');
				channels = value;
			}
		}
	};
}
for (const [max, expected] of [
	[1, 1],
	[2, 2],
	[3, 2],
	[4, 4],
	[5, 4],
	[6, 6],
	[7, 6],
	[8, 8],
	[9, 8],
	[16, 8],
	[32, 8],
	[0, 2]
]) {
	const ctx = context(max),
		first = acquireSpeakerOutput(ctx),
		second = acquireSpeakerOutput(ctx);
	assert.equal(first.channels, expected);
	assert.equal(ctx.destination.channelCount, expected);
	first.release();
	first.release();
	assert.equal(
		ctx.destination.channelCount,
		expected,
		'one player cannot release another player’s output'
	);
	second.release();
	assert.equal(
		ctx.destination.channelCount,
		Math.min(max || 2, 2),
		'last player restores the preexisting output'
	);
}
const ctx = context(8, [8, 6]);
const output = acquireSpeakerOutput(ctx);
assert.equal(output.channels, 4, 'driver rejection falls back to an accepted speaker layout');
output.release();
ctx.destination.maxChannelCount = 2;
const replacement = acquireSpeakerOutput(ctx);
assert.equal(replacement.channels, 2, 'a new binding observes the replacement device');
replacement.release();
const surround = context(8, [], 6);
const surroundOutput = acquireSpeakerOutput(surround);
assert.equal(surroundOutput.channels, 8);
surroundOutput.release();
assert.equal(
	surround.destination.channelCount,
	6,
	'restoration preserves an existing surround bus'
);
console.log('Speaker output negotiation, shared ownership, fallback and restoration passed');
