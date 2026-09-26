import { RawSubtitleComposition, type SubtitleLayer } from './raw-subtitle-composition';
import { assPacketDialogue } from './subtitle-rendering';
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
	private composition: RawSubtitleComposition;
	private layer: SubtitleLayer;
	private ownsComposition: boolean;
	private textUntil = 0;
	private sup: SUPtitles;
	private codec = 0;
	private header = '';
	private packets: Packet[] = [];
	private assWindow: Packet[] = [];
	private bytes = 0;
	private currentTime = 0;
	private pcs: PresentationCompositionSegment | null = null;
	private wds: WindowDefinitionSegment | null = null;
	private palette: PaletteDefinitionSegment | null = null;
	private palettes = new Map<number, PaletteDefinitionSegment>();
	private objects: ObjectDefinitionSegment[] = [];
	private destroyed = false;
	constructor(
		private container: HTMLElement,
		composition?: RawSubtitleComposition
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
		this.ownsComposition = !composition;
		this.composition = composition ?? new RawSubtitleComposition(container);
		this.layer = this.composition.add();
		container.append(this.canvas);
		this.sup = new SUPtitles(this.canvas, new Uint8Array(), () => this.currentTime);
	}
	setFonts(fonts: Uint8Array[]) {
		this.composition.setFonts(fonts);
	}
	createLayer() {
		return new RawSubtitles(this.container, this.composition);
	}
	setLanguage(language = '') {
		this.layer.language = language;
		this.composition.update();
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
		this.layer.format = codec === ASS || codec === SSA ? 'ass' : codec === PGS ? 'bitmap' : 'text';
		this.canvas.style.display = codec === PGS ? '' : 'none';
		this.updateASS();
	}

	clear() {
		this.packets = [];
		this.bytes = 0;
		this.assWindow = [];
		this.pcs = null;
		this.wds = null;
		this.palette = null;
		this.palettes.clear();
		this.objects = [];
		this.sup.lastPalette = null;
		this.layer.text = '';
		this.updateASS();
		this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}
	private updateASS() {
		this.layer.content =
			this.header +
			'\n' +
			this.assWindow
				.map((packet) =>
					assPacketDialogue(new TextDecoder().decode(packet.data), packet.pts, packet.duration)
				)
				.join('\n');
		this.composition.update();
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
				this.updateASS();
			} else {
				this.layer.text = decodeRawTextSubtitle(this.codec, packet.data);
				this.textUntil = packet.pts + (packet.duration || 5000);
				this.composition.update();
			}
		}
		if (this.textUntil < ms && this.layer.text) {
			this.layer.text = '';
			this.composition.update();
		}
		this.composition.time(ms);
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
		this.sup.dispose();
		this.composition.remove(this.layer);
		if (this.ownsComposition) this.composition.destroy();
		this.canvas.remove();
		this.packets = [];
		this.assWindow = [];
		this.objects = [];
	}
}
