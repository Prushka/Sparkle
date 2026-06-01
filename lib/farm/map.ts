// Static farm layout: ground texture, the fenced crop field, pond, buildings,
// fences, decorations, colliders and spawn points. None of this is synced —
// every client builds the identical world from this data (deterministic), and
// only player + plot state travels over the wire.

import { TILE, WORLD_W, WORLD_H, tileKey } from '@/lib/farm/world';

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}
export interface DecorPlacement {
	frame: string;
	/** tile of the sprite's bottom-left. */
	tx: number;
	ty: number;
	solid?: boolean;
}
export interface FencePlacement {
	tx: number;
	ty: number;
	frame: number;
}

// --- deterministic helpers ---------------------------------------------------
export function hash2(tx: number, ty: number) {
	let h = 2166136261 ^ tx;
	h = Math.imul(h, 16777619) ^ ty;
	h = Math.imul(h, 16777619);
	return (h >>> 0) / 4294967295;
}

import { GRASS_KEYS } from '@/lib/farm/atlas';
const GRASS_DECO = GRASS_KEYS.filter((k) => k !== 'farm-g-mid');

export function grassVariant(tx: number, ty: number): string {
	const r = hash2(tx * 7 + 1, ty * 13 + 5);
	if (r > 0.86) {
		return GRASS_DECO[Math.floor(hash2(tx, ty) * GRASS_DECO.length) % GRASS_DECO.length];
	}
	return 'farm-g-mid';
}

// --- the crop field ----------------------------------------------------------
/** Inclusive farmable tile bounds. */
export const FIELD = { x0: 20, y0: 7, x1: 30, y1: 12 };

export function isFarmTile(tx: number, ty: number) {
	return tx >= FIELD.x0 && tx <= FIELD.x1 && ty >= FIELD.y0 && ty <= FIELD.y1;
}

// --- fences ------------------------------------------------------------------
function fenceRing(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	skip: Set<string> = new Set()
): FencePlacement[] {
	const out: FencePlacement[] = [];
	for (let tx = x0; tx <= x1; tx++) {
		for (let ty = y0; ty <= y1; ty++) {
			const edge = tx === x0 || tx === x1 || ty === y0 || ty === y1;
			if (!edge || skip.has(tileKey(tx, ty))) continue;
			let frame = 14; // horizontal middle
			if (tx === x0 && ty === y0) frame = 1;
			else if (tx === x1 && ty === y0) frame = 3;
			else if (tx === x0 && ty === y1) frame = 9;
			else if (tx === x1 && ty === y1) frame = 11;
			else if (tx === x0 || tx === x1) frame = 4; // vertical middle
			out.push({ tx, ty, frame });
		}
	}
	return out;
}

export const FENCES: FencePlacement[] = [
	// crop field ring with a gate gap at the bottom-centre
	...fenceRing(FIELD.x0 - 1, FIELD.y0 - 1, FIELD.x1 + 1, FIELD.y1 + 1, new Set([tileKey(25, 13)])),
	// cow pasture (bottom-left)
	...fenceRing(2, 11, 12, 16, new Set([tileKey(7, 11)])),
	// chicken run (top-right, around the coop)
	...fenceRing(40, 2, 47, 7, new Set([tileKey(43, 7)]))
];

// --- pond (bottom-right) -----------------------------------------------------
export const POND = { x0: 37, y0: 12, x1: 46, y1: 16 };
export const WATER_TILES: { tx: number; ty: number }[] = (() => {
	const tiles: { tx: number; ty: number }[] = [];
	for (let tx = POND.x0; tx <= POND.x1; tx++) {
		for (let ty = POND.y0; ty <= POND.y1; ty++) {
			// nibble the corners so the pond reads round-ish
			const corner = (tx === POND.x0 || tx === POND.x1) && (ty === POND.y0 || ty === POND.y1);
			if (!corner) tiles.push({ tx, ty });
		}
	}
	return tiles;
})();

// --- buildings ---------------------------------------------------------------
export interface Structure {
	key: 'house' | 'coop';
	tx: number;
	ty: number;
	w: number;
	h: number;
}
export const STRUCTURES: Structure[] = [
	{ key: 'house', tx: 3, ty: 1, w: 64, h: 64 },
	{ key: 'coop', tx: 42, ty: 2, w: 48, h: 48 }
];

