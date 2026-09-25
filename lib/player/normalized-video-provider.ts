import { VideoProviderLoader, type MediaProviderLoader } from '@vidstack/react';
import { AudioNormalization, reportNormalization } from './audio-normalization';

const configured = new WeakSet<MediaProviderLoader>();

/** Configure the selected native loader before it creates/sets up its provider.
 * Built-in loaders precede custom loaders, so an additional MP4 loader cannot override it.
 */
export function normalizeVideoProvider(loader: MediaProviderLoader | null) {
	if (!(loader instanceof VideoProviderLoader) || loader.name !== 'video' || configured.has(loader))
		return;
	configured.add(loader);
	const load = loader.load.bind(loader);
	loader.load = async (ctx) => {
		const provider = await load(ctx);
		const normalizer = new AudioNormalization((status) =>
			reportNormalization(ctx.player.el, status)
		);
		// Install before provider setup can restore a saved Boost value. An element
		// can have only one MediaElementSource, including after provider teardown.
		const gain = provider.audioGain;
		gain.destroy();
		Object.defineProperty(gain, 'currentGain', { get: () => normalizer.currentGain });
		gain.setGain = (value) => {
			normalizer.setNativeGain(value);
			ctx.notify('audio-gain-change', normalizer.currentGain);
		};
		gain.removeGain = () => gain.setGain(1);
		gain.destroy = () => normalizer.dispose();
		await normalizer.bindNative(provider.video);
		return provider;
	};
}
