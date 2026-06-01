// Phaser asset/atlas definitions for the farm. Loads the curated sprite sheets
// from /public/farm and registers animations + named decor frames.
//
// Phaser is only available at runtime (the scene is built via a factory after a
// dynamic import), so we import it as a type only here.
import type Phaser from 'phaser';
import { CROPS } from '@/lib/farm/crops';

export const ASSET_BASE = '/farm';

export const TX = {
	char: 'farm-char',
	tools: 'farm-tools',
	crops: 'farm-crops',
	tilled: 'farm-tilled',
	water: 'farm-water',
	decor: 'farm-decor',
	house: 'farm-house',
	coop: 'farm-coop',
	fences: 'farm-fences',
	chicken: 'farm-chicken',
	cow: 'farm-cow'
} as const;

export const GRASS_KEYS = [
	'farm-g-mid',
	'farm-g-flowers1',
	'farm-g-flowers2',
	'farm-g-grass1',
	'farm-g-grass2',
	'farm-g-sprouts1',
	'farm-g-sprouts2',
	'farm-g-moss2'
] as const;

const GRASS_FILES: Record<(typeof GRASS_KEYS)[number], string> = {
	'farm-g-mid': 'grass/mid.png',
	'farm-g-flowers1': 'grass/mid_flowers1.png',
	'farm-g-flowers2': 'grass/mid_flowers2.png',
	'farm-g-grass1': 'grass/mid_grass1.png',
	'farm-g-grass2': 'grass/mid_grass2.png',
	'farm-g-sprouts1': 'grass/mid_sprouts1.png',
	'farm-g-sprouts2': 'grass/mid_sprouts2.png',
	'farm-g-moss2': 'grass/mid_moss2.png'
};

// Named sub-rects on the decor.png texture (Basic Grass Biom things 1, 9x5 @16).
export const DECOR_FRAMES: Record<string, [number, number, number, number]> = {
	treeSmall: [0, 0, 16, 32],
	treeBig: [16, 0, 32, 32],
	treeApple: [48, 0, 32, 32],
	mushroomRed: [80, 0, 16, 16],
	mushroomPurple: [112, 0, 16, 16],
	rockSmall: [112, 16, 16, 16],
	rockBig: [128, 16, 16, 16],
	stump: [48, 32, 16, 16],
	log: [80, 32, 16, 16],
	flowerYellow: [96, 32, 16, 16],
	sunflower: [128, 32, 16, 32],
	berryBush: [0, 48, 16, 16],
	bush: [16, 48, 16, 16],
	sign: [80, 48, 16, 16],
	flowerPink: [96, 48, 16, 16],
	rockPile: [80, 64, 16, 16],
	lily1: [112, 64, 16, 16],
	lily2: [128, 64, 16, 16]
};

// Character sheet (Basic Charakter Spritesheet, 4x4 @48). Rows: 0 down, 1 up,
// 2 side (faces right; flip for left). Columns 0..3 are the walk cycle.
export type Facing4 = 'up' | 'down' | 'left' | 'right';
const CHAR_ROW: Record<'down' | 'up' | 'side', number> = { down: 0, up: 1, side: 2 };

export function charIdleFrame(facing: Facing4): number {
	if (facing === 'up') return CHAR_ROW.up * 4;
	if (facing === 'down') return CHAR_ROW.down * 4;
	return CHAR_ROW.side * 4;
}

export function cropFrame(row: number, stage: number): number {
	return row * 5 + stage; // crops.png is 5 columns wide
}

export function preloadFarmAssets(scene: Phaser.Scene) {
	const url = (file: string) => `${ASSET_BASE}/${file}`;
	scene.load.spritesheet(TX.char, url('char.png'), { frameWidth: 48, frameHeight: 48 });
	scene.load.spritesheet(TX.tools, url('tools.png'), { frameWidth: 16, frameHeight: 16 });
	scene.load.spritesheet(TX.crops, url('crops.png'), { frameWidth: 16, frameHeight: 16 });
	scene.load.spritesheet(TX.tilled, url('tilled.png'), { frameWidth: 16, frameHeight: 16 });
	scene.load.spritesheet(TX.water, url('water.png'), { frameWidth: 16, frameHeight: 16 });
	scene.load.spritesheet(TX.fences, url('fences.png'), { frameWidth: 16, frameHeight: 16 });
	scene.load.spritesheet(TX.chicken, url('chicken.png'), { frameWidth: 16, frameHeight: 16 });
	scene.load.spritesheet(TX.cow, url('cow.png'), { frameWidth: 32, frameHeight: 32 });
	scene.load.image(TX.decor, url('decor.png'));
	scene.load.image(TX.house, url('house.png'));
	scene.load.image(TX.coop, url('coop.png'));
	for (const key of GRASS_KEYS) {
		scene.load.image(key, url(GRASS_FILES[key]));
	}
}

export function registerDecorFrames(scene: Phaser.Scene) {
	const decor = scene.textures.get(TX.decor);
	for (const [name, [x, y, w, h]] of Object.entries(DECOR_FRAMES)) {
		if (!decor.has(name)) {
			decor.add(name, 0, x, y, w, h);
		}
	}
	// First house in the 3x3 sheet (64x64 cell).
	const house = scene.textures.get(TX.house);
	if (!house.has('house0')) {
		house.add('house0', 0, 0, 0, 64, 64);
	}
}

export function createFarmAnims(scene: Phaser.Scene) {
	const add = (key: string, frames: number[], frameRate: number, repeat = -1) => {
		if (scene.anims.exists(key)) return;
		scene.anims.create({
			key,
			frames: frames.map((frame) => ({ key: TX.char, frame })),
			frameRate,
			repeat
		});
	};
	add('walk-down', [0, 1, 2, 3], 8);
	add('walk-up', [4, 5, 6, 7], 8);
	add('walk-side', [8, 9, 10, 11], 8);

	if (!scene.anims.exists('water-drops')) {
		scene.anims.create({
			key: 'water-drops',
			frames: scene.anims.generateFrameNumbers(TX.water, { start: 0, end: 3 }),
			frameRate: 8,
			repeat: -1
		});
	}
	if (!scene.anims.exists('chicken-idle')) {
		scene.anims.create({
			key: 'chicken-idle',
			frames: scene.anims.generateFrameNumbers(TX.chicken, { start: 0, end: 7 }),
			frameRate: 6,
			repeat: -1
		});
	}
	if (!scene.anims.exists('cow-idle')) {
		scene.anims.create({
			key: 'cow-idle',
			frames: scene.anims.generateFrameNumbers(TX.cow, { start: 0, end: 1 }),
			frameRate: 2,
			repeat: -1
		});
	}
	// Make sure crop textures referenced by id resolve (defensive no-op touch).
	void CROPS;
}
