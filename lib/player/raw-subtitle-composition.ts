import type JASSUB from 'jassub';
import {
	EMPTY_ASS_TRACK,
	ASS_BITMAP_CACHE_LIMIT_MB,
	ASS_GLYPH_CACHE_LIMIT_MB,
	getAssFallbackFonts,
	getMergedSubtitleFontScale,
	getMergedSubtitleMinFontScale,
	normalizeAssRendererFonts,
	parseAssDocument,
	serializeMergedAss
} from './subtitle-rendering';

export type SubtitleLayer = {
	format: 'ass' | 'text' | 'bitmap' | null;
	content: string;
	text: string;
	language: string;
};

/** One ASS worker/track lets libass resolve collisions between languages exactly
 * as it does for Encoded media. Only the bounded active packet windows are merged. */
export class RawSubtitleComposition {
	private layers = new Set<SubtitleLayer>();
	private canvas = document.createElement('canvas');
	private text = document.createElement('div');
	private renderer?: JASSUB;
	private fonts: Uint8Array[] = [];
	private fontsDirty = false;
	private dirty = false;
	private flushing = false;
	private destroyed = false;
	private currentTime = 0;

	constructor(private container: HTMLElement) {
		this.canvas.dataset.rawSubtitleComposition = 'ass';
		this.text.dataset.rawSubtitleComposition = 'text';
		Object.assign(this.canvas.style, {
			position: 'absolute',
			inset: '0',
			width: '100%',
			height: '100%',
			objectFit: 'contain',
			pointerEvents: 'none',
			zIndex: '2',
			display: 'none'
		});
		Object.assign(this.text.style, {
			position: 'absolute',
			bottom: '7%',
			left: '5%',
			width: '90%',
			textAlign: 'center',
			color: 'white',
			whiteSpace: 'pre-line',
			textShadow: '0 2px 3px black, 0 -1px 2px black',
			pointerEvents: 'none',
			zIndex: '2'
		});
		container.append(this.canvas, this.text);
	}

	add() {
		const layer: SubtitleLayer = { format: null, content: '', text: '', language: '' };
		this.layers.add(layer);
		return layer;
	}

	remove(layer: SubtitleLayer) {
		this.layers.delete(layer);
		this.update();
	}

	setFonts(fonts: Uint8Array[]) {
		this.fonts = fonts;
		this.fontsDirty = true;
		this.update();
	}

	update() {
		if (this.destroyed) return;
		this.dirty = true;
		// Packet callbacks for several tracks can arrive in the same turn.
		if (!this.flushing) {
			this.flushing = true;
			queueMicrotask(() => void this.flush());
		}
	}

	private async flush() {
		try {
			while (this.dirty && !this.destroyed) {
				this.dirty = false;
				const layers = [...this.layers];
				const textLayers = layers.filter((layer) => layer.format === 'text');
				const scale = getMergedSubtitleFontScale(
					textLayers.length,
					getMergedSubtitleMinFontScale('vtt')
				);
				this.text.style.fontSize = `calc(clamp(16px, 2.4vw, 34px) * ${scale})`;
				this.text.textContent = textLayers
					.map((layer) => layer.text)
					.filter(Boolean)
					.join('\n');
				const styled = layers.filter((layer) => layer.format === 'ass');
				this.canvas.style.display = styled.length ? '' : 'none';
				if (!styled.length && !this.renderer) continue;
				if (!this.renderer) {
					const rendererURL = '/vendor/libmedia/jassub/jassub.js';
					const { default: Renderer }: { default: typeof JASSUB } = await import(
						/* webpackIgnore: true */ rendererURL
					);
					if (this.destroyed) return;
					const { availableFonts, fonts, fallbackFont } = getAssFallbackFonts();
					this.renderer = new Renderer({
						canvas: this.canvas,
						subContent: EMPTY_ASS_TRACK,
						fonts: [...fonts, ...this.fonts],
						availableFonts,
						defaultFont: fallbackFont,
						queryFonts: false,
						workerUrl: '/vendor/libmedia/jassub/worker.js',
						wasmUrl: '/vendor/libmedia/jassub/jassub-worker.wasm',
						modernWasmUrl: '/vendor/libmedia/jassub/jassub-worker-modern.wasm',
						libassMemoryLimit: ASS_BITMAP_CACHE_LIMIT_MB,
						libassGlyphLimit: ASS_GLYPH_CACHE_LIMIT_MB
					});
					this.fontsDirty = false;
					await this.renderer.ready;
				}
				if (this.destroyed) return;
				if (this.fontsDirty) {
					this.fontsDirty = false;
					await this.renderer.renderer.addFonts(this.fonts);
				}
				if (this.destroyed) return;
				const documents = styled.map((layer) =>
					parseAssDocument(normalizeAssRendererFonts(layer.content, layer.language), {
						language: layer.language
					})
				);
				// Preserve an authored single track; merge styles/events only for layers.
				const content =
					documents.length === 1 ? documents[0].content : serializeMergedAss(documents);
				await this.renderer.renderer.setTrack(content || EMPTY_ASS_TRACK);
				if (!this.destroyed) await this.paint(true);
			}
		} catch {
			if (!this.destroyed)
				this.text.textContent = 'This subtitle renderer is unavailable on this client.';
		} finally {
			this.flushing = false;
		}
	}

	time(ms: number) {
		this.currentTime = ms;
		if (!this.flushing) void this.paint().catch(() => {});
	}

	private async paint(repaint = false) {
		if (this.destroyed || !this.renderer || this.renderer.busy) return;
		await this.renderer.manualRender(
			{
				mediaTime: this.currentTime / 1000,
				expectedDisplayTime: performance.now(),
				width: this.container.clientWidth,
				height: this.container.clientHeight
			},
			repaint
		);
	}

	destroy() {
		this.destroyed = true;
		void this.renderer?.destroy().catch(() => {});
		this.canvas.remove();
		this.text.remove();
		this.layers.clear();
		this.fonts = [];
	}
}
