// The Phaser farm scene. Built via a factory after Phaser is dynamically
// imported (client-only). It owns rendering + local simulation; React owns the
// socket and keyboard focus, feeding the scene through a typed bridge.
//
// Coordinate convention: a player's (x, y) is the world-px position of its feet
// (bottom-centre). Sprites are drawn with a near-bottom origin so depth-sorting
// by y looks right.

import type PhaserNS from 'phaser';
import type { FarmPlayerSyncState, FarmPlayerFacing, FarmPlotSyncState } from '@/lib/player/t';
import {
	TILE,
	WORLD_W,
	WORLD_H,
	CAMERA_ZOOM,
	PLAYER_SPEED,
	clamp,
	tileKey,
	parseTileKey
} from '@/lib/farm/world';
import {
	TX,
	GRASS_KEYS,
	charIdleFrame,
	cropFrame,
	preloadFarmAssets,
	registerDecorFrames,
	createFarmAnims
} from '@/lib/farm/atlas';
import {
	COLLIDERS,
	DECOR,
	FENCES,
	FIELD,
	PLAY_BOUNDS,
	STRUCTURES,
	WATER_TILES,
	grassVariant,
	isFarmTile,
	spawnFor,
	type Rect
} from '@/lib/farm/map';
import {
	CROP_BY_ID,
	canWater,
	cropRipe,
	cropStage,
	plotIsWet,
	plotNeedsWater
} from '@/lib/farm/crops';

export type FarmTool = 'hoe' | 'can' | 'seed' | 'basket';

export interface FarmBridge {
	sendPlayer: (state: FarmPlayerSyncState) => void;
	sendPlot: (plot: FarmPlotSyncState) => void;
	onHarvest: (cropId: string) => void;
}

export interface FarmKeys {
	left: boolean;
	right: boolean;
	up: boolean;
	down: boolean;
}

export interface FarmSceneInit {
	selfId: string;
	selfName: string;
	selfProfileId?: string;
	bridge: FarmBridge;
	getTool: () => FarmTool;
	getSeedCrop: () => string;
	getKeys: () => FarmKeys;
	onReady: () => void;
}

export interface FarmSceneApi {
	ready: boolean;
	applyRemotePlayers: (list: FarmPlayerSyncState[]) => void;
	applyRemotePlots: (list: FarmPlotSyncState[]) => void;
	setRoster: (ids: Set<string>) => void;
	useTool: () => void;
}

interface PlayerView {
	state: FarmPlayerSyncState;
	container: PhaserNS.GameObjects.Container;
	sprite: PhaserNS.GameObjects.Sprite;
	label: PhaserNS.GameObjects.Text;
	tool: PhaserNS.GameObjects.Image;
	lastAnim: string;
	actionUntil: number;
}

interface PlotView {
	state: FarmPlotSyncState;
	soil: PhaserNS.GameObjects.Image;
	crop: PhaserNS.GameObjects.Sprite;
	drop: PhaserNS.GameObjects.Sprite;
}

const ACTION_MS = 850;
const SEND_MS = 90; // throttle of self position updates while walking
const PLAYER_PAD = 5;

