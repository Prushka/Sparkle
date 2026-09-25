// Local playback preference, deliberately independent of room playback state.
export const NORMALIZATION_KEY = 'sparkle.audio.normalize';
export const NORMALIZATION_EVENT = 'sparkle-audio-normalization';
export type NormalizationStatus = {
	state: 'off' | 'loading' | 'active' | 'unavailable';
	channels?: number;
	gainDB?: number;
	frames?: number;
};
const bindings = new Set<AudioNormalization>();
const modules = new WeakMap<BaseAudioContext, Promise<void>>();
const nativeSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let nativeContext: AudioContext | undefined;
let preference: boolean | undefined;

export function readNormalization() {
	if (typeof window === 'undefined') return false;
	if (preference !== undefined) return preference;
	try {
		return localStorage.getItem(NORMALIZATION_KEY) === 'true';
	} catch {
		return false;
	}
}
export function subscribeNormalization(update: () => void) {
	const changed = (event: Event) => {
		if (event instanceof StorageEvent) {
			if (event.key !== NORMALIZATION_KEY && event.key !== null) return;
			preference = undefined;
		}
		update();
	};
	window.addEventListener(NORMALIZATION_EVENT, changed);
	window.addEventListener('storage', changed);
	return () => {
		window.removeEventListener(NORMALIZATION_EVENT, changed);
		window.removeEventListener('storage', changed);
	};
}
export function saveNormalization(enabled: boolean) {
	preference = enabled;
	try {
		localStorage.setItem(NORMALIZATION_KEY, String(enabled));
	} catch {
		/* Memory fallback. */
	}
	// Resume synchronously in the user's gesture, before awaiting worklet modules.
	for (const binding of bindings) binding.resume();
	window.dispatchEvent(new Event(NORMALIZATION_EVENT));
}
async function loadModule(context: BaseAudioContext) {
	let pending = modules.get(context);
	if (!pending) {
		pending = context.audioWorklet
			.addModule('/vendor/libmedia/audio/normalize-v1.js')
			.catch((error) => {
				modules.delete(context);
				throw error;
			});
		modules.set(context, pending);
	}
	await pending;
}

