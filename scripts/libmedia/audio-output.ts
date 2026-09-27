// Original Plex audio opts into speaker output. The shared decoder context must
// return to its previous configuration when its last original-media user stops.
const outputs = new WeakMap<AudioContext, { channels: number; previous: number; users: number }>();

export function acquireSpeakerOutput(context: AudioContext) {
	let output = outputs.get(context);
	if (!output) {
		const destination = context.destination;
		const previous = destination.channelCount;
		// Use conventional speaker layouts. Never leave an eight-channel bus to
		// Web Audio's implicit stereo conversion, which drops channels 3–8.
		for (const channels of [8, 6, 4, 2, 1]) {
			if (channels > destination.maxChannelCount) continue;
			try {
				destination.channelCount = channels;
				break;
			} catch {
				// A driver can reject a layout despite advertising that capacity.
			}
		}
		output = { channels: destination.channelCount, previous, users: 0 };
		outputs.set(context, output);
	}
	output.users++;
	let released = false;
	return {
		channels: output.channels,
		release() {
			if (released) return;
			released = true;
			if (--output.users) return;
			outputs.delete(context);
			try {
				context.destination.channelCount = output.previous;
			} catch {
				// Teardown can follow a closed context or a removed audio device.
			}
		}
	};
}
