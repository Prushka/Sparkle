// Shared world constants for the synced farm mini-game.
// The world is a 50x18 grid of 16px tiles (800x288 world px). These bounds are
// mirrored on the Go backend (farmMinX/maxX/minY/maxY, farmTilesX/Y) — keep them
// in sync if you ever resize the farm.

export const TILE = 16;
export const WORLD_TILES_X = 50;
export const WORLD_TILES_Y = 18;
export const WORLD_W = WORLD_TILES_X * TILE; // 800
export const WORLD_H = WORLD_TILES_Y * TILE; // 288

export const CAMERA_ZOOM = 3;
/** Canvas height of the embedded farm strip (device px). */
export const GAME_HEIGHT = 248;

export const PLAYER_SPEED = 86; // world px / second

export function tileKey(tx: number, ty: number) {
	return `${tx},${ty}`;
}

export function parseTileKey(key: string): { tx: number; ty: number } | null {
	const match = /^(\d+),(\d+)$/.exec(key);
	if (!match) {
		return null;
	}
	return { tx: Number(match[1]), ty: Number(match[2]) };
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}
