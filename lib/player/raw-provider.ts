import {
	VideoProviderLoader,
	TimeRange,
	type MediaContext,
	type MediaProviderAdapter,
	type MediaProviderLoader,
	type Src
} from '@vidstack/react';
import type { Job } from './t';
import type { RawMedia, RawPlaybackStatus } from './raw-types';
import { compatibleHDR, sourceHDR, supportsNativeHDR } from './raw-hdr';
import { RawSubtitles } from './raw-subtitles';

export const RAW_MEDIA_TYPE = 'video/x-sparkle-raw';
export const RAW_STATUS_EVENT = 'sparkle-raw-status';
type Stream = {
	id: number;
	index: number;
	mediaType: string;
	metadata: Record<string, unknown>;
	disposition: number;
	codecparProxy: {
		codecId: number;
		codecType: number;
		width: number;
		height: number;
		colorTrc: number;
	};
};
interface Engine {
	load(url: string, options: object): Promise<void>;
	play(options?: object): Promise<void>;
	pause(): Promise<void>;
	seek(ms: bigint): Promise<void>;
	destroy(): Promise<void>;
	currentTime: bigint;
	getDuration(): bigint;
	getStreams(): Stream[];
	getEmbeddedFonts(): Uint8Array[];
	getVideoMimeType(): string;
	isMSE(): boolean;
	getSelectedAudioStreamId(): number;
	getSelectedSubtitleStreamId(): number;
	setBaseHDROnly(value: boolean): void;
	setSubtitleLayers(layers: { id: number; sink: RawSubtitles['sink'] }[]): Promise<void>;
	selectAudio(id: number): Promise<void>;
	selectSubtitle(id: number): Promise<void>;
	setSubtitleEnable(value: boolean): void;
	setVolume(value: number): void;
	setPlaybackRate(value: number): void;
	resize(width: number, height: number): void;
	on(event: string, callback: (...args: unknown[]) => void): void;
}
type EngineConstructor = new (options: Record<string, unknown>) => Engine;
let engineImport: Promise<EngineConstructor> | undefined;
function loadEngine() {
	const url = '/vendor/libmedia/1.3.1/avplayer.js';
	return (engineImport ??= import(/* webpackIgnore: true */ url)
		.then((m) => m.default as EngineConstructor)
		.catch((e) => {
			engineImport = undefined;
			throw e;
		}));
}
export class RawProviderLoader implements MediaProviderLoader {
	readonly name = 'sparkle-raw';
	target: HTMLElement | null = null;
	canPlay(src: Src) {
		return src.type === RAW_MEDIA_TYPE;
	}
	mediaType() {
		return 'video' as const;
	}
	async load(ctx: MediaContext) {
		// Obtain an owned Vidstack scope using its public loader API; do not set up
		// the native adapter or attach its HTML media event listeners.
		const native = new VideoProviderLoader();
		native.target = this.target as HTMLVideoElement;
		const adapter = await native.load(ctx);
		return new RawProvider(this.target as HTMLVideoElement, ctx, adapter.scope);
	}
}