function colorForName(name: string): number {
	let h = 2166136261;
	const lower = (name || 'guest').trim().toLowerCase();
	for (let i = 0; i < lower.length; i++) {
		h = Math.imul(h ^ lower.charCodeAt(i), 16777619);
	}
	const hue = (h >>> 0) % 360;
	const s = 0.55;
	const l = 0.62;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (hue < 60) [r, g, b] = [c, x, 0];
	else if (hue < 120) [r, g, b] = [x, c, 0];
	else if (hue < 180) [r, g, b] = [0, c, x];
	else if (hue < 240) [r, g, b] = [0, x, c];
	else if (hue < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return (
		(Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)
	);
}

function pointInRect(x: number, y: number, r: Rect, pad: number) {
	return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

function walkable(x: number, y: number): boolean {
	if (
		x < PLAY_BOUNDS.minX ||
		x > PLAY_BOUNDS.maxX ||
		y < PLAY_BOUNDS.minY ||
		y > PLAY_BOUNDS.maxY
	) {
		return false;
	}
	return !COLLIDERS.some((r) => pointInRect(x, y, r, PLAYER_PAD));
}

function isActionState(action: FarmPlayerSyncState['action']) {
	return action !== 'idle' && action !== 'walking';
}

export function createFarmScene(
	Phaser: typeof PhaserNS,
	init: FarmSceneInit
): PhaserNS.Scene & FarmSceneApi {
	class FarmScene extends Phaser.Scene {
		ready = false;
		players = new Map<string, PlayerView>();
		plots = new Map<string, PlotView>();
		target: { x: number; y: number } | null = null;
		pendingTile: string | null = null;
		lastSentAt = 0;
		lastFrameAt = 0;
		highlight!: PhaserNS.GameObjects.Rectangle;

		constructor() {
			super('farm');
		}

		preload() {
			preloadFarmAssets(this);
		}

		create() {
			this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
			this.cameras.main.setZoom(CAMERA_ZOOM);
			this.cameras.main.roundPixels = true;
			this.cameras.main.setBackgroundColor('#5a8a4a');

			registerDecorFrames(this);
			createFarmAnims(this);

			this.buildGround();
			this.buildWater();
			this.buildField();
			this.buildStructures();
			this.buildFences();
			this.buildDecor();
			this.buildAnimals();

			this.highlight = this.add
				.rectangle(0, 0, TILE, TILE, 0xffffff, 0.16)
				.setStrokeStyle(1, 0xfff6da, 0.55)
				.setDepth(40)
				.setVisible(false);

			this.input.on('pointerdown', (p: PhaserNS.Input.Pointer) => this.onPointer(p));

			this.ensureSelf();
			this.ready = true;
			init.onReady();
		}

		// --- world construction ---
		buildGround() {
			const rt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0, 0).setDepth(0);
			for (let ty = 0; ty < WORLD_H / TILE; ty++) {
				for (let tx = 0; tx < WORLD_W / TILE; tx++) {
					const key = isFarmTile(tx, ty) ? 'farm-g-mid' : grassVariant(tx, ty);
					rt.draw(GRASS_KEYS.includes(key as never) ? key : 'farm-g-mid', tx * TILE, ty * TILE);
				}
			}
		}

		buildWater() {
			for (const { tx, ty } of WATER_TILES) {
				this.add
					.sprite(tx * TILE + TILE / 2, ty * TILE + TILE / 2, TX.water, 0)
					.setDepth(1)
					.play('water-drops');
			}
		}

		buildField() {
			// faint tilled base so the whole plot region reads as a field
			for (let ty = FIELD.y0; ty <= FIELD.y1; ty++) {
				for (let tx = FIELD.x0; tx <= FIELD.x1; tx++) {
					this.add
						.image(tx * TILE, ty * TILE, TX.tilled, 0)
						.setOrigin(0, 0)
						.setDepth(2)
						.setAlpha(0.25);
				}
			}
		}

		buildStructures() {
			for (const s of STRUCTURES) {
				const x = s.tx * TILE;
				const y = s.ty * TILE;
				const key = s.key === 'house' ? TX.house : TX.coop;
				const frame = s.key === 'house' ? 'house0' : undefined;
				this.add
					.image(x, y, key, frame as never)
					.setOrigin(0, 0)
					.setDepth(y + s.h);
			}
		}

		buildFences() {
			for (const f of FENCES) {
				this.add
					.image(f.tx * TILE, f.ty * TILE, TX.fences, f.frame)
					.setOrigin(0, 0)
					.setDepth(f.ty * TILE + TILE - 1);
			}
		}

		buildDecor() {
			for (const d of DECOR) {
				const baseY = d.ty * TILE + TILE;
				this.add
					.image(d.tx * TILE + TILE / 2, baseY, TX.decor, d.frame)
					.setOrigin(0.5, 1)
					.setDepth(baseY);
			}
		}

		buildAnimals() {
			for (let i = 0; i < 4; i++) {
				const c = this.add
					.sprite((41 + i * 1.4) * TILE, (4 + (i % 2)) * TILE, TX.chicken, 0)
					.play('chicken-idle');
				c.setDepth(c.y);
				this.wander(c, 41 * TILE, 46 * TILE, 3 * TILE, 6 * TILE);
			}
			for (let i = 0; i < 2; i++) {
				const cow = this.add
					.sprite((5 + i * 3) * TILE, (13 + i) * TILE, TX.cow, 0)
					.play('cow-idle');
				cow.setDepth(cow.y);
				this.wander(cow, 3 * TILE, 11 * TILE, 12 * TILE, 15 * TILE);
			}
		}

		wander(
			obj: PhaserNS.GameObjects.Sprite,
			minX: number,
			maxX: number,
			minY: number,
			maxY: number
		) {
			const step = () => {
				if (!obj.active) return;
				const nx = Phaser.Math.Between(minX, maxX);
				const ny = Phaser.Math.Between(minY, maxY);
				obj.setFlipX(nx < obj.x);
				this.tweens.add({
					targets: obj,
					x: nx,
					y: ny,
					duration: Phaser.Math.Between(2600, 5200),
					ease: 'Sine.InOut',
					onUpdate: () => obj.setDepth(obj.y),
					onComplete: () => this.time.delayedCall(Phaser.Math.Between(800, 2600), step)
				});
			};
			this.time.delayedCall(Phaser.Math.Between(300, 2600), step);
		}

		// --- players ---
		ensureSelf() {
			if (this.players.has(init.selfId)) return;
			const spawn = spawnFor(init.selfId);
			const state: FarmPlayerSyncState = {
				id: init.selfId,
				name: init.selfName,
				...(init.selfProfileId ? { profileId: init.selfProfileId } : {}),
				x: spawn.x,
				y: spawn.y,
				action: 'idle',
				facing: 'down',
				updatedAt: Date.now()
			};
			const view = this.spawnPlayer(state);
			this.cameras.main.startFollow(view.container, true, 0.16, 0.16);
			init.bridge.sendPlayer(state);
		}

		spawnPlayer(state: FarmPlayerSyncState): PlayerView {
			const sprite = this.add
				.sprite(0, 0, TX.char, charIdleFrame(state.facing))
				.setOrigin(0.5, 0.82);
			const tool = this.add.image(7, -8, TX.tools, 0).setVisible(false);
			const label = this.add
				.text(0, -22, state.name, {
					fontFamily: 'monospace',
					fontSize: '7px',
					color: '#fff6da',
					backgroundColor: '#241c18cc',
					padding: { x: 2, y: 1 },
					resolution: 3
				})
				.setOrigin(0.5, 1);
			const container = this.add.container(state.x, state.y, [sprite, tool, label]);
			container.setDepth(state.y);
			sprite.setTint(colorForName(state.name));
			const view: PlayerView = {
				state,
				container,
				sprite,
				label,
				tool,
				lastAnim: '',
				actionUntil: 0
			};
			this.players.set(state.id, view);
			return view;
		}

		// --- plots ---
		ensurePlotView(plot: FarmPlotSyncState): PlotView | null {
			const t = parseTileKey(plot.id);
			if (!t) return null;
			let view = this.plots.get(plot.id);
			if (!view) {
				const cx = t.tx * TILE + TILE / 2;
				const cy = t.ty * TILE + TILE / 2;
				const soil = this.add.image(cx, cy, TX.tilled, 0).setDepth(cy - 2);
				const crop = this.add
					.sprite(cx, cy + 7, TX.crops, 0)
					.setOrigin(0.5, 1)
					.setVisible(false);
				const drop = this.add
					.sprite(cx, cy - 12, TX.water, 0)
					.setVisible(false)
					.setDepth(cy + 30)
					.setScale(0.6);
				view = { state: plot, soil, crop, drop };
				this.plots.set(plot.id, view);
			}
			view.state = plot;
			return view;
		}

		refreshPlotVisual(view: PlotView, now: number) {
			const plot = view.state;
			const cy = view.soil.y;
			const wet = plotIsWet(plot, now);
			view.soil.setTint(wet ? 0x9c7552 : 0xffffff).setVisible(true);
			if (plot.state === 'planted' && plot.crop && CROP_BY_ID[plot.crop]) {
				const def = CROP_BY_ID[plot.crop];
				const stage = cropStage(plot, now);
				view.crop
					.setVisible(true)
					.setFrame(cropFrame(def.row, stage))
					.setDepth(cy + 8);
				view.crop.setScale(cropRipe(plot, now) ? 1.06 : 1);
				const wants = plotNeedsWater(plot, now);
				if (wants && !view.drop.visible) view.drop.setVisible(true).play('water-drops');
				else if (!wants && view.drop.visible) view.drop.setVisible(false).stop();
			} else {
				view.crop.setVisible(false);
				if (view.drop.visible) view.drop.setVisible(false).stop();
			}
		}

		// --- input ---
		onPointer(p: PhaserNS.Input.Pointer) {
			const wx = p.worldX;
			const wy = p.worldY;
			const tx = Math.floor(wx / TILE);
			const ty = Math.floor(wy / TILE);
			if (isFarmTile(tx, ty)) {
				this.target = {
					x: clamp(tx * TILE + TILE / 2, PLAY_BOUNDS.minX, PLAY_BOUNDS.maxX),
					y: clamp(ty * TILE + TILE + 2, PLAY_BOUNDS.minY, PLAY_BOUNDS.maxY)
				};
				this.pendingTile = tileKey(tx, ty);
			} else if (walkable(wx, wy)) {
				this.target = { x: wx, y: wy };
				this.pendingTile = null;
			}
		}

		facedTile(view: PlayerView): { tx: number; ty: number } {
			const f = view.state.facing;
			const dx = f === 'left' ? -1 : f === 'right' ? 1 : 0;
			const dy = f === 'up' ? -1 : f === 'down' ? 1 : 0;
			return {
				tx: Math.floor(view.state.x / TILE) + dx,
				ty: Math.floor((view.state.y - 4) / TILE) + dy
			};
		}

		useTool(forTile?: { tx: number; ty: number }) {
			const view = this.players.get(init.selfId);
			if (!view || view.actionUntil) return;
			let tile = forTile ?? this.facedTile(view);
			if (!isFarmTile(tile.tx, tile.ty)) {
				// fall back to the tile under the player's feet
				const under = {
					tx: Math.floor(view.state.x / TILE),
					ty: Math.floor((view.state.y - 4) / TILE)
				};
				if (!isFarmTile(under.tx, under.ty)) return;
				tile = under;
			}
			const id = tileKey(tile.tx, tile.ty);
			const now = Date.now();
			const tool = init.getTool();
			const existing = this.plots.get(id)?.state;
			let next: FarmPlotSyncState | null = null;
			let action: FarmPlayerSyncState['action'] = 'interacting';

			if (tool === 'hoe') {
				if (!existing) {
					next = { id, state: 'tilled', updatedAt: now };
					action = 'hoeing';
				}
			} else if (tool === 'seed') {
				if (existing && existing.state === 'tilled') {
					next = {
						id,
						state: 'planted',
						crop: init.getSeedCrop(),
						plantedAt: now,
						waterCount: 0,
						wateredAt: 0,
						updatedAt: now
					};
					action = 'hoeing';
				}
			} else if (tool === 'can') {
				if (existing && canWater(existing, now)) {
					next = {
						...existing,
						waterCount: (existing.waterCount ?? 0) + 1,
						wateredAt: now,
						updatedAt: now
					};
					action = 'watering';
					this.splash(tile);
				}
			} else if (tool === 'basket') {
				if (existing && existing.state === 'planted' && existing.crop && cropRipe(existing, now)) {
					init.bridge.onHarvest(existing.crop);
					this.harvestFx(tile, existing.crop);
					next = { id, state: 'tilled', updatedAt: now };
					action = 'harvesting';
				}
			}

			this.poseSelf(view, action, now);
			if (next) {
				this.applyLocalPlot(next);
				init.bridge.sendPlot(next);
			}
		}

		poseSelf(view: PlayerView, action: FarmPlayerSyncState['action'], now: number) {
			view.state = {
				...view.state,
				action,
				targetX: undefined,
				targetY: undefined,
				updatedAt: now
			};
			view.actionUntil = now + ACTION_MS;
			this.target = null;
			this.pendingTile = null;
			this.showTool(view, action);
			this.tweens.add({
				targets: view.sprite,
				scaleY: 0.9,
				duration: 110,
				yoyo: true,
				ease: 'Quad.Out'
			});
			this.lastSentAt = 0;
			this.sendSelf(now);
		}

		showTool(view: PlayerView, action: FarmPlayerSyncState['action']) {
			if (action === 'watering') view.tool.setTexture(TX.tools, 0).setVisible(true);
			else view.tool.setVisible(false);
		}

		splash(tile: { tx: number; ty: number }) {
			const s = this.add
				.sprite(tile.tx * TILE + TILE / 2, tile.ty * TILE + 2, TX.water, 0)
				.setDepth(tile.ty * TILE + 40)
				.play('water-drops');
			this.tweens.add({
				targets: s,
				alpha: 0,
				y: s.y - 4,
				duration: 700,
				onComplete: () => s.destroy()
			});
		}

		harvestFx(tile: { tx: number; ty: number }, cropId: string) {
			const def = CROP_BY_ID[cropId];
			const x = tile.tx * TILE + TILE / 2;
			const y = tile.ty * TILE;
			if (def) {
				const pop = this.add
					.sprite(x, y, TX.crops, cropFrame(def.row, def.stages - 1))
					.setDepth(y + 60);
				this.tweens.add({
					targets: pop,
					y: y - 16,
					alpha: 0,
					scale: 1.4,
					duration: 800,
					ease: 'Quad.Out',
					onComplete: () => pop.destroy()
				});
			}
			const txt = this.add
				.text(x, y - 6, '+1', {
					fontFamily: 'monospace',
					fontSize: '8px',
					color: '#fff6da',
					resolution: 3
				})
				.setOrigin(0.5, 1)
				.setDepth(y + 61);
			if (def) txt.setTint(def.tint);
			this.tweens.add({
				targets: txt,
				y: y - 24,
				alpha: 0,
				duration: 900,
				onComplete: () => txt.destroy()
			});
		}

		// --- the loop ---
		update(time: number) {
			const now = Date.now();
			const dt = this.lastFrameAt ? Math.min(0.05, (time - this.lastFrameAt) / 1000) : 0;
			this.lastFrameAt = time;
			this.updateSelf(dt, now);
			this.interpolateRemotes(now);
			for (const view of this.plots.values()) this.refreshPlotVisual(view, now);
			this.updateHighlight();
		}

		updateHighlight() {
			const view = this.players.get(init.selfId);
			if (!view) return;
			const tile = this.facedTile(view);
			if (isFarmTile(tile.tx, tile.ty)) {
				this.highlight
					.setVisible(true)
					.setPosition(tile.tx * TILE + TILE / 2, tile.ty * TILE + TILE / 2);
			} else {
				this.highlight.setVisible(false);
			}
		}

		updateSelf(dt: number, now: number) {
			const view = this.players.get(init.selfId);
			if (!view) return;
			let s = view.state;

			if (view.actionUntil && now > view.actionUntil) {
				view.actionUntil = 0;
				if (isActionState(s.action)) {
					s = { ...s, action: 'idle', updatedAt: now };
					view.state = s;
					this.showTool(view, 'idle');
					this.lastSentAt = 0;
					this.sendSelf(now);
				}
			}
			if (view.actionUntil) {
				this.renderPlayer(view);
				return;
			}

			const keys = init.getKeys();
			let mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
			let my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);

			if (mx !== 0 || my !== 0) {
				this.target = null;
				this.pendingTile = null;
			} else if (this.target) {
				const dx = this.target.x - s.x;
				const dy = this.target.y - s.y;
				const dist = Math.hypot(dx, dy);
				if (dist < 3) {
					this.target = null;
					if (this.pendingTile) {
						const pt = parseTileKey(this.pendingTile);
						this.pendingTile = null;
						if (pt) {
							this.useTool(pt);
							return;
						}
					}
				} else {
					mx = dx / dist;
					my = dy / dist;
				}
			}

			const prevAction = s.action;
			const moving = mx !== 0 || my !== 0;
			if (moving) {
				const len = Math.hypot(mx, my) || 1;
				const step = PLAYER_SPEED * dt;
				const nx = s.x + (mx / len) * step;
				const ny = s.y + (my / len) * step;
				let x = s.x;
				let y = s.y;
				if (walkable(nx, s.y)) x = nx;
				if (walkable(x, ny)) y = ny;
				const facing = this.facingFromDelta(x - s.x, y - s.y, s.facing);
				const blocked = x === s.x && y === s.y;
				s = { ...s, x, y, action: blocked ? 'idle' : 'walking', facing, updatedAt: now };
				view.state = s;
			} else if (s.action === 'walking') {
				s = { ...s, action: 'idle', updatedAt: now };
				view.state = s;
			}

			this.renderPlayer(view);
			const startedOrStopped = s.action !== prevAction;
			if (
				startedOrStopped ||
				(s.action === 'walking' && now - this.lastSentAt > SEND_MS) ||
				now - this.lastSentAt > 400
			) {
				this.sendSelf(now);
			}
		}

		facingFromDelta(dx: number, dy: number, fallback: FarmPlayerFacing): FarmPlayerFacing {
			if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return fallback;
			return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
		}

		renderPlayer(view: PlayerView) {
			const s = view.state;
			view.container.setPosition(Math.round(s.x), Math.round(s.y));
			view.container.setDepth(s.y);
			const flip = s.facing === 'left';
			let anim = 'walk-down';
			if (s.facing === 'up') anim = 'walk-up';
			else if (s.facing === 'left' || s.facing === 'right') anim = 'walk-side';
			view.sprite.setFlipX(flip);
			view.tool.setFlipX(flip).setX(flip ? -7 : 7);
			if (s.action === 'walking') {
				if (view.lastAnim !== anim || !view.sprite.anims.isPlaying) {
					view.sprite.play(anim);
					view.lastAnim = anim;
				}
			} else {
				view.sprite.stop();
				view.sprite.setFrame(charIdleFrame(s.facing));
				view.lastAnim = '';
			}
		}

		interpolateRemotes(now: number) {
			for (const [id, view] of this.players) {
				if (id === init.selfId) continue;
				const s = view.state;
				if (view.actionUntil && now > view.actionUntil) {
					view.actionUntil = 0;
					if (isActionState(s.action)) {
						view.state = { ...s, action: 'idle' };
						this.showTool(view, 'idle');
					}
				}
				const tx = s.targetX;
				const ty = s.targetY;
				if (!view.actionUntil && tx !== undefined && ty !== undefined) {
					const dx = tx - s.x;
					const dy = ty - s.y;
					const dist = Math.hypot(dx, dy);
					if (dist < 2) {
						view.state = {
							...s,
							x: tx,
							y: ty,
							action: s.action === 'walking' ? 'idle' : s.action,
							targetX: undefined,
							targetY: undefined
						};
					} else {
						const k = Math.min(1, PLAYER_SPEED / 60 / dist);
						view.state = {
							...s,
							x: s.x + dx * k,
							y: s.y + dy * k,
							facing: this.facingFromDelta(dx, dy, s.facing),
							action: 'walking'
						};
					}
				}
				this.renderPlayer(view);
			}
		}

		// --- bridge surface ---
		sendSelf(now: number) {
			this.lastSentAt = now;
			const s = this.players.get(init.selfId)?.state;
			if (s) init.bridge.sendPlayer(s);
		}

		applyLocalPlot(plot: FarmPlotSyncState) {
			const view = this.ensurePlotView(plot);
			if (view) this.refreshPlotVisual(view, Date.now());
		}

		applyRemotePlayers(list: FarmPlayerSyncState[]) {
			const now = Date.now();
			for (const incoming of list) {
				if (incoming.id === init.selfId) continue;
				let view = this.players.get(incoming.id);
				const action = isActionState(incoming.action);
				if (!view) {
					// first sighting: place exactly where the sender is
					view = this.spawnPlayer({ ...incoming });
				} else if (action) {
					// snap into place for the action pose
					view.state = { ...incoming };
				} else {
					// keep our rendered position and lerp toward the new one
					view.state = {
						...incoming,
						x: view.state.x,
						y: view.state.y,
						targetX: incoming.x,
						targetY: incoming.y
					};
				}
				if (action) {
					view.actionUntil = now + ACTION_MS;
					this.showTool(view, incoming.action);
				}
				view.label.setText(incoming.name);
				view.sprite.setTint(colorForName(incoming.name));
			}
		}

		applyRemotePlots(list: FarmPlotSyncState[]) {
			const now = Date.now();
			for (const plot of list) {
				const view = this.ensurePlotView(plot);
				if (view) this.refreshPlotVisual(view, now);
			}
		}

		setRoster(ids: Set<string>) {
			for (const [id, view] of this.players) {
				if (id === init.selfId) continue;
				if (!ids.has(id)) {
					view.container.destroy();
					this.players.delete(id);
				}
			}
		}
	}

	return new FarmScene() as unknown as PhaserNS.Scene & FarmSceneApi;
}