/** Owns just an audio graph. Never pauses, seeks, reloads or changes a media clock. */
export class AudioNormalization {
	private node?: AudioWorkletNode;
	private source?: AudioNode;
	private destination?: AudioNode;
	private element?: HTMLMediaElement;
	private boost?: GainNode;
	private gain = 1;
	private disposed = false;
	private unsubscribe?: () => void;
	private pending?: Promise<void>;
	private status: NormalizationStatus = { state: 'off' };
	constructor(private report: (status: NormalizationStatus) => void = () => {}) {}
	private publish(status: NormalizationStatus) {
		if (!this.disposed) this.report((this.status = status));
	}
	/** PCM hook is before libmedia's user-volume gain, preserving surround channels. */
	async bindPCM(source: AudioNode, destination: AudioNode) {
		this.source = source;
		this.destination = destination;
		source.connect(destination);
		await this.listen();
		return () => this.dispose();
	}
	/** Native audio remains untouched until normalization is first enabled. */
	async bindNative(element: HTMLMediaElement) {
		this.element = element;
		// React can reuse an element after effect cleanup. Its native source is
		// permanent, so restore the direct route even when the preference is off.
		this.source = nativeSources.get(element);
		if (this.source) this.nativeGraph(this.source.context as AudioContext);
		element.addEventListener('volumechange', this.configure);
		element.addEventListener('seeking', this.reset);
		element.addEventListener('emptied', this.reset);
		element.addEventListener('play', this.resume);
		await this.listen();
		return () => this.dispose();
	}
	get currentGain() {
		return this.gain === 1 ? null : this.gain;
	}
	/** Vidstack Boost shares the native source, downstream of the meter. */
	setNativeGain(gain: number) {
		if (this.disposed || !this.element || !Number.isFinite(gain) || gain < 0) return;
		this.gain = gain;
		if (!this.boost && gain === 1) return;
		this.nativeGraph();
		this.boost!.gain.setTargetAtTime(gain, this.boost!.context.currentTime, 0.005);
		this.resume();
	}
	private nativeGraph(
		context = (nativeContext ??= new AudioContext({ latencyHint: 'interactive' }))
	) {
		if (this.boost) return;
		this.source = nativeSources.get(this.element!);
		if (!this.source) {
			this.source = context.createMediaElementSource(this.element!);
			nativeSources.set(this.element!, this.source as MediaElementAudioSourceNode);
		}
		this.boost = context.createGain();
		this.boost.gain.value = this.gain;
		this.boost.connect(context.destination);
		this.destination = this.boost;
		this.source.connect(this.boost);
	}
	private async listen() {
		bindings.add(this);
		this.unsubscribe = subscribeNormalization(() => void this.update());
		await this.update();
	}
	resume = () => {
		const context = this.source?.context ?? (this.element ? nativeContext : undefined);
		if (
			typeof AudioContext !== 'undefined' &&
			context instanceof AudioContext &&
			context.state === 'suspended'
		)
			void context.resume().catch(() => {});
		if (!this.node && readNormalization()) void this.update();
	};
	reset = () => {
		this.node?.port.postMessage({ type: 'reset' });
	};
	private configure = () => {
		this.node?.port.postMessage({
			type: 'configure',
			enabled: readNormalization(),
			volume: this.element ? (this.element.muted ? 0 : this.element.volume) : 1
		});
	};
	private async update() {
		if (this.disposed) return;
		if (!readNormalization()) {
			this.configure();
			this.publish({ ...this.status, state: 'off' });
			return;
		}
		if (this.node) {
			this.configure();
			this.resume();
			return;
		}
		if (this.pending) return this.pending;
		this.publish({ state: 'loading' });
		this.pending = this.install()
			.catch(() => {
				// A denied AudioContext or failed asset must leave ordinary audio usable.
				this.publish({ state: 'unavailable' });
			})
			.finally(() => {
				this.pending = undefined;
			});
		return this.pending;
	}
	private async install() {
		const context =
			this.source?.context ?? (nativeContext ??= new AudioContext({ latencyHint: 'interactive' }));
		if (context instanceof AudioContext && context.state === 'suspended')
			void context.resume().catch(() => {});
		await loadModule(context);
		if (this.disposed || !readNormalization()) return;
		// Do not divert an otherwise playable native element into a context
		// blocked by autoplay policy. A later play gesture retries installation.
		if (context instanceof AudioContext && context.state !== 'running')
			throw new Error('Audio context is not running');
		const node = new AudioWorkletNode(context, 'sparkle-normalize', {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			channelCountMode: 'max',
			channelInterpretation: 'discrete'
		});
		if (this.element) this.nativeGraph(context as AudioContext);
		this.source?.disconnect(this.destination!);
		this.node = node;
		node.port.onmessage = ({ data }) => {
			if (data?.type !== 'status') return;
			this.publish({
				state: !readNormalization() ? 'off' : data.active ? 'active' : 'unavailable',
				channels: data.channels,
				gainDB: data.gainDB,
				frames: data.frames
			});
		};
		node.onprocessorerror = () => {
			this.detach();
			this.publish({ state: 'unavailable' });
		};
		this.configure();
		this.source!.connect(node);
		node.connect(this.destination!);
		this.publish({ state: 'active' });
	}
	private detach() {
		if (!this.node) return;
		this.source?.disconnect(this.node);
		this.node.disconnect();
		this.node.port.postMessage({ type: 'dispose' });
		this.node.port.close();
		this.node = undefined;
		this.source?.connect(this.destination!);
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe?.();
		bindings.delete(this);
		this.element?.removeEventListener('volumechange', this.configure);
		this.element?.removeEventListener('seeking', this.reset);
		this.element?.removeEventListener('emptied', this.reset);
		this.element?.removeEventListener('play', this.resume);
		this.detach();
		// Keep the shared context, but disconnect removed elements. bindNative
		// restores their direct route if React reuses them (including off state).
		this.source?.disconnect(this.destination!);
		this.boost?.disconnect();
	}
}

export function reportNormalization(
	element: HTMLElement | null | undefined,
	status: NormalizationStatus
) {
	if (!element) return;
	for (const [key, value] of Object.entries(status))
		element.dataset[`normalization${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
	element.dispatchEvent(new CustomEvent('sparkle-normalization-status', { detail: status }));
}