export class RawProvider implements MediaProviderAdapter {
	currentSrc: Src | null = null;
	constructor(
		readonly media: HTMLVideoElement,
		private ctx: MediaContext,
		readonly scope: MediaProviderAdapter['scope']
	) {}
	get type() {
		return 'sparkle-raw';
	}
	readonly container = document.createElement('div');
	private audioContainer = document.createElement('div');
	private engine?: Engine;
	private audioEngine?: Engine;
	private subtitles?: RawSubtitles;
	private subtitleLayers: RawSubtitles[] = [];
	private raw?: RawMedia;
	private duration = 0;
	private part = 0;
	private baseURL = '';
	private generation = 0;
	private commands = Promise.resolve();
	private seekSequence = 0;
	private abort = new AbortController();
	private timer?: ReturnType<typeof setInterval>;
	private observer?: ResizeObserver;
	private initialized = false;
	private paused = true;
	private starting = false;
	private volume = 1;
	private muted = false;
	private rate = 1;
	private desiredTime = 0;
	private audioWaiting = false;
	private driftSince = 0;
	private remoteOperations = 0;
	private compatibleMode = false;
	private destroyed = false;
	private driftCorrection = false;
	private buffering = false;
	private lastProgress = performance.now();
	private lastTime = -1;
	status: RawPlaybackStatus = {
		ready: false,
		changing: true,
		sourceHDR: 'Unknown',
		output: 'unsupported',
		audioTracks: [],
		subtitleTracks: [],
		part: 0
	};
	get video() {
		return this.container.querySelector('video') ?? (this.media as HTMLVideoElement);
	}
	get canPublishPlayback() {
		return (
			this.status.ready &&
			this.initialized &&
			!this.buffering &&
			!this.starting &&
			!this.status.changing &&
			!this.destroyed &&
			this.remoteOperations === 0
		);
	}
	get timeline() {
		return (this.raw?.parts[this.part]?.start ?? 0) + Number(this.engine?.currentTime ?? 0n) / 1000;
	}
	setup() {
		this.media.style.display = 'none';
		this.container.className = 'sparkle-raw-surface';
		Object.assign(this.container.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
		this.audioContainer.hidden = true;
		this.media.parentElement?.append(this.container, this.audioContainer);
		this.observer = new ResizeObserver(() =>
			this.engine?.resize(this.container.clientWidth, this.container.clientHeight)
		);
		this.observer.observe(this.container);
		this.notify('provider-setup', this);
		this.timer = setInterval(() => this.tick(), 200);
	}
	private notify = ((...args: Parameters<MediaContext['notify']>) => {
		if (!this.destroyed) this.ctx.notify(...args);
	}) as MediaContext['notify'];
	private publish(values: Partial<RawPlaybackStatus>) {
		if (this.destroyed) return;
		this.status = { ...this.status, ...values };
		this.ctx.player.el?.dispatchEvent(new CustomEvent(RAW_STATUS_EVENT, { detail: this.status }));
	}
	private enqueue(operation: () => Promise<void>) {
		const generation = this.generation;
		const command = this.commands.then(async () => {
			if (!this.destroyed && generation === this.generation) await operation();
		});
		this.commands = command.catch((e) => {
			if (generation === this.generation && !this.destroyed) this.fail(e);
		});
		return command;
	}
	private fail(error: unknown) {
		const message =
			error instanceof Error && !/\[packages|https?:|[A-Z]:[\\/]/.test(error.message)
				? error.message
				: 'This media cannot play on this client. Choose another track or media version.';
		this.publish({ ready: false, changing: false, output: 'unsupported', reason: message });
		this.notify('error', { code: 4, message });
	}
	async loadSource(src: Src) {
		const generation = ++this.generation;
		this.abort.abort();
		this.abort = new AbortController();
		this.currentSrc = src as Src<string>;
		this.compatibleMode = false;
		this.desiredTime = 0;
		this.part = 0;
		this.paused = true;
		this.publish({ ready: false, changing: true, reason: undefined });
		this.notify('load-start');
		const loading = this.commands.then(async () => {
			if (this.destroyed || generation !== this.generation) return;
			await this.releaseEngines();
			try {
				const url = new URL(String(src.src), location.href);
				this.baseURL = url.href.slice(0, url.href.indexOf('/media/'));
				const response = await fetch(url, { signal: this.abort.signal, cache: 'no-store' });
				if (!response.ok) throw new Error('This Plex item is unavailable.');
				const job: Job = await response.json();
				if (generation !== this.generation) return;
				if (!job.Raw?.parts.length) throw new Error('No mapped media parts are available.');
				this.raw = job.Raw;
				this.duration = job.Duration;
				await this.loadPart(0, generation);
			} catch (e) {
				if (generation === this.generation && !this.abort.signal.aborted) this.fail(e);
			}
		});
		this.commands = loading.catch(() => {});
		return loading;
	}
	private async loadPart(index: number, generation: number): Promise<void> {
		await this.releaseEngines();
		if (generation !== this.generation || this.destroyed) return;
		this.part = index;
		this.initialized = false;
		this.buffering = false;
		this.lastTime = -1;
		this.lastProgress = performance.now();
		const part = this.raw!.parts[index],
			video = part.streams.find((s) => s.streamType === 1);
		const hdr = sourceHDR(video),
			dynamic = !!(video?.DOVIPresent || video?.HDR10PlusPresent);
		this.publish({ part: index, sourceHDR: hdr, ready: false, changing: true, reason: undefined });
		if (dynamic && !this.compatibleMode) {
			this.publish({
				changing: false,
				output: 'unsupported',
				reason:
					video?.DOVIProfile === 7
						? 'Dolby Vision Profile 7 enhancement-layer playback is not verified. Full Dolby Vision is unavailable on this client.'
						: 'Full dynamic HDR is not verified for this browser, device, and profile.'
			});
			return;
		}
		const mode = compatibleHDR(video);
		if (hdr !== 'SDR' && hdr !== 'Unknown' && !mode)
			throw new Error(
				'This HDR representation has no verified compatible rendering path. Choose another media version.'
			);
		const Constructor = await loadEngine();
		if (generation !== this.generation || this.destroyed) return;
		this.subtitles = new RawSubtitles(this.container);
		this.engine = new Constructor({
			container: this.container,
			wasmBaseUrl: '/vendor/libmedia/1.3.1',
			enableWorker: true,
			enableHardware: true,
			enableWebCodecs: true,
			enableWebGPU: false,
			enableAudioWorklet: true,
			preLoadTime: 4,
			requireNativeVideo: !!mode,
			subtitleSink: this.subtitles.sink,
			...(mode ? { checkUseMSE: () => true } : {})
		});
		const engine = this.engine!;
		const active = () =>
			generation === this.generation && engine === this.engine && !this.destroyed;
		engine.on('error', () => {
			if (active())
				this.fail(
					new Error(
						'The selected codec or rendering path failed. Choose another track or media version.'
					)
				);
		});
		engine.on('ended', () => {
			if (!active()) return;
			if (this.part + 1 < this.raw!.parts.length) {
				this.publish({ changing: true });
				void this.enqueue(async () => {
					await this.loadPart(this.part + 1, generation);
					if (!this.paused) await this.start();
				}).catch(() => {});
			} else {
				this.paused = true;
				this.notify('end');
			}
		});
		const options = {
			ext: this.raw!.container || 'mkv',
			maxProbeDuration: 3,
			ioLoaderOptions: { retryCount: 2, preload: 4 * 1024 * 1024 }
		};
		await engine.load(`${this.baseURL}${part.url}`, options);
		if (!active()) return;
		engine.setBaseHDROnly(this.compatibleMode);
		const demuxVideo = engine.getStreams().find((s) => s.mediaType.toLowerCase() === 'video');
		if (
			!mode &&
			(demuxVideo?.codecparProxy.colorTrc === 16 ||
				demuxVideo?.codecparProxy.colorTrc === 18 ||
				demuxVideo?.metadata.sparkleDovi)
		) {
			if (!video)
				throw new Error(
					'Video track metadata is missing. Refresh the library metadata before playback.'
				);
			video.colorTrc = demuxVideo.codecparProxy.colorTrc === 18 ? 'arib-std-b67' : 'smpte2084';
			const dovi = demuxVideo.metadata.sparkleDovi as { data?: Uint8Array } | undefined;
			if (dovi?.data) {
				video.DOVIPresent = true;
				video.DOVIProfile = dovi.data[2] >> 1;
				video.DOVIBLCompatID = dovi.data[4] >> 4;
			}
			// No frame has played. Recreate the provider on the native video path
			// using the file's metadata when Plex omitted its HDR characteristics.
			return this.loadPart(index, generation);
		}
		this.subtitles.setFonts(engine.getEmbeddedFonts());
		if (
			mode &&
			!(await supportsNativeHDR(
				engine.getVideoMimeType(),
				mode,
				demuxVideo?.codecparProxy.width || 1920,
				demuxVideo?.codecparProxy.height || 1080
			))
		) {
			throw new Error(
				`${mode} requires a supported native decoder and color-managed video output. Choose a compatible media version.`
			);
		}
		// HDR video stays unchanged through native MSE. The second instance decodes
		// audio client-side, including codecs that would force stock AVPlayer to canvas.
		if (mode && part.streams.some((s) => s.streamType === 2)) {
			this.audioEngine = new Constructor({
				container: this.audioContainer,
				wasmBaseUrl: '/vendor/libmedia/1.3.1',
				enableWorker: true,
				enableHardware: true,
				enableAudioWorklet: true,
				checkUseMSE: () => false,
				preLoadTime: 4
			});
			await this.audioEngine!.load(`${this.baseURL}${part.url}`, options);
		}
		if (!active()) return;
		const list = (type: string) =>
			(type === 'audio' ? (this.audioEngine ?? engine) : engine)
				.getStreams()
				.filter((s) => s.mediaType.toLowerCase() === type)
				.map((s) => ({
					id: s.id,
					title:
						part.streams.find((p) => p.index === s.index)?.displayTitle ||
						String(s.metadata.title || s.metadata.language || `${type} ${s.index + 1}`)
				}));
		this.publish({
			output: mode
				? matchMedia('(dynamic-range: high)').matches
					? mode
					: 'SDR tone mapping'
				: 'SDR',
			reason:
				mode && !matchMedia('(dynamic-range: high)').matches
					? 'Native browser video handles HDR conversion for this SDR display.'
					: undefined,
			audioTracks: list('audio'),
			subtitleTracks: list('subtitle'),
			ready: true,
			changing: false
		});
		this.notify('loaded-metadata');
		this.notify('loaded-data');
		await this.ctx.delegate.ready({
			duration: this.duration,
			seekable: new TimeRange(0, this.duration),
			buffered: new TimeRange()
		});
	}
	private async start() {
		if (!this.engine || !this.status.ready)
			throw new Error(this.status.reason || 'Media is not ready.');
		const engine = this.engine;
		this.lastProgress = performance.now();
		this.buffering = false;
		this.audioWaiting = false;
		this.driftSince = 0;
		await engine.play({ video: true, audio: !this.audioEngine, subtitle: true });
		if (engine !== this.engine || this.destroyed) return;
		await this.audioEngine?.play({ video: false, audio: true, subtitle: false });
		if (!this.initialized) {
			this.initialized = true;
			const audioPreference = localStorage.getItem('sparkle.raw.audio');
			const subtitlePreference = localStorage.getItem('sparkle.raw.subtitle');
			const audio = this.status.audioTracks.find((t) => t.title === audioPreference);
			const subtitle = this.status.subtitleTracks.find((t) => t.title === subtitlePreference);
			if (audio) await (this.audioEngine ?? engine).selectAudio(audio.id);
			if (subtitle) await engine.selectSubtitle(subtitle.id);
			engine.setSubtitleEnable(subtitlePreference !== 'off');
			this.publish({
				audio: (this.audioEngine ?? engine).getSelectedAudioStreamId(),
				subtitle: subtitlePreference === 'off' ? -1 : engine.getSelectedSubtitleStreamId()
			});
			try {
				const names: unknown = JSON.parse(
					localStorage.getItem('sparkle.raw.subtitleLayers') || '[]'
				);
				if (Array.isArray(names)) {
					const ids = names
						.slice(0, 2)
						.map((name) => this.status.subtitleTracks.find((t) => t.title === name)?.id ?? -1);
					if (ids.length) {
						await this.applySubtitleLayers(ids);
						await engine.seek(engine.currentTime);
					}
				}
			} catch {
				/* Invalid local preferences do not prevent playback. */
			}
		}
		this.setVolume(this.volume);
		engine.setPlaybackRate(this.rate);
		this.audioEngine?.setPlaybackRate(this.rate);
	}
	play() {
		return this.enqueue(async () => {
			this.paused = false;
			this.starting = true;
			try {
				await this.start();
			} finally {
				this.starting = false;
			}
			// Vidstack's playing event clears paused. Sending it before play makes
			// Vidstack swallow play, so the room never receives a local resume.
			this.notify('play');
			this.notify('playing');
		});
	}
	pause() {
		return this.enqueue(async () => {
			this.paused = true;
			if (this.initialized) {
				await this.engine?.pause();
				await this.audioEngine?.pause();
			}
			this.notify('pause');
		});
	}
	async applyRoomState(sync: { time?: number; paused?: boolean }) {
		// Keep suppression active for the entire asynchronous decoder operation,
		// including delayed starts and seeks that outlive the UI's usual timeout.
		this.remoteOperations++;
		try {
			if (typeof sync.time === 'number' && Math.abs(this.timeline - sync.time) > 1)
				this.setCurrentTime(sync.time);
			if (sync.paused === true) await this.pause();
			else if (sync.paused === false && this.paused) await this.play();
			await this.commands;
		} finally {
			this.remoteOperations--;
		}
	}
	setCurrentTime(time: number) {
		if (!Number.isFinite(time)) return;
		this.desiredTime = Math.max(0, Math.min(time, this.duration));
		const sequence = ++this.seekSequence;
		void this.enqueue(async () => {
			if (sequence !== this.seekSequence || !this.raw) return;
			const target = this.desiredTime;
			const index = Math.max(
				0,
				this.raw.parts.findLastIndex((p) => p.start <= target)
			);
			this.publish({ changing: true });
			this.notify('seeking', target);
			if (index !== this.part) {
				await this.loadPart(index, this.generation);
				if (!this.paused) await this.start();
			}
			const ms = BigInt(Math.round((target - this.raw.parts[index].start) * 1000));
			await this.engine?.seek(ms);
			await this.audioEngine?.seek(ms);
			if (sequence !== this.seekSequence) return;
			this.publish({ changing: false });
			this.notify('time-change', target);
			this.notify('seeked', target);
		}).catch(() => {});
	}
	setMuted(muted: boolean) {
		this.muted = muted;
		this.setVolume(this.volume);
	}
	setVolume(volume: number) {
		this.volume = volume;
		(this.audioEngine ?? this.engine)?.setVolume(this.muted ? 0 : volume);
		this.notify('volume-change', { volume, muted: this.muted });
	}
	setPlaybackRate(rate: number) {
		this.rate = rate;
		this.engine?.setPlaybackRate(rate);
		this.audioEngine?.setPlaybackRate(rate);
		this.notify('rate-change', rate);
	}
	async selectTrack(kind: 'audio' | 'subtitle', id: number) {
		return this.enqueue(async () => {
			if (!this.engine || !this.initialized) return;
			this.publish({ changing: true });
			const wasPaused = this.paused,
				time = this.timeline;
			await this.engine.pause();
			await this.audioEngine?.pause();
			if (kind === 'audio') await (this.audioEngine ?? this.engine).selectAudio(id);
			else {
				await this.applySubtitleLayers([]);
				this.engine.setSubtitleEnable(id >= 0);
				if (id >= 0) await this.engine.selectSubtitle(id);
			}
			const ms = BigInt(Math.round((time - this.raw!.parts[this.part].start) * 1000));
			await this.engine.seek(ms);
			await this.audioEngine?.seek(ms);
			if (!wasPaused) await this.start();
			const title = (kind === 'audio' ? this.status.audioTracks : this.status.subtitleTracks).find(
				(t) => t.id === id
			)?.title;
			localStorage.setItem(`sparkle.raw.${kind}`, id < 0 ? 'off' : (title ?? ''));
			this.publish({ [kind]: id, changing: false });
		});
	}
	private async applySubtitleLayers(ids: number[]) {
		if (!this.engine) return;
		await this.engine.setSubtitleLayers([]);
		this.subtitleLayers.forEach((layer) => layer.destroy());
		this.subtitleLayers = [];
		const selected = ids
			.slice(0, 2)
			.map((id, index) =>
				id !== this.engine!.getSelectedSubtitleStreamId() &&
				this.status.subtitleTracks.some((t) => t.id === id) &&
				ids.indexOf(id) === index
					? id
					: -1
			);
		const layers = selected.flatMap((id, index) => {
			if (id < 0) return [];
			const renderer = new RawSubtitles(this.container, index + 1);
			renderer.setFonts(this.engine!.getEmbeddedFonts());
			this.subtitleLayers.push(renderer);
			return [{ id, sink: renderer.sink }];
		});
		await this.engine.setSubtitleLayers(layers);
		this.publish({ subtitleLayers: selected });
	}
	selectSubtitleLayers(ids: number[]) {
		return this.enqueue(async () => {
			if (!this.engine || !this.initialized) return;
			const time = this.engine.currentTime,
				wasPaused = this.paused;
			this.publish({ changing: true });
			await this.engine.pause();
			await this.audioEngine?.pause();
			await this.applySubtitleLayers(ids);
			await this.engine.seek(time);
			await this.audioEngine?.seek(time);
			if (!wasPaused) await this.start();
			localStorage.setItem(
				'sparkle.raw.subtitleLayers',
				JSON.stringify(
					this.status.subtitleLayers?.map(
						(id) => this.status.subtitleTracks.find((t) => t.id === id)?.title ?? null
					)
				)
			);
			this.publish({ changing: false });
		});
	}
	async chooseCompatibleHDR() {
		this.compatibleMode = true;
		return this.enqueue(async () => {
			this.notify('load-start');
			await this.loadPart(this.part, this.generation);
		});
	}
	get compatibleHDR() {
		return compatibleHDR(this.raw?.parts[this.part]?.streams.find((s) => s.streamType === 1));
	}
	private tick() {
		if (
			!this.engine ||
			!this.initialized ||
			this.starting ||
			this.status.changing ||
			!this.status.ready
		)
			return;
		const time = this.timeline;
		if (!this.paused) {
			if (time !== this.lastTime) {
				this.lastProgress = performance.now();
				if (this.buffering) {
					this.buffering = false;
					this.notify('playing');
				}
			} else if (!this.buffering && performance.now() - this.lastProgress > 1200) {
				this.buffering = true;
				this.notify('waiting');
			}
		}
		this.lastTime = time;
		this.subtitles?.time(Number(this.engine.currentTime));
		if (this.audioEngine && this.buffering && !this.audioWaiting) {
			this.audioWaiting = true;
			void this.enqueue(async () => {
				if (this.buffering) await this.audioEngine?.pause();
			}).catch(() => {});
		}
		if (this.buffering) return;
		this.notify('time-change', time);
		if (this.audioEngine && !this.paused && !this.driftCorrection) {
			const drift = Number(this.audioEngine.currentTime - this.engine.currentTime);
			if (Math.abs(drift) > 400) {
				this.driftSince ||= performance.now();
			} else this.driftSince = 0;
			if (this.audioWaiting || (this.driftSince && performance.now() - this.driftSince > 1000)) {
				this.driftCorrection = true;
				void this.enqueue(async () => {
					if (!this.engine || !this.audioEngine || this.paused || this.buffering) return;
					await this.audioEngine.seek(this.engine.currentTime);
					if (this.audioWaiting)
						await this.audioEngine.play({ video: false, audio: true, subtitle: false });
					this.audioWaiting = false;
					this.driftSince = 0;
				})
					.finally(() => {
						this.driftCorrection = false;
					})
					.catch(() => {});
			}
		}
	}
	private async releaseEngines() {
		const engine = this.engine,
			audio = this.audioEngine;
		const subtitles = this.subtitles;
		const layers = this.subtitleLayers;
		this.subtitleLayers = [];
		this.engine = undefined;
		this.audioEngine = undefined;
		this.subtitles = undefined;
		this.initialized = false;
		this.audioWaiting = false;
		this.driftSince = 0;
		await Promise.allSettled([engine?.destroy(), audio?.destroy()]);
		subtitles?.destroy();
		layers.forEach((layer) => layer.destroy());
		if (!this.engine) {
			this.container.replaceChildren();
			this.audioContainer.replaceChildren();
		}
	}
	destroy() {
		this.destroyed = true;
		++this.generation;
		this.abort.abort();
		clearInterval(this.timer);
		this.observer?.disconnect();
		void this.commands
			.then(() => this.releaseEngines())
			.finally(() => {
				this.container.remove();
				this.audioContainer.remove();
			})
			.catch(() => {});
		this.media.style.display = '';
	}
}
