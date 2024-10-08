import {
	BaseSegment,
	PresentationCompositionSegment,
	WindowDefinitionSegment,
	PaletteDefinitionSegment,
	ObjectDefinitionSegment,
	a2h2i,
	Palette,
	type WindowSeg
} from './segments.js';

import { getRgb, getPxAlpha } from './imageParser.js';

export default class SUPtitles {
	file: Uint8Array;
	offset: number = 0;
	timeout: any = null;
	lastPalette: Palette[] | null = null;
	cv: HTMLCanvasElement[] = [];
	canvasSizeSet = false;
	videoTime: () => number;

	constructor(canvas: HTMLCanvasElement, file: Uint8Array, getTime: () => number) {
		console.info('# SUP Starting');

		this.videoTime = getTime;

		this.cv.push(canvas);
		this.file = file;
	}

	seekedHandler = (): void => {
		this.start();
	};

	seekingHandler = (): void => {
		clearTimeout(this.timeout);
		this.offset = 0;
		this.cv.map(c => c.getContext('2d')?.clearRect(0, 0, c.width, c.height));
	};

	playHandler = (): void => {
		this.offset = 0;
		this.cv.map(c => c.getContext('2d')?.clearRect(0, 0, c.width, c.height));
		this.start();
	};

	pauseHandler = (): void => {
		clearTimeout(this.timeout);
	};

	dispose(): void {
		clearTimeout(this.timeout);
		console.info('# SUP Disposed');
	}

	start(): void {
		if (this.offset === 0) {
			while (this.offset < this.file.length) {
				const pts = a2h2i(this.file, this.offset + 2, this.offset + 6) / 90;
				const size = 13 + a2h2i(this.file, this.offset + 11, this.offset + 13);
				const type = a2h2i(this.file, this.offset + 10, this.offset + 11);

				if (pts > this.videoTime() && type === 22) {
					break;
				} else {
					this.offset += size;
				}
			}
			this.getNextSubtitle();
		}
	}

	getNextSubtitle(): void {
		if (this.offset < this.file.length) {
			let ended = false;
			let PCS: PresentationCompositionSegment;
			let WDS: WindowDefinitionSegment;
			let PDS: PaletteDefinitionSegment;
			const ODS: ObjectDefinitionSegment[] = [];

			while (!ended) {
				const size = 13 + a2h2i(this.file, this.offset + 11, this.offset + 13);
				const bytes = this.file.slice(this.offset, this.offset + size);

				const base = new BaseSegment(bytes);
				switch (base.type) {
					case 'PCS':
						PCS = new PresentationCompositionSegment(base);
						if (!this.canvasSizeSet) {
							this.cv.map(c => {
								c.height = PCS.height;
								c.width = PCS.width;
								return null;
							});
							this.canvasSizeSet = true;
						}
						break;
					case 'WDS':
						WDS = new WindowDefinitionSegment(base);
						break;
					case 'PDS':
						PDS = new PaletteDefinitionSegment(base);
						this.lastPalette = PDS.palette;
						break;
					case 'ODS':
						ODS.push(new ObjectDefinitionSegment(base));
						break;
					case 'END':
						ended = true;
						break;
					default:
						throw new Error('InvalidSegmentError');
				}
				this.offset += size;
			}
			this.timeout = setTimeout(() => {
				PDS || this.lastPalette
					? this.draw(PCS, WDS, PDS, ODS)
					: console.log('# SUP SKIPPING, NO PALETTE');
				this.getNextSubtitle();
			}, PCS!.base.pts - this.videoTime());
		}
	}

	draw(
		PCS: PresentationCompositionSegment,
		WDS: WindowDefinitionSegment,
		PDS: PaletteDefinitionSegment,
		ODS: ObjectDefinitionSegment[]
	): void {
		if (ODS.length > 0) {
			// DRAW
			let first: ObjectDefinitionSegment | null;
			ODS.map(o => {
				if (o.type === 'First') {
					first = o;
				} else {
					let imgData: Uint8Array = o.imgData;
					if (first) {
						imgData = Uint8Array.from([
							...[].slice.call(first.imgData),
							...[].slice.call(o.imgData)
						]);
					}
					const width = first ? first.width : o.width;
					const height = first ? first.height : o.height;
					const object = PCS.getObjectById(first ? first.id : o.id);
					const xOffset = object?.xOffset;
					const yOffset = object?.yOffset;
					const pixels = this.getPixels(
						imgData,
						PDS ? PDS.palette : this.lastPalette!,
						width,
						height
					);
					this.cv[0] // object.windowId
						.getContext('2d')
						?.putImageData(
							new ImageData(pixels, width, height),
							xOffset!,
							yOffset!
						);
					first = null;
				}
				return null;
			});
		} else {
			// ERASE
			WDS.windows.map((w: WindowSeg) => {
				if (
					PCS.windowObjects.length === 0 ||
					(PCS.windowObjects.length && !PCS.getObjectByWindowId(w.windowId))
				) {
					if (w.width > 0 && w.height > 0) {
						try {
							this.cv[0] // w.windowId
								.getContext('2d')
								?.putImageData(
									new ImageData(
										new Uint8ClampedArray(w.width * w.height * 4),
										w.width,
										w.height
									),
									w.xOffset,
									w.yOffset
								);
						} catch (e) {
							console.error(e);
							console.log(w);
						}
					} else {
						this.cv.map(c => c.getContext('2d')?.clearRect(0, 0, c.width, c.height));
					}
				}
				return null;
			});
		}
	}

	getPixels(
		imgData: Uint8Array,
		palette: Palette[],
		width: number,
		height: number
	): Uint8ClampedArray {
		const rgb = getRgb(palette);

		const [pxMx1, alphaMx1] = getPxAlpha(imgData, palette);

		const pxls = new Uint8ClampedArray(width * height * 4);

		for (let h = 0; h < pxMx1.length; h++) {
			for (let w = 0; w < pxMx1[h].length; w++) {
				const i = h * pxMx1[h].length + w;

				pxls[i * 4] = rgb[pxMx1[h][w]][0];
				pxls[i * 4 + 1] = rgb[pxMx1[h][w]][1];
				pxls[i * 4 + 2] = rgb[pxMx1[h][w]][2];
				pxls[i * 4 + 3] = alphaMx1[h][w];
			}
		}

		return pxls;
	}
}
