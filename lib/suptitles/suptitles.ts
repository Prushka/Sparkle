import {
	BaseSegment,
	PresentationCompositionSegment,
	WindowDefinitionSegment,
	PaletteDefinitionSegment,
	ObjectDefinitionSegment,
	a2h2i,
	type Palette,
	type WindowSeg
} from './segments';

import { getRgb, getPxAlpha } from './imageParser';

const STALE_SUBTITLE_TOLERANCE_MS = 1000;

export default class SUPtitles {
	file: Uint8Array;
	offset = 0;
	timeout: ReturnType<typeof setTimeout> | null = null;
	lastPalette: Palette[] | null = null;
	cv: HTMLCanvasElement[] = [];
	canvasSizeSet = false;
	videoTime: () => number;
	playbackGeneration = 0;

	constructor(canvas: HTMLCanvasElement, file: Uint8Array, getTime: () => number) {
		console.info('# SUP Starting');
		this.videoTime = getTime;
		this.cv.push(canvas);
		this.file = file;
	}

	seekedHandler = (playing = true): void => {
		this.reset(true);
		if (playing) {
			this.start();
		}
	};

	seekingHandler = (): void => {
		this.reset(true);
	};

	playHandler = (): void => {
		this.reset(true);
		this.start();
	};

	pauseHandler = (): void => {
		this.playbackGeneration += 1;
		this.clearTimer();
	};

	dispose(): void {
		this.playbackGeneration += 1;
		this.clearTimer();
		console.info('# SUP Disposed');
	}

	private clearTimer(): void {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}

	private clearCanvas(): void {
		this.cv.map((canvas) => canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height));
	}

	private reset(clearCanvas: boolean): void {
		this.playbackGeneration += 1;
		this.clearTimer();
		this.offset = 0;
		this.lastPalette = null;
		if (clearCanvas) {
			this.clearCanvas();
		}
	}

	private seekToNextPresentation(): void {
		const currentTime = this.videoTime();
		while (this.offset < this.file.length) {
			if (this.offset + 13 > this.file.length) {
				this.offset = this.file.length;
				return;
			}
			const pts = a2h2i(this.file, this.offset + 2, this.offset + 6) / 90;
			const size = 13 + a2h2i(this.file, this.offset + 11, this.offset + 13);
			const type = a2h2i(this.file, this.offset + 10, this.offset + 11);
			if (this.offset + size > this.file.length) {
				this.offset = this.file.length;
				return;
			}

			if (pts >= currentTime && type === 22) {
				break;
			}
			if (type === 20) {
				const bytes = this.file.slice(this.offset, this.offset + size);
				this.lastPalette = new PaletteDefinitionSegment(new BaseSegment(bytes)).palette;
			}
			this.offset += size;
		}
	}

	start(): void {
		if (this.offset === 0) {
			this.seekToNextPresentation();
			this.getNextSubtitle(this.playbackGeneration);
		}
	}

	getNextSubtitle(generation = this.playbackGeneration): void {
		if (generation !== this.playbackGeneration) {
			return;
		}
		if (this.offset < this.file.length) {
			let ended = false;
			let PCS: PresentationCompositionSegment | null = null;
			let WDS: WindowDefinitionSegment | null = null;
			let PDS: PaletteDefinitionSegment | null = null;
			const ODS: ObjectDefinitionSegment[] = [];

			while (!ended && this.offset < this.file.length) {
				const size = 13 + a2h2i(this.file, this.offset + 11, this.offset + 13);
				const bytes = this.file.slice(this.offset, this.offset + size);

				const base = new BaseSegment(bytes);
				switch (base.type) {
					case 'PCS':
						PCS = new PresentationCompositionSegment(base);
						if (!this.canvasSizeSet) {
							const pcs = PCS;
							this.cv.map((canvas) => {
								canvas.height = pcs.height;
								canvas.width = pcs.width;
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

			if (!PCS) {
				return;
			}

			const delay = PCS.base.pts - this.videoTime();
			if (delay < -STALE_SUBTITLE_TOLERANCE_MS) {
				this.reset(true);
				this.start();
				return;
			}

			this.timeout = setTimeout(
				() => {
					this.timeout = null;
					if (generation !== this.playbackGeneration) {
						return;
					}
					if (PCS.base.pts - this.videoTime() < -STALE_SUBTITLE_TOLERANCE_MS) {
						this.reset(true);
						this.start();
						return;
					}
					PDS || this.lastPalette
						? this.draw(PCS, WDS, PDS, ODS)
						: console.log('# SUP SKIPPING, NO PALETTE');
					this.getNextSubtitle(generation);
				},
				Math.max(0, delay)
			);
		}
	}

	draw(
		PCS: PresentationCompositionSegment,
		WDS: WindowDefinitionSegment | null,
		PDS: PaletteDefinitionSegment | null,
		ODS: ObjectDefinitionSegment[]
	): void {
		if (ODS.length > 0) {
			let first: ObjectDefinitionSegment | null = null;
			ODS.map((objectSegment) => {
				if (objectSegment.type === 'First') {
					first = objectSegment;
				} else {
					let imgData: Uint8Array = objectSegment.imgData;
					if (first) {
						imgData = Uint8Array.from([
							...[].slice.call(first.imgData),
							...[].slice.call(objectSegment.imgData)
						]);
					}
					const width = first ? first.width : objectSegment.width;
					const height = first ? first.height : objectSegment.height;
					const object = PCS.getObjectById(first ? first.id : objectSegment.id);
					if (!object) {
						first = null;
						return null;
					}
					const xOffset = object?.xOffset;
					const yOffset = object?.yOffset;
					const pixels = this.getPixels(
						imgData,
						PDS ? PDS.palette : this.lastPalette!,
						width,
						height
					);
					this.cv[0]
						.getContext('2d')
						?.putImageData(
							new ImageData(new Uint8ClampedArray(pixels), width, height),
							xOffset!,
							yOffset!
						);
					first = null;
				}
				return null;
			});
		} else {
			if (!WDS) {
				return;
			}
			WDS.windows.map((windowSegment: WindowSeg) => {
				if (
					PCS.windowObjects.length === 0 ||
					(PCS.windowObjects.length && !PCS.getObjectByWindowId(windowSegment.windowId))
				) {
					if (windowSegment.width > 0 && windowSegment.height > 0) {
						try {
							this.cv[0]
								.getContext('2d')
								?.putImageData(
									new ImageData(
										new Uint8ClampedArray(windowSegment.width * windowSegment.height * 4),
										windowSegment.width,
										windowSegment.height
									),
									windowSegment.xOffset,
									windowSegment.yOffset
								);
						} catch (error) {
							console.error(error);
							console.log(windowSegment);
						}
					} else {
						this.cv.map((canvas) =>
							canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
						);
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
