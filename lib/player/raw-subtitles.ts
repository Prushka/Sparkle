import type JASSUB from 'jassub';
import { decodeRawTextSubtitle } from './raw-text-subtitles';
import SUPtitles from '@/lib/suptitles/suptitles';
import {
	BaseSegment,
	PresentationCompositionSegment,
	WindowDefinitionSegment,
	PaletteDefinitionSegment,
	ObjectDefinitionSegment
} from '@/lib/suptitles/segments';

type Packet = { data: Uint8Array; pts: number; duration: number };
const PGS = 0x17006,
	ASS = 0x17016,
	SSA = 0x17004;

/** A bounded subtitle packet sink. It never downloads or retains a whole track. */
export class RawSubtitles {
	private canvas = document.createElement('canvas');
	private text = document.createElement('div');
	private ass?: JASSUB;
	private assReady = false;
	private sup: SUPtitles;
	private fonts: Uint8Array[] = [];
	private codec = 0;
	private header = '';
	private packets: Packet[] = [];
	private assWindow: Packet[] = [];
	private bytes = 0;
	private generation = 0;
	private rendererGeneration = 0;
	private assQueue = Promise.resolve();
	private assDirty = false;
	private assFlushing = false;
	private transferred = false;
	private currentTime = 0;
	private pcs: PresentationCompositionSegment | null = null;
	private wds: WindowDefinitionSegment | null = null;
	private palette: PaletteDefinitionSegment | null = null;
	private palettes = new Map<number, PaletteDefinitionSegment>();
	private objects: ObjectDefinitionSegment[] = [];
	private destroyed = false;
	constructor(
		private container: HTMLElement,
		layer = 0
	) {
		Object.assign(this.canvas.style, {
			position: 'absolute',
			inset: '0',
			width: '100%',
			height: '100%',
			objectFit: 'contain',
			pointerEvents: 'none',
			zIndex: '2'
		});
		Object.assign(this.text.style, {
			position: 'absolute',
			bottom: '7%',
			left: '5%',
			width: '90%',
			textAlign: 'center',
			color: 'white',
			fontSize: 'clamp(16px, 2.4vw, 34px)',
			whiteSpace: 'pre-line',
			textShadow: '0 2px 3px black, 0 -1px 2px black',
			pointerEvents: 'none',
			zIndex: '2'
		});
		this.text.style.bottom = `${7 + layer * 10}%`;
		container.append(this.canvas, this.text);
		this.sup = new SUPtitles(this.canvas, new Uint8Array(), () => this.currentTime);
	}
	setFonts(fonts: Uint8Array[]) {
		this.fonts = fonts;
	}
	readonly sink = {
		reset: (codec: number, header: Uint8Array) => this.reset(codec, header),
		packet: (data: Uint8Array, pts: number, duration: number) => {
			if (this.destroyed || data.byteLength > 16 * 1024 * 1024) return;
			// Bounded even for malformed timestamps or dense bitmap subtitle tracks.
			while (this.packets.length >= 256 || this.bytes + data.byteLength > 24 * 1024 * 1024) {
				const old = this.packets.shift();
				if (!old) break;
				this.bytes -= old.data.byteLength;
			}
			this.packets.push({ data, pts, duration });
			this.bytes += data.byteLength;
		},
		time: (ms: number) => this.time(ms),
		clear: () => this.clear()
	};
	private reset(codec: number, header: Uint8Array) {
		this.clear();
		this.codec = codec;
		this.header = new TextDecoder().decode(header);
		const generation = ++this.rendererGeneration;
		void this.ass?.destroy();
		this.ass = undefined;
		this.assReady = false;
		if (this.transferred || codec === ASS || codec === SSA) {
			const canvas = this.canvas.cloneNode() as HTMLCanvasElement;
			this.canvas.replaceWith(canvas);
			this.canvas = canvas;
			this.sup.cv = [canvas];
			this.transferred = false;
		}
		if (codec !== ASS && codec !== SSA) return;
		const rendererURL = '/vendor/libmedia/jassub/jassub.js';
		this.assQueue = import(/* webpackIgnore: true */ rendererURL)
			.then(async ({ default: Renderer }: { default: typeof JASSUB }) => {
				if (generation !== this.rendererGeneration || this.destroyed) return;
				this.transferred = true;
				this.ass = new Renderer({
					canvas: this.canvas,
					subContent: this.header,
					fonts: this.fonts,
					queryFonts: false,
					workerUrl: '/vendor/libmedia/jassub/worker.js',
					wasmUrl: '/vendor/libmedia/jassub/jassub-worker.wasm',
					modernWasmUrl: '/vendor/libmedia/jassub/jassub-worker-modern.wasm',
					availableFonts: { 'liberation sans': '/vendor/libmedia/jassub/default.woff2' },
					defaultFont: 'liberation sans',
					libassMemoryLimit: 32,
					libassGlyphLimit: 8
				});
				await this.ass.ready;
				if (generation === this.rendererGeneration && !this.destroyed) this.assReady = true;
			})
			.catch(() => {
				this.text.textContent = 'This subtitle renderer is unavailable on this client.';
			});
	}
	clear() {
		++this.generation;
		this.packets = [];
		this.bytes = 0;
		this.assWindow = [];
		this.pcs = null;
		this.wds = null;
		this.palette = null;
		this.palettes.clear();
		this.objects = [];
		this.sup.lastPalette = null;
		this.text.textContent = '';
		if (this.ass) {
			this.assDirty = true;
			void this.flushASS();
		} else if (!this.transferred)
			this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}
	private async flushASS() {
		if (this.assFlushing) return;
		this.assFlushing = true;
		try {
			await this.assQueue;
			while (this.assDirty && this.ass && !this.destroyed) {
				this.assDirty = false;
				const renderer = this.ass,
					generation = this.generation,
					packets = [...this.assWindow];
				const decoded = packets.map((p) => new TextDecoder().decode(p.data));
				// libmedia's Matroska demuxer already turns ASS chunks into complete
				// Dialogue lines. Feeding those to ass_process_chunk shifts fields.
				if (decoded.every((line) => /^Dialogue:/i.test(line))) {
					await renderer.renderer.setTrack(`${this.header}\n${decoded.join('\n')}`);
					continue;
				}
				await renderer.renderer.setTrack(this.header);
				for (const p of packets) {
					if (this.destroyed || generation !== this.generation || renderer !== this.ass) break;
					await renderer.renderer.processChunk(new TextDecoder().decode(p.data), p.pts, p.duration);
				}
			}
		} catch {
			/* Track replacement or teardown cancels pending rendering. */
		} finally {
			this.assFlushing = false;
		}
	}
	time(ms: number) {
		if (this.destroyed) return;
		this.currentTime = ms;
		while (
			this.packets.length &&
			this.packets[0].pts <= ms + (this.codec === ASS || this.codec === SSA ? 1000 : 0)
		) {
			const packet = this.packets.shift()!;
			this.bytes -= packet.data.byteLength;
			if (this.codec === PGS) {
				try {
					this.renderPGS(packet);
				} catch {
					this.objects = [];
				}
			} else if (this.codec === ASS || this.codec === SSA) {
				this.assWindow = this.assWindow.filter((p) => p.pts + p.duration >= ms - 1000).slice(-255);
				this.assWindow.push(packet);
				let bytes = this.assWindow.reduce((sum, p) => sum + p.data.byteLength, 0);
				while (bytes > 8 * 1024 * 1024 && this.assWindow.length)
					bytes -= this.assWindow.shift()!.data.byteLength;
				this.assDirty = true;
				void this.flushASS();
			} else {
				this.text.textContent = decodeRawTextSubtitle(this.codec, packet.data);
				this.text.dataset.until = String(packet.pts + (packet.duration || 5000));
			}
		}
		if (Number(this.text.dataset.until) < ms) this.text.textContent = '';
		if (this.assReady && this.ass && !this.ass.busy)
			void this.ass
				.manualRender({
					mediaTime: ms / 1000,
					expectedDisplayTime: performance.now(),
					width: this.container.clientWidth,
					height: this.container.clientHeight
				})
				.catch(() => {});
	}
	private renderPGS(packet: Packet) {
		for (let offset = 0; offset + 3 <= packet.data.length;) {
			const type = packet.data[offset],
				length = (packet.data[offset + 1] << 8) | packet.data[offset + 2];
			if (offset + 3 + length > packet.data.length) break;
			const bytes = new Uint8Array(13 + length),
				view = new DataView(bytes.buffer);
			bytes.set([80, 71]);
			view.setUint32(2, Math.round(packet.pts * 90));
			bytes[10] = type;
			view.setUint16(11, length);
			bytes.set(packet.data.subarray(offset + 3, offset + 3 + length), 13);
			offset += 3 + length;
			const segment = new BaseSegment(bytes);
			if (type === 0x16) {
				this.pcs = new PresentationCompositionSegment(segment);
				if (
					this.pcs.width > 8192 ||
					this.pcs.height > 8192 ||
					this.pcs.width * this.pcs.height > 16 * 1024 * 1024
				)
					throw new Error('Subtitle dimensions exceed the rendering limit');
				if (this.pcs.state === 'Epoch Start') {
					this.objects = [];
					this.palettes.clear();
					this.palette = null;
					this.sup.lastPalette = null;
				}
				this.canvas.width = this.pcs.width;
				this.canvas.height = this.pcs.height;
			} else if (type === 0x17) this.wds = new WindowDefinitionSegment(segment);
			else if (type === 0x14) {
				const palette = new PaletteDefinitionSegment(segment);
				if (this.palettes.size < 8 || this.palettes.has(palette.paletteId))
					this.palettes.set(palette.paletteId, palette);
			} else if (type === 0x15) {
				const object = new ObjectDefinitionSegment(segment);
				if (object.type === 'First' || object.type === 'First and last')
					this.objects = this.objects.filter((o) => o.id !== object.id);
				if (
					this.objects.length < 256 &&
					this.objects.reduce((sum, o) => sum + o.imgData.byteLength, 0) +
						object.imgData.byteLength <=
						16 * 1024 * 1024
				)
					this.objects.push(object);
			} else if (type === 0x80 && this.pcs) {
				this.palette = this.palettes.get(this.pcs.paletteId) ?? null;
				this.sup.lastPalette = this.palette?.palette ?? null;
				this.sup.cv = [this.canvas];
				if (this.sup.lastPalette) this.sup.draw(this.pcs, this.wds, this.palette, this.objects);
				if (!this.pcs.windowObjects.length)
					this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
				this.pcs = null;
			}
		}
	}
	destroy() {
		this.destroyed = true;
		++this.generation;
		++this.rendererGeneration;
		this.sup.dispose();
		void this.ass?.destroy();
		this.canvas.remove();
		this.text.remove();
		this.packets = [];
		this.assWindow = [];
		this.objects = [];
		this.fonts = [];
	}
}
