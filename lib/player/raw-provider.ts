import { backendFetch } from '@/lib/plex-access';
import {
	VideoProviderLoader,
	TimeRange,
	type MediaContext,
	type MediaProviderAdapter,
	type MediaProviderLoader,
	type Src
} from '@vidstack/react';
import type { Job } from './t';
import type { EncodedCodec, HDRPreference, RawMedia, RawPlaybackStatus } from './raw-types';
import {
	encodedCapabilities,
	encodedURL,
	loadEncodedPart,
	readHDRPreference,
	saveHDRPreference,
	slowNetwork,
	supportsNativeVideo,
	type EncodedPart
} from './raw-encoded';
import { EncodedSubtitles } from './encoded-subtitles';
import {
	compatibleHDR,
	normalizeHDRPreference,
	planHDR,
	SOFTWARE_TONE_MAPPING_ENABLED,
	sourceHDR,
	supportsNativeHDR
} from './raw-hdr';
import { RawSubtitles } from './raw-subtitles';
import { RawPictureInPicture } from './raw-pip';
import { AudioNormalization, reportNormalization } from './audio-normalization';
import {
	pickRawAudioTrack,
	getRawSubtitleTracks,
	restoreRawSubtitleLayers,
	rawSelectionStream
} from './raw-track-selection';
import {
	getSubtitleFormatSelection,
	getToggledSubtitleSelection,
	getStoredSubtitleLayerSrcs,
	getSubtitleLayerTracks,
	sanitizeSubtitleLayerSelection,
	persistSubtitleTrackSelection,
	type SubtitleTrackInfo,
	type SubtitleSelectionState
} from './subtitle-selection';
import { saveStoredAudioSelection, type SubtitleTrackFormat } from './track-selection';

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
		bitRate?: bigint;
		framerate?: { num: number; den: number };
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
	setHDRPlayback(path: 'native' | 'software', mime: string, dolbyVision?: boolean): void;
	setSubtitleLayers(layers: { id: number; sink: RawSubtitles['sink'] }[]): Promise<void>;
	selectAudio(id: number, smooth?: boolean, embedded?: boolean): Promise<void>;
	getPlaybackBitrate(): Promise<{ video?: number; audio?: number }>;
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
	readonly pictureInPicture = new RawPictureInPicture(
		this.container,
		() => this.container.querySelector('video'),
		() => this.initialized && this.status.ready,
		(active) => this.notify('picture-in-picture-change', active),
		() => {
			if (this.paused) void this.ctx.player.play().catch(() => {});
			else void this.ctx.player.pause().catch(() => {});
		}
	);
	private captionRestore?: { src: string; layers: string[] };
	subtitleSelectionTracks: (SubtitleTrackInfo & { id: number })[] = [];
	private audioContainer = document.createElement('div');
	private engine?: Engine;
	private mediaId = '';
	private audioEngine?: Engine;
	private normalizers = new Set<AudioNormalization>();
	private audioFilter = async (source: GainNode, destination: GainNode) => {
		const normalizer = this.createNormalizer();
		const dispose = await normalizer.bindPCM(source, destination);
		return () => {
			dispose();
			this.normalizers.delete(normalizer);
		};
	};
	private nativeAudioFilter = async (element: HTMLMediaElement) => {
		const normalizer = this.createNormalizer();
		const dispose = await normalizer.bindNative(element);
		return () => {
			dispose();
			this.normalizers.delete(normalizer);
		};
	};
	private createNormalizer() {
		const normalizer = new AudioNormalization((status) =>
			reportNormalization(this.ctx.player.el, status)
		);
		this.normalizers.add(normalizer);
		return normalizer;
	}
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
	private lastAudioCorrection = 0;
	private audioRate = NaN;
	private remoteOperations = 0;
	private hdrPreference: HDRPreference = 'auto';
	private encoded?: EncodedPart;
	private encodedCaptions?: EncodedSubtitles;
	private availableEncoders: EncodedCodec[] = [];
	private autoEncoded?: EncodedCodec;
	private networkCheck = false;
	private lastNetworkCheck = 0;
	private destroyed = false;
	private driftCorrection = false;
	private buffering = false;
	private lastProgress = performance.now();
	private lastTime = -1;
	private bitratePending = false;
	private lastBitrateSample = 0;
	private bitrateEpoch = 0;
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
		if (values.changing) {
			this.bitrateEpoch++;
			this.lastBitrateSample = 0;
			values.bitrate = undefined;
		}
		this.status = { ...this.status, ...values };
		this.ctx.$state.canPictureInPicture.set(this.pictureInPicture.supported);
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
		// Stop both local clocks if native video fails while WASM audio is still
		// decoding. Do not emit a pause request into the shared room timeline.
		if (this.initialized)
			void Promise.allSettled([this.engine?.pause(), this.audioEngine?.pause()]);
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
		this.hdrPreference = readHDRPreference();
		this.autoEncoded = undefined;
		this.availableEncoders = [];
		this.desiredTime = 0;
		this.part = 0;
		this.captionRestore = undefined;
		this.paused = true;
		this.publish({ ready: false, changing: true, reason: undefined });
		this.notify('load-start');
		const loading = this.commands.then(async () => {
			if (this.destroyed || generation !== this.generation) return;
			await this.releaseEngines();
			try {
				const url = new URL(String(src.src), location.href);
				this.baseURL = url.href.slice(0, url.href.indexOf('/media/'));
				const response = await backendFetch(url, { signal: this.abort.signal, cache: 'no-store' });
				if (!response.ok) throw new Error('This Plex item is unavailable.');
				const job: Job = await response.json();
				if (generation !== this.generation) return;
				if (!job.Raw?.parts.length) throw new Error('No mapped media parts are available.');
				this.raw = job.Raw;
				this.mediaId = job.Id;
				this.duration = job.Duration;
				this.availableEncoders = await encodedCapabilities(
					this.baseURL,
					job.width ?? 0,
					job.height ?? 0,
					this.abort.signal
				);
				if (generation !== this.generation) return;
				this.publish({ encodedAvailable: this.availableEncoders });
				if (
					this.hdrPreference === 'auto' &&
					this.availableEncoders.length &&
					(await slowNetwork(this.baseURL, job.Raw.parts[0], this.abort.signal))
				)
					this.autoEncoded = this.availableEncoders[0];
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
		const part = this.raw!.parts[index];
		let video = part.streams.find((s) => s.streamType === 1);
		const originalHDR = sourceHDR(video);
		this.publish({
			part: index,
			sourceHDR: sourceHDR(video),
			hdrPreference: this.hdrPreference,
			ready: false,
			changing: true,
			encodedCodec: undefined,
			bitrate: undefined,
			renderer: undefined,
			reason: undefined,
			audio: undefined,
			subtitle: undefined,
			subtitleLayers: [],
			audioTracks: [],
			subtitleTracks: []
		});
		const encode =
			this.hdrPreference === 'av1' || this.hdrPreference === 'hevc'
				? this.hdrPreference
				: this.hdrPreference === 'auto'
					? this.autoEncoded
					: undefined;
		this.encoded = undefined;
		if (encode) {
			if (!this.availableEncoders.includes(encode))
				throw new Error(
					`Encoded ${encode.toUpperCase()} is unavailable on this server or browser. Choose Automatic or Compatible.`
				);
			this.encoded = await loadEncodedPart(this.baseURL, part, encode, this.abort.signal);
			if (generation !== this.generation || this.destroyed) return;
			if (video)
				video = {
					...video,
					codec: encode,
					bitDepth: 10,
					DOVIPresent: false,
					DOVIProfile: 0,
					DOVIELPresent: false,
					HDR10PlusPresent: false,
					colorTrc:
						this.encoded.output === 'HDR10'
							? 'smpte2084'
							: this.encoded.output === 'HLG'
								? 'arib-std-b67'
								: 'bt709'
				};
			this.encodedCaptions = new EncodedSubtitles(this.container, this.encoded);
			this.publish({ encodedCodec: encode });
		}
		const Constructor = await loadEngine();
		if (generation !== this.generation || this.destroyed) return;
		this.subtitles = new RawSubtitles(this.container);
		this.engine = new Constructor({
			audioFilter: this.audioFilter,
			nativeAudioFilter: this.nativeAudioFilter,
			container: this.container,
			wasmBaseUrl: '/vendor/libmedia/1.3.1',
			enableWorker: true,
			enableHardware: true,
			enableWebCodecs: true,
			enableWebGPU: false,
			enableAudioWorklet: true,
			// Two bounded ~53 ms PCM blocks at 48 kHz tolerate decoder/GC jitter.
			// libmedia accounts for these buffers in its audio presentation clock.
			audioWorkletBufferLength: 20,
			preLoadTime: this.encoded ? 12 : 4,
			subtitleSink: this.subtitles.sink
		});
		const engine = this.engine!;
		const active = () =>
			generation === this.generation && engine === this.engine && !this.destroyed;
		engine.on('error', () => {
			if (active())
				this.fail(
					new Error(
						'Playback decoding failed. Try another HDR output mode, audio track or media version.'
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
			http: { credentials: 'include' as RequestCredentials },
			ext: this.encoded
				? 'm3u8'
				: ({ mpegts: 'ts', matroska: 'mkv' } as Record<string, string>)[this.raw!.container] ||
					this.raw!.container ||
					'mkv',
			maxProbeDuration: 3,
			ioLoaderOptions: { retryCount: 2, preload: 4 * 1024 * 1024 }
		};
		await engine.load(
			this.encoded
				? encodedURL(
						this.encoded,
						this.encoded.playlist === 'master.m3u8' ? 'master.m3u8' : 'video.m3u8'
					)
				: `${this.baseURL}${part.url}`,
			options
		);
		if (!active()) return;
		const demuxVideo = engine.getStreams().find((s) => s.mediaType.toLowerCase() === 'video');
		if (!demuxVideo)
			throw new Error(
				'This container or video stream could not be opened on this client. Choose another media version.'
			);
		const dovi = demuxVideo?.metadata.sparkleDovi as { data?: Uint8Array } | undefined;
		if (video && demuxVideo) {
			if (demuxVideo.codecparProxy.colorTrc === 16) video.colorTrc = 'smpte2084';
			if (demuxVideo.codecparProxy.colorTrc === 18) video.colorTrc = 'arib-std-b67';
			if (dovi?.data && dovi.data.length >= 5) {
				video.DOVIPresent = true;
				video.DOVIProfile = dovi.data[2] >> 1;
				video.DOVILevel = ((dovi.data[2] & 1) << 5) | (dovi.data[3] >> 3);
				video.DOVIBLCompatID = dovi.data[4] >> 4;
				video.DOVIELPresent = !!(dovi.data[3] & 2);
			}
		}
		if (!video && (dovi || [16, 18].includes(demuxVideo?.codecparProxy.colorTrc ?? 0)))
			throw new Error(
				'Video track metadata is missing. Refresh the library metadata before playback.'
			);
		const hdr = sourceHDR(video);
		this.publish({ sourceHDR: this.encoded ? originalHDR : hdr });
		const codec = demuxVideo?.codecparProxy;
		const plan =
			video && hdr !== 'SDR' && hdr !== 'Unknown'
				? await planHDR(
						video,
						engine.getVideoMimeType(),
						dovi?.data,
						this.encoded ? 'compatible' : this.hdrPreference,
						matchMedia('(dynamic-range: high)').matches,
						(mime, mode) =>
							supportsNativeHDR(
								mime,
								mode,
								codec?.width || 1920,
								codec?.height || 1080,
								codec?.framerate?.num && codec.framerate.den
									? codec.framerate.num / codec.framerate.den
									: 24,
								Number(codec?.bitRate || 0) || 40_000_000
							)
					)
				: undefined;
		if (!active()) return;
		if (plan) {
			engine.setBaseHDROnly(plan.baseOnly);
			engine.setHDRPlayback(plan.renderer, plan.mime, video?.DOVIProfile === 5);
		} else if (this.encoded || !SOFTWARE_TONE_MAPPING_ENABLED) {
			engine.setHDRPlayback('native', engine.getVideoMimeType());
		}
		const nativeVideo =
			!SOFTWARE_TONE_MAPPING_ENABLED || !!this.encoded || plan?.renderer === 'native';
		this.subtitles.setFonts(engine.getEmbeddedFonts());
		// Encoded Opus and video share one native media clock when supported.
		// Original unsupported audio still uses the independent WASM decoder.
		const combinedAudio =
			this.encoded?.playlist === 'master.m3u8' &&
			(plan?.renderer === 'software' || supportsNativeVideo('audio/mp4; codecs="opus"'));
		if (nativeVideo && !combinedAudio && part.streams.some((s) => s.streamType === 2)) {
			this.audioEngine = new Constructor({
				audioFilter: this.audioFilter,
				nativeAudioFilter: this.nativeAudioFilter,
				container: this.audioContainer,
				wasmBaseUrl: '/vendor/libmedia/1.3.1',
				enableWorker: true,
				enableHardware: true,
				enableAudioWorklet: true,
				audioWorkletBufferLength: 20,
				checkUseMSE: () => false,
				preLoadTime: this.encoded ? 12 : 4
			});
			await this.audioEngine!.load(
				this.encoded ? encodedURL(this.encoded, 'audio.m3u8') : `${this.baseURL}${part.url}`,
				options
			);
		}
		if (!active()) return;
		const list = (type: string) =>
			(type === 'audio' ? (this.audioEngine ?? engine) : engine)
				.getStreams()
				.filter((s) => s.mediaType.toLowerCase() === type)
				.map((s, index) => {
					const original =
						this.encoded && type === 'audio'
							? part.streams.filter((p) => p.streamType === 2)[index]
							: part.streams.find((p) => p.index === s.index);
					return {
						id: s.id,
						index: original?.index ?? s.index,
						language:
							original?.languageCode || String(s.metadata.language || original?.language || ''),
						codec: original?.codec || String(s.codecparProxy.codecId),
						title:
							original?.displayTitle ||
							String(s.metadata.title || s.metadata.language || `${type} ${s.index + 1}`)
					};
				});
		const subtitleTracks = this.encoded?.subtitleTracks ?? list('subtitle');
		this.subtitleSelectionTracks = getRawSubtitleTracks(subtitleTracks, this.mediaId);
		this.publish({
			output: plan?.output ?? 'SDR',
			renderer: plan?.renderer ?? (nativeVideo ? 'native' : undefined),
			reason: this.encoded
				? `${this.hdrPreference === 'auto' ? 'Slow connection · ' : ''}Shared NVENC ${this.encoded.codec.toUpperCase()}${/Dolby|HDR10\+/.test(originalHDR) ? ` · ${this.encoded.output} conversion` : ''}.`
				: plan?.reason,
			audioTracks: list('audio'),
			subtitleTracks,
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
			const audio = pickRawAudioTrack(this.status.audioTracks, this.mediaId);
			const subtitle = this.subtitleSelectionTracks.find((track) => track.default);
			if (audio) await (this.audioEngine ?? engine).selectAudio(audio.id, false, !!this.encoded);
			if (subtitle && !this.encoded) await engine.selectSubtitle(subtitle.id);
			engine.setSubtitleEnable(!!subtitle);
			this.publish({
				audio: (this.audioEngine ?? engine).getSelectedAudioStreamId(),
				subtitle: subtitle?.id ?? -1
			});
			const layerSrcs = subtitle
				? restoreRawSubtitleLayers(
						this.subtitleSelectionTracks,
						subtitle,
						this.status.subtitleTracks
					)
				: [];
			const ids = this.subtitleSelectionTracks
				.filter((track) => layerSrcs.includes(track.src))
				.map((track) => track.id);
			await this.applySubtitleLayers(ids);
			if (ids.length && !this.encoded) await engine.seek(engine.currentTime);
		}
		this.setVolume(this.volume);
		engine.setPlaybackRate(this.rate);
		this.setAudioRate(this.rate);
		this.ctx.$state.canPictureInPicture.set(this.pictureInPicture.supported);
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
				await Promise.all([this.engine?.pause(), this.audioEngine?.pause()]);
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
			this.normalizers.forEach((normalizer) => normalizer.reset());
			if (index !== this.part) {
				await this.loadPart(index, this.generation);
				if (!this.paused) await this.start();
			}
			const ms = BigInt(Math.round((target - this.raw.parts[index].start) * 1000));
			// Start both indexed seeks together; do not let video finish before the
			// audio decoder even starts moving to the requested position.
			await Promise.all([this.engine?.seek(ms), this.audioEngine?.seek(ms)]);
			this.encodedCaptions?.update(Number(ms), true);
			if (sequence !== this.seekSequence) return;
			this.lastTime = -1;
			this.lastProgress = performance.now();
			this.driftSince = 0;
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
		this.setAudioRate(rate);
		this.notify('rate-change', rate);
	}
	private setAudioRate(rate: number) {
		if (!this.audioEngine || rate === this.audioRate) return;
		this.audioEngine.setPlaybackRate(rate);
		this.audioRate = rate;
	}
	async selectTrack(kind: 'audio' | 'subtitle', id: number) {
		if (kind === 'subtitle')
			return this.subtitleCommand((tracks) => {
				const primaryTrack = tracks.find((track) => track.id === id) ?? null;
				if (id >= 0 && !primaryTrack) return null;
				return {
					primaryTrack,
					layerTracks: primaryTrack
						? getSubtitleLayerTracks(getStoredSubtitleLayerSrcs(tracks, primaryTrack), tracks)
						: []
				};
			});
		const expectedEngine = this.engine;
		if (!this.status.ready || this.status.changing || !this.initialized) return;
		return this.enqueue(async () => {
			if (!this.engine || this.engine !== expectedEngine || !this.initialized) return;
			const track = this.status.audioTracks.find((track) => track.id === id);
			if (!track) return;
			if (this.status.audio !== id) {
				this.publish({ changing: true });
				const wasPaused = this.paused,
					time = this.timeline;
				await this.engine.pause();
				await this.audioEngine?.pause();
				this.normalizers.forEach((normalizer) => normalizer.reset());
				await (this.audioEngine ?? this.engine).selectAudio(id, false, !!this.encoded);
				if (this.engine !== expectedEngine || this.destroyed) return;
				const ms = BigInt(Math.round((time - this.raw!.parts[this.part].start) * 1000));
				await this.engine.seek(ms);
				await this.audioEngine?.seek(ms);
				if (!wasPaused) await this.start();
				if (this.engine !== expectedEngine || this.destroyed) return;
				this.publish({ audio: id, changing: false });
			}
			saveStoredAudioSelection(rawSelectionStream(track, 'audio'), this.mediaId);
		});
	}
	changeSubtitleFormat(format: SubtitleTrackFormat) {
		return this.subtitleCommand((tracks) => getSubtitleFormatSelection(tracks, format));
	}
	toggleSubtitleTrack(src: string, checked: boolean) {
		return this.subtitleCommand((tracks) => {
			const track = tracks.find((track) => track.src === src);
			if (!track) return null;
			const primary = tracks.find((track) => track.id === this.status.subtitle) ?? null;
			const layers = tracks
				.filter((track) => this.status.subtitleLayers?.includes(track.id))
				.map((track) => track.src);
			return getToggledSubtitleSelection(tracks, primary, layers, track, checked, 2);
		});
	}
	toggleSubtitles() {
		return this.subtitleCommand((tracks) => {
			const primaryTrack = tracks.find((track) => track.id === this.status.subtitle);
			if (primaryTrack) {
				this.captionRestore = {
					src: primaryTrack.src,
					layers: tracks
						.filter((track) => this.status.subtitleLayers?.includes(track.id))
						.map((track) => track.src)
				};
				return { primaryTrack: null, layerTracks: [] };
			}
			const primary =
				tracks.find((track) => track.src === this.captionRestore?.src) ??
				getRawSubtitleTracks(this.status.subtitleTracks, this.mediaId, undefined, null).find(
					(track) => track.default
				) ??
				null;
			return {
				primaryTrack: primary,
				layerTracks: primary
					? getSubtitleLayerTracks(
							this.captionRestore?.layers ?? getStoredSubtitleLayerSrcs(tracks, primary),
							tracks
						)
					: []
			};
		});
	}
	private subtitleCommand(
		resolve: (tracks: (SubtitleTrackInfo & { id: number })[]) => SubtitleSelectionState | null
	) {
		const engine = this.engine;
		if (!engine || !this.status.ready || !this.initialized) return Promise.resolve();
		return this.enqueue(async () => {
			if (this.engine !== engine || !this.initialized) return;
			const tracks = this.subtitleSelectionTracks;
			const next = resolve(tracks);
			if (!next) return;
			const primary = next.primaryTrack;
			const id = tracks.find((track) => track.src === primary?.src)?.id ?? -1;
			const layerSrcs = sanitizeSubtitleLayerSelection(
				next.layerTracks.map((track) => track.src),
				tracks,
				primary
			).slice(0, 2);
			const layers = layerSrcs.map((src) => tracks.find((track) => track.src === src)!.id);
			const same =
				id === this.status.subtitle &&
				layers.length === (this.status.subtitleLayers?.length ?? 0) &&
				layers.every((id, i) => id === this.status.subtitleLayers?.[i]);
			if (!same) {
				this.publish({ changing: true });
				if (this.encodedCaptions) {
					this.encodedCaptions.select([id, ...layers]);
				} else {
					const wasPaused = this.paused,
						time = engine.currentTime;
					await engine.pause();
					await this.audioEngine?.pause();
					if (this.engine !== engine || this.destroyed) return;
					await this.applySubtitleLayers([]);
					engine.setSubtitleEnable(id >= 0);
					if (id >= 0) await engine.selectSubtitle(id);
					if (this.engine !== engine || this.destroyed) return;
					this.publish({ subtitle: id });
					await this.applySubtitleLayers(layers);
					await engine.seek(time);
					await this.audioEngine?.seek(time);
					if (this.engine !== engine || this.destroyed) return;
					if (!wasPaused) await this.start();
				}
				if (this.engine !== engine || this.destroyed) return;
			}
			persistSubtitleTrackSelection(tracks, primary, getSubtitleLayerTracks(layerSrcs, tracks));
			this.publish({ subtitle: id, subtitleLayers: layers, changing: false });
		});
	}
	private async applySubtitleLayers(ids: number[]) {
		if (!this.engine) return;
		if (this.encodedCaptions) {
			const selected = ids
				.slice(0, 2)
				.map((id, index) =>
					id !== this.status.subtitle &&
					ids.indexOf(id) === index &&
					this.status.subtitleTracks.some((track) => track.id === id)
						? id
						: -1
				);
			this.encodedCaptions.select([this.status.subtitle ?? -1, ...selected]);
			this.publish({ subtitleLayers: selected });
			return;
		}
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
		return this.subtitleCommand((tracks) => ({
			primaryTrack: tracks.find((track) => track.id === this.status.subtitle) ?? null,
			layerTracks: ids.flatMap((id) => tracks.find((track) => track.id === id) ?? [])
		}));
	}
	async chooseCompatibleHDR() {
		return this.chooseHDR('compatible');
	}
	async chooseHDR(preference: HDRPreference, networkChange = false) {
		preference = normalizeHDRPreference(preference);
		if (
			(preference === 'av1' || preference === 'hevc') &&
			!this.availableEncoders.includes(preference)
		) {
			this.publish({
				reason: `Encoded ${preference.toUpperCase()} is unavailable on this server or browser.`
			});
			return;
		}
		return this.enqueue(async () => {
			if (preference === this.hdrPreference && this.status.ready && !networkChange) return;
			const time = this.initialized ? this.timeline : this.desiredTime;
			const wasPaused = this.paused;
			const generation = this.generation;
			this.remoteOperations++;
			this.publish({ changing: true });
			try {
				this.hdrPreference = preference;
				saveHDRPreference(preference);
				if (preference === 'auto' && !networkChange) {
					this.autoEncoded =
						this.availableEncoders.length &&
						(await slowNetwork(this.baseURL, this.raw!.parts[this.part], this.abort.signal))
							? this.availableEncoders[0]
							: undefined;
				}
				await this.loadPart(this.part, generation);
				if (generation !== this.generation || this.destroyed) return;
				// Warm the replacement renderer before seeking, then restore the local
				// pause state. None of these internal operations emit room commands.
				this.starting = true;
				await this.start();
				const ms = BigInt(Math.round((time - this.raw!.parts[this.part].start) * 1000));
				await this.engine?.seek(ms);
				await this.audioEngine?.seek(ms);
				if (wasPaused) {
					await this.engine?.pause();
					await this.audioEngine?.pause();
				}
				this.desiredTime = time;
			} finally {
				this.starting = false;
				this.remoteOperations--;
				if (generation === this.generation) {
					this.paused = wasPaused;
					this.publish({ changing: false });
				}
			}
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
		if (
			!this.paused &&
			!this.buffering &&
			!this.bitratePending &&
			performance.now() - this.lastBitrateSample >= 1000
		) {
			const engine = this.engine,
				audio = this.audioEngine,
				epoch = this.bitrateEpoch;
			this.bitratePending = true;
			this.lastBitrateSample = performance.now();
			void Promise.all([engine.getPlaybackBitrate(), audio?.getPlaybackBitrate()])
				.then(([videoStats, audioStats]) => {
					if (
						engine !== this.engine ||
						audio !== this.audioEngine ||
						epoch !== this.bitrateEpoch ||
						this.status.changing
					)
						return;
					this.publish({
						bitrate: { video: videoStats.video, audio: audioStats?.audio ?? videoStats.audio }
					});
				})
				.catch(() => {})
				.finally(() => {
					this.bitratePending = false;
				});
		}
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
		if (this.buffering) {
			if (
				this.hdrPreference === 'auto' &&
				!this.encoded &&
				this.availableEncoders.length &&
				!this.networkCheck &&
				performance.now() - this.lastProgress > 6000 &&
				performance.now() - this.lastNetworkCheck > 30000
			) {
				this.networkCheck = true;
				this.lastNetworkCheck = performance.now();
				const generation = this.generation;
				void slowNetwork(this.baseURL, this.raw!.parts[this.part], this.abort.signal)
					.then(async (slow) => {
						if (
							slow &&
							generation === this.generation &&
							this.hdrPreference === 'auto' &&
							!this.destroyed
						) {
							this.autoEncoded = this.availableEncoders[0];
							await this.chooseHDR('auto', true);
						}
					})
					.catch(() => {})
					.finally(() => {
						this.networkCheck = false;
					});
			}
			return;
		}
		this.encodedCaptions?.update(Number(this.engine.currentTime));
		this.notify('time-change', time);
		if (this.audioEngine && !this.paused && !this.driftCorrection) {
			const drift = Number(this.audioEngine.currentTime - this.engine.currentTime);
			// Correct ordinary clock drift smoothly. Repeated demux/decoder seeks
			// are expensive for large MKVs and can starve an incoming pause command.
			// Hysteresis avoids repeatedly flushing the time stretcher around the
			// threshold as worker clock reports and render quanta arrive.
			const correction =
				drift > 120 || (this.audioRate < this.rate && drift > 40)
					? 0.97
					: drift < -120 || (this.audioRate > this.rate && drift < -40)
						? 1.03
						: 1;
			this.setAudioRate(this.rate * correction);
			if (Math.abs(drift) > 1500) {
				this.driftSince ||= performance.now();
			} else this.driftSince = 0;
			if (
				this.audioWaiting ||
				(this.driftSince &&
					performance.now() - this.driftSince > 2000 &&
					performance.now() - this.lastAudioCorrection > 5000)
			) {
				this.driftCorrection = true;
				void this.enqueue(async () => {
					if (!this.engine || !this.audioEngine || this.paused || this.buffering) return;
					await this.audioEngine.seek(this.engine.currentTime);
					if (this.audioWaiting)
						await this.audioEngine.play({ video: false, audio: true, subtitle: false });
					this.audioWaiting = false;
					this.driftSince = 0;
					this.lastAudioCorrection = performance.now();
					this.setAudioRate(this.rate);
				})
					.finally(() => {
						this.driftCorrection = false;
					})
					.catch(() => {});
			}
		}
	}
	private async releaseEngines() {
		this.encodedCaptions?.destroy();
		this.encodedCaptions = undefined;
		await this.pictureInPicture.exit().catch(() => {});
		const engine = this.engine,
			audio = this.audioEngine;
		const subtitles = this.subtitles;
		const layers = this.subtitleLayers;
		this.subtitleLayers = [];
		this.engine = undefined;
		this.audioEngine = undefined;
		this.audioRate = NaN;
		this.subtitles = undefined;
		this.initialized = false;
		this.audioWaiting = false;
		this.driftSince = 0;
		await Promise.allSettled([engine?.destroy(), audio?.destroy()]);
		this.normalizers.forEach((normalizer) => normalizer.dispose());
		this.normalizers.clear();
		subtitles?.destroy();
		layers.forEach((layer) => layer.destroy());
		if (!this.engine) {
			this.container.replaceChildren();
			this.audioContainer.replaceChildren();
		}
	}
	destroy() {
		this.pictureInPicture.destroy();
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