// --- decorations -------------------------------------------------------------
const CURATED: DecorPlacement[] = [
	// orchard row across the top-centre (trees are 2 tiles tall, base at ty)
	{ frame: 'treeApple', tx: 16, ty: 2, solid: true },
	{ frame: 'treeBig', tx: 20, ty: 1, solid: true },
	{ frame: 'treeApple', tx: 24, ty: 2, solid: true },
	{ frame: 'treeBig', tx: 28, ty: 1, solid: true },
	{ frame: 'treeApple', tx: 32, ty: 2, solid: true },
	{ frame: 'treeSmall', tx: 35, ty: 2, solid: true },
	// near the house
	{ frame: 'bush', tx: 8, ty: 4 },
	{ frame: 'flowerYellow', tx: 9, ty: 5 },
	{ frame: 'sunflower', tx: 2, ty: 6, solid: true },
	{ frame: 'flowerPink', tx: 7, ty: 6 },
	{ frame: 'sign', tx: 11, ty: 7 },
	// around the field gate
	{ frame: 'sign', tx: 27, ty: 14 },
	{ frame: 'flowerYellow', tx: 18, ty: 14 },
	{ frame: 'flowerPink', tx: 32, ty: 14 },
	{ frame: 'mushroomRed', tx: 16, ty: 8 },
	// cow pasture dressing
	{ frame: 'treeSmall', tx: 3, ty: 16, solid: true },
	{ frame: 'bush', tx: 11, ty: 15 },
	{ frame: 'flowerYellow', tx: 6, ty: 14 },
	{ frame: 'stump', tx: 9, ty: 13 },
	// pond surroundings + lilies
	{ frame: 'lily1', tx: 39, ty: 13 },
	{ frame: 'lily2', tx: 43, ty: 15 },
	{ frame: 'lily1', tx: 45, ty: 13 },
	{ frame: 'bush', tx: 36, ty: 12 },
	{ frame: 'rockBig', tx: 47, ty: 12, solid: true },
	{ frame: 'flowerPink', tx: 38, ty: 11 },
	// open-ground scatter
	{ frame: 'rockSmall', tx: 14, ty: 11 },
	{ frame: 'log', tx: 33, ty: 9 },
	{ frame: 'mushroomPurple', tx: 36, ty: 8 },
	{ frame: 'flowerYellow', tx: 15, ty: 5 },
	{ frame: 'rockPile', tx: 13, ty: 16, solid: true },
	{ frame: 'flowerPink', tx: 34, ty: 6 },
	{ frame: 'bush', tx: 37, ty: 5 }
];

function borderDecor(): DecorPlacement[] {
	const out: DecorPlacement[] = [];
	const TX1 = WORLD_W / TILE - 1;
	const TY1 = WORLD_H / TILE - 1;
	const place = (tx: number, ty: number) => {
		const r = hash2(tx + 99, ty + 7);
		if (r < 0.55) return;
		const frame = r > 0.82 ? 'treeBig' : r > 0.68 ? 'treeSmall' : 'bush';
		out.push({ frame, tx, ty, solid: frame !== 'bush' });
	};
	for (let tx = 0; tx <= TX1; tx += 1) {
		place(tx, 0);
		place(tx, TY1);
	}
	for (let ty = 1; ty < TY1; ty += 1) {
		place(0, ty);
		place(TX1, ty);
	}
	return out;
}

export const DECOR: DecorPlacement[] = [...borderDecor(), ...CURATED];

// --- colliders & spawns ------------------------------------------------------
export const COLLIDERS: Rect[] = [
	{ x: 3 * TILE + 4, y: 2 * TILE + 8, w: 64 - 8, h: 48 }, // house body
	{ x: 42 * TILE + 2, y: 2 * TILE + 10, w: 44, h: 36 }, // coop body
	{
		x: POND.x0 * TILE,
		y: POND.y0 * TILE,
		w: (POND.x1 - POND.x0 + 1) * TILE,
		h: (POND.y1 - POND.y0 + 1) * TILE
	} // pond
];

/** Player centre is clamped to these world-px bounds. */
export const PLAY_BOUNDS = { minX: 12, maxX: WORLD_W - 12, minY: 22, maxY: WORLD_H - 8 };

export const SPAWNS: { x: number; y: number }[] = [
	{ x: 408, y: 232 },
	{ x: 360, y: 244 },
	{ x: 448, y: 236 },
	{ x: 320, y: 226 },
	{ x: 480, y: 248 },
	{ x: 384, y: 214 },
	{ x: 300, y: 240 },
	{ x: 432, y: 252 }
];

export function spawnFor(id: string): { x: number; y: number } {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	}
	const base = SPAWNS[(h >>> 0) % SPAWNS.length];
	return { x: base.x + (((h >>> 5) % 16) - 8), y: base.y + (((h >>> 9) % 12) - 6) };
}
