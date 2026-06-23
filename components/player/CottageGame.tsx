'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { getPlayerFallbackColor, hashString } from '@/lib/player/color';
import {
	SyncTypes,
	type CottagePlayerAction,
	type CottagePlayerFacing,
	type CottagePlayerSyncState,
	type CottageSyncState,
	type Player as RoomPlayer,
	type SendPayload
} from '@/lib/player/t';

type CottagePlayerIdentity = {
	id: string;
	name: string;
	profileId?: string;
};

type CottageInteraction = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	anchorX: number;
	anchorY: number;
	targetX?: number;
	targetY?: number;
	facing: CottagePlayerFacing;
	action: CottagePlayerAction;
	radius: number;
	sortY: number;
};

type CottageGameProps = {
	backendBaseUrl: string;
	roomId: string;
	socketConnected: boolean;
	currentPlayer: CottagePlayerIdentity | null;
	roomPlayers: RoomPlayer[];
};

type Rect = {
	x: number;
	y: number;
	w: number;
	h: number;
};

type MoveTarget = {
	x: number;
	y: number;
	interactionId?: string;
};

const MAP_WIDTH = 1440;
const MAP_HEIGHT = 350;
const ROOM_CROP_TOP = 28;
const ROOM_CROP_BOTTOM = 8;
const GAME_HEIGHT = 178;
const PLAYER_SPEED = 124;
const PLAYER_RADIUS = 11;
const INTERACTION_CLICK_RADIUS = 24;
const INTERACTION_ACTION_MS = 2500;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;
const COTTAGE_GAME_SURFACE_CLASS_NAME =
	'relative mx-auto w-full max-w-[90rem] overflow-hidden bg-[#312820] outline-none focus-visible:outline-none';

const FLOOR_BOUNDS = { minX: 44, maxX: 1396, minY: 116, maxY: 316 };

// Include front strips and legs so Y-sorted furniture never clips a walking player.
const COLLIDERS: Rect[] = [
	{ x: 50, y: 54, w: 92, h: 68 },
	{ x: 185, y: 66, w: 122, h: 45 },
	{ x: 378, y: 76, w: 96, h: 42 },
	{ x: 660, y: 50, w: 128, h: 86 },
	{ x: 904, y: 76, w: 100, h: 42 },
	{ x: 1128, y: 62, w: 136, h: 54 },
	{ x: 178, y: 212, w: 188, h: 48 },
	{ x: 176, y: 266, w: 196, h: 14 },
	{ x: 498, y: 204, w: 136, h: 72 },
	{ x: 518, y: 272, w: 12, h: 16 },
	{ x: 602, y: 272, w: 12, h: 16 },
	{ x: 914, y: 218, w: 92, h: 48 },
	{ x: 908, y: 272, w: 104, h: 10 },
	{ x: 1126, y: 188, w: 178, h: 80 },
	{ x: 1140, y: 276, w: 160, h: 14 },
	{ x: 1134, y: 292, w: 18, h: 12 },
	{ x: 1286, y: 292, w: 18, h: 12 },
	{ x: 1328, y: 116, w: 54, h: 92 }
];

const INTERACTIONS: CottageInteraction[] = [
	{
		id: 'couch-left',
		x: 164,
		y: 208,
		w: 106,
		h: 72,
		anchorX: 220,
		anchorY: 252,
		targetX: 220,
		targetY: 294,
		facing: 'down',
		action: 'sitting',
		radius: 56,
		sortY: 284
	},
	{
		id: 'couch-right',
		x: 260,
		y: 208,
		w: 110,
		h: 72,
		anchorX: 318,
		anchorY: 252,
		targetX: 318,
		targetY: 294,
		facing: 'down',
		action: 'sitting',
		radius: 56,
		sortY: 284
	},
	{
		id: 'table-north',
		x: 526,
		y: 178,
		w: 78,
		h: 34,
		anchorX: 566,
		anchorY: 198,
		targetX: 566,
		targetY: 178,
		facing: 'down',
		action: 'sitting',
		radius: 54,
		sortY: 226
	},
	{
		id: 'table-south',
		x: 526,
		y: 270,
		w: 78,
		h: 34,
		anchorX: 566,
		anchorY: 292,
		targetX: 566,
		targetY: 306,
		facing: 'up',
		action: 'sitting',
		radius: 54,
		sortY: 310
	},
	{
		id: 'table-west',
		x: 462,
		y: 220,
		w: 42,
		h: 48,
		anchorX: 488,
		anchorY: 254,
		targetX: 450,
		targetY: 254,
		facing: 'right',
		action: 'sitting',
		radius: 52,
		sortY: 282
	},
	{
		id: 'table-east',
		x: 628,
		y: 220,
		w: 42,
		h: 48,
		anchorX: 646,
		anchorY: 254,
		targetX: 684,
		targetY: 254,
		facing: 'left',
		action: 'sitting',
		radius: 52,
		sortY: 282
	},
	{
		id: 'armchair',
		x: 905,
		y: 212,
		w: 112,
		h: 78,
		anchorX: 960,
		anchorY: 256,
		targetX: 960,
		targetY: 296,
		facing: 'down',
		action: 'sitting',
		radius: 58,
		sortY: 296
	},
	{
		id: 'bed',
		x: 1114,
		y: 176,
		w: 206,
		h: 122,
		anchorX: 1218,
		anchorY: 262,
		targetX: 1274,
		targetY: 304,
		facing: 'left',
		action: 'sleeping',
		radius: 72,
		sortY: 306
	},
	{
		id: 'fireplace',
		x: 642,
		y: 42,
		w: 164,
		h: 118,
		anchorX: 722,
		anchorY: 156,
		facing: 'up',
		action: 'interacting',
		radius: 70,
		sortY: 160
	},
	{
		id: 'bookshelf',
		x: 42,
		y: 54,
		w: 114,
		h: 88,
		anchorX: 106,
		anchorY: 150,
		facing: 'up',
		action: 'interacting',
		radius: 58,
		sortY: 146
	},
	{
		id: 'tea-counter',
		x: 1112,
		y: 54,
		w: 168,
		h: 84,
		anchorX: 1198,
		anchorY: 144,
		facing: 'up',
		action: 'interacting',
		radius: 58,
		sortY: 142
	},
	{
		id: 'plant',
		x: 1318,
		y: 104,
		w: 74,
		h: 104,
		anchorX: 1324,
		anchorY: 212,
		targetX: 1304,
		targetY: 212,
		facing: 'right',
		action: 'interacting',
		radius: 54,
		sortY: 216
	}
];

const INTERACTION_BY_ID = new Map(INTERACTIONS.map((interaction) => [interaction.id, interaction]));

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function distance(aX: number, aY: number, bX: number, bY: number) {
	return Math.hypot(aX - bX, aY - bY);
}

function joinBackendPath(base: string, path: string) {
	if (!base) {
		return path.startsWith('/') ? path : `/${path}`;
	}
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function getBackendWebSocketUrl(base: string, path: string) {
	const fullPath = joinBackendPath(base, path);
	if (/^https?:\/\//.test(fullPath)) {
		const url = new URL(fullPath);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		return url.toString();
	}
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${wsProtocol}//${window.location.host}${fullPath}`;
}

function isPointInRect(x: number, y: number, rect: Rect, padding = 0) {
	return (
		x >= rect.x - padding &&
		x <= rect.x + rect.w + padding &&
		y >= rect.y - padding &&
		y <= rect.y + rect.h + padding
	);
}

function isWalkable(x: number, y: number) {
	if (
		x < FLOOR_BOUNDS.minX ||
		x > FLOOR_BOUNDS.maxX ||
		y < FLOOR_BOUNDS.minY ||
		y > FLOOR_BOUNDS.maxY
	) {
		return false;
	}
	return !COLLIDERS.some((collider) => isPointInRect(x, y, collider, PLAYER_RADIUS));
}

function getSpawnPoint(id: string, name: string) {
	const hash = hashString(`${id}:${name}`);
	const spawnXs = [400, 750, 1050, 250, 1260, 610, 850, 1160];
	const spawnYs = [306, 294, 306, 154, 154, 166, 166, 300];
	const index = hash % spawnXs.length;
	return {
		x: spawnXs[index] + ((hash >> 5) % 28) - 14,
		y: spawnYs[index] + ((hash >> 11) % 16) - 8
	};
}

function getDisplayName(player: Pick<RoomPlayer, 'id' | 'name'> | CottagePlayerIdentity) {
	return (player.name || player.id || 'Guest').trim().slice(0, 80) || 'Guest';
}

function normalizeAction(action: unknown): CottagePlayerAction {
	if (
		action === 'walking' ||
		action === 'sitting' ||
		action === 'sleeping' ||
		action === 'interacting'
	) {
		return action;
	}
	return 'idle';
}

function normalizeFacing(facing: unknown): CottagePlayerFacing {
	if (facing === 'up' || facing === 'left' || facing === 'right') {
		return facing;
	}
	return 'down';
}

function normalizeCottagePlayer(
	player: Partial<CottagePlayerSyncState> | null | undefined
): CottagePlayerSyncState | null {
	if (!player || typeof player.id !== 'string' || !PLAYER_ID_PATTERN.test(player.id)) {
		return null;
	}
	const name = typeof player.name === 'string' && player.name.trim() ? player.name.trim() : 'Guest';
	const spawn = getSpawnPoint(player.id, name);
	const x =
		typeof player.x === 'number' && Number.isFinite(player.x)
			? clamp(player.x, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX)
			: spawn.x;
	const y =
		typeof player.y === 'number' && Number.isFinite(player.y)
			? clamp(player.y, FLOOR_BOUNDS.minY, FLOOR_BOUNDS.maxY)
			: spawn.y;
	const targetX =
		typeof player.targetX === 'number' && Number.isFinite(player.targetX)
			? clamp(player.targetX, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX)
			: undefined;
	const targetY =
		typeof player.targetY === 'number' && Number.isFinite(player.targetY)
			? clamp(player.targetY, FLOOR_BOUNDS.minY, FLOOR_BOUNDS.maxY)
			: undefined;
	const profileId =
		typeof player.profileId === 'string' && player.profileId.length <= 128
			? player.profileId
			: undefined;
	const interactionId =
		typeof player.interactionId === 'string' && INTERACTION_BY_ID.has(player.interactionId)
			? player.interactionId
			: undefined;
	return {
		id: player.id,
		name: name.slice(0, 80),
		...(profileId ? { profileId } : {}),
		x,
		y,
		...(targetX !== undefined && targetY !== undefined ? { targetX, targetY } : {}),
		action: normalizeAction(player.action),
		facing: normalizeFacing(player.facing),
		...(interactionId ? { interactionId } : {}),
		updatedAt:
			typeof player.updatedAt === 'number' && Number.isFinite(player.updatedAt)
				? Math.max(0, player.updatedAt)
				: 0
	};
}

function normalizeCottageSyncState(
	state: Partial<CottageSyncState> | null | undefined
): CottageSyncState {
	const players = Array.isArray(state?.players)
		? state.players
				.map((player) => normalizeCottagePlayer(player))
				.filter((player): player is CottagePlayerSyncState => Boolean(player))
				.slice(0, 80)
		: [];
	return {
		players,
		updatedAt:
			typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt)
				? Math.max(0, state.updatedAt)
				: 0
	};
}

function createDefaultPlayer(player: CottagePlayerIdentity): CottagePlayerSyncState {
	const name = getDisplayName(player);
	const spawn = getSpawnPoint(player.id, name);
	return {
		id: player.id,
		name,
		...(player.profileId ? { profileId: player.profileId } : {}),
		x: spawn.x,
		y: spawn.y,
		action: 'idle',
		facing: 'down',
		updatedAt: Date.now()
	};
}

function findInteraction(id: string | undefined) {
	return id ? INTERACTION_BY_ID.get(id) : undefined;
}

function getInteractionTarget(interaction: CottageInteraction): MoveTarget {
	return {
		x: interaction.targetX ?? interaction.anchorX,
		y: interaction.targetY ?? interaction.anchorY,
		interactionId: interaction.id
	};
}

function getInteractionSortY(player: CottagePlayerSyncState) {
	const interaction = findInteraction(player.interactionId);
	if (
		interaction &&
		(player.action === 'sitting' || player.action === 'sleeping' || player.action === 'interacting')
	) {
		return interaction.sortY;
	}
	return player.y;
}

function isFurniturePoseAction(action: CottagePlayerAction) {
	return action === 'sitting' || action === 'sleeping';
}

function findNearestInteraction(player: CottagePlayerSyncState) {
	let nearest: CottageInteraction | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const interaction of INTERACTIONS) {
		const target = getInteractionTarget(interaction);
		const candidateDistance = distance(player.x, player.y, target.x, target.y);
		if (candidateDistance <= interaction.radius && candidateDistance < nearestDistance) {
			nearest = interaction;
			nearestDistance = candidateDistance;
		}
	}
	return nearest;
}

function findClickedInteraction(x: number, y: number) {
	return (
		INTERACTIONS.find((interaction) => isPointInRect(x, y, interaction, 4)) ||
		INTERACTIONS.find(
			(interaction) =>
				distance(x, y, interaction.anchorX, interaction.anchorY) <= INTERACTION_CLICK_RADIUS
		) ||
		null
	);
}

function standPlayer(
	player: CottagePlayerSyncState,
	updatedAt = Date.now()
): CottagePlayerSyncState {
	const interaction = findInteraction(player.interactionId);
	const exitTarget =
		interaction && isFurniturePoseAction(player.action) ? getInteractionTarget(interaction) : null;
	return {
		...player,
		...(exitTarget ? { x: exitTarget.x, y: exitTarget.y } : {}),
		action: 'idle',
		interactionId: undefined,
		targetX: undefined,
		targetY: undefined,
		updatedAt
	};
}

function interactPlayer(
	player: CottagePlayerSyncState,
	interaction: CottageInteraction,
	updatedAt = Date.now()
): CottagePlayerSyncState {
	return {
		...player,
		x: interaction.anchorX,
		y: interaction.anchorY,
		targetX: undefined,
		targetY: undefined,
		action: interaction.action,
		facing: interaction.facing,
		interactionId: interaction.id,
		updatedAt
	};
}

function moveWithCollision(player: CottagePlayerSyncState, dx: number, dy: number) {
	let x = player.x;
	let y = player.y;
	const nextX = clamp(x + dx, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX);
	if (isWalkable(nextX, y)) {
		x = nextX;
	}
	const nextY = clamp(y + dy, FLOOR_BOUNDS.minY, FLOOR_BOUNDS.maxY);
	if (isWalkable(x, nextY)) {
		y = nextY;
	}
	return { x, y };
}

function getMoveTarget(player: CottagePlayerSyncState): MoveTarget | null {
	if (player.targetX === undefined || player.targetY === undefined) {
		return null;
	}
	return {
		x: player.targetX,
		y: player.targetY,
		...(player.interactionId ? { interactionId: player.interactionId } : {})
	};
}

function getFacingFromDelta(
	dx: number,
	dy: number,
	fallback: CottagePlayerFacing
): CottagePlayerFacing {
	if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
		return fallback;
	}
	return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

function setPlayerMoveTarget(
	player: CottagePlayerSyncState,
	target: MoveTarget,
	updatedAt = Date.now()
): CottagePlayerSyncState {
	const interaction = findInteraction(target.interactionId);
	const moveTarget = interaction ? getInteractionTarget(interaction) : target;
	if (distance(player.x, player.y, moveTarget.x, moveTarget.y) < 5) {
		if (interaction) {
			return interactPlayer(player, interaction, updatedAt);
		}
		return {
			...player,
			action: 'idle',
			interactionId: undefined,
			targetX: undefined,
			targetY: undefined,
			updatedAt
		};
	}
	return {
		...player,
		targetX: moveTarget.x,
		targetY: moveTarget.y,
		action: 'walking',
		facing: getFacingFromDelta(moveTarget.x - player.x, moveTarget.y - player.y, player.facing),
		...(interaction ? { interactionId: interaction.id } : { interactionId: undefined }),
		updatedAt
	};
}

function finishPlayerMoveTarget(
	player: CottagePlayerSyncState,
	target: MoveTarget,
	updatedAt: number
): CottagePlayerSyncState {
	const arrived = {
		...player,
		x: target.x,
		y: target.y
	};
	const interaction = findInteraction(target.interactionId);
	if (interaction) {
		return interactPlayer(arrived, interaction, updatedAt);
	}
	return {
		...arrived,
		action: 'idle',
		interactionId: undefined,
		targetX: undefined,
		targetY: undefined,
		updatedAt
	};
}

function advancePlayerTowardTarget(
	player: CottagePlayerSyncState,
	deltaSeconds: number,
	updatedAt: number
): CottagePlayerSyncState {
	const target = getMoveTarget(player);
	if (!target) {
		return player.action === 'walking' ? standPlayer(player, updatedAt) : player;
	}
	const targetDistance = distance(player.x, player.y, target.x, target.y);
	if (targetDistance < 5) {
		return finishPlayerMoveTarget(player, target, updatedAt);
	}
	const stepDistance = Math.min(PLAYER_SPEED * deltaSeconds, targetDistance);
	if (stepDistance <= 0) {
		return player;
	}
	const dx = ((target.x - player.x) / targetDistance) * stepDistance;
	const dy = ((target.y - player.y) / targetDistance) * stepDistance;
	const moved = moveWithCollision(player, dx, dy);
	const blocked = moved.x === player.x && moved.y === player.y;
	if (blocked) {
		return {
			...player,
			action: 'idle',
			interactionId: undefined,
			targetX: undefined,
			targetY: undefined,
			updatedAt
		};
	}
	if (distance(moved.x, moved.y, target.x, target.y) < 5) {
		return finishPlayerMoveTarget({ ...player, ...moved }, target, updatedAt);
	}
	return {
		...player,
		...moved,
		action: 'walking',
		facing: getFacingFromDelta(dx, dy, player.facing),
		updatedAt
	};
}

function getDirectionalDestination(
	player: CottagePlayerSyncState,
	moveX: number,
	moveY: number
): MoveTarget {
	const magnitude = Math.hypot(moveX, moveY) || 1;
	const stepX = (moveX / magnitude) * 8;
	const stepY = (moveY / magnitude) * 8;
	let cursor = { x: player.x, y: player.y };
	for (let i = 0; i < 240; i += 1) {
		const moved = moveWithCollision({ ...player, x: cursor.x, y: cursor.y }, stepX, stepY);
		if (moved.x === cursor.x && moved.y === cursor.y) {
			break;
		}
		cursor = moved;
		if (
			cursor.x <= FLOOR_BOUNDS.minX ||
			cursor.x >= FLOOR_BOUNDS.maxX ||
			cursor.y <= FLOOR_BOUNDS.minY ||
			cursor.y >= FLOOR_BOUNDS.maxY
		) {
			break;
		}
	}
	return cursor;
}

function hasPlayerChanged(a: CottagePlayerSyncState, b: CottagePlayerSyncState) {
	return (
		Math.abs(a.x - b.x) > 0.1 ||
		Math.abs(a.y - b.y) > 0.1 ||
		a.name !== b.name ||
		a.profileId !== b.profileId ||
		a.action !== b.action ||
		a.facing !== b.facing ||
		a.interactionId !== b.interactionId ||
		a.targetX !== b.targetX ||
		a.targetY !== b.targetY
	);
}

function roundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

function fillRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	fill: string
) {
	roundedRect(ctx, x, y, w, h, r);
	ctx.fillStyle = fill;
	ctx.fill();
}

function drawEllipse(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radiusX: number,
	radiusY: number,
	fill: string
) {
	ctx.beginPath();
	ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();
}

function drawPixelWindow(ctx: CanvasRenderingContext2D, x: number, y: number) {
	fillRoundedRect(ctx, x, y, 118, 56, 7, '#6f8ea9');
	ctx.fillStyle = '#d7f1ff';
	ctx.fillRect(x + 10, y + 9, 44, 38);
	ctx.fillRect(x + 64, y + 9, 44, 38);
	ctx.fillStyle = 'rgba(255,255,255,0.56)';
	ctx.fillRect(x + 15, y + 12, 10, 34);
	ctx.fillRect(x + 69, y + 12, 10, 34);
	ctx.fillStyle = '#af5f62';
	ctx.fillRect(x - 7, y + 2, 10, 58);
	ctx.fillRect(x + 115, y + 2, 10, 58);
	ctx.fillStyle = '#7f3942';
	ctx.fillRect(x - 10, y, 135, 7);
	ctx.fillRect(x + 55, y + 9, 8, 39);
}

function drawBookshelf(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 48, 54, 98, 88, 6, '#8e5940');
	ctx.fillStyle = '#57372f';
	ctx.fillRect(58, 72, 78, 5);
	ctx.fillRect(58, 100, 78, 5);
	const colors = ['#bd5e50', '#d7a84a', '#628bb0', '#6a9b68', '#bb777d', '#e0c383'];
	for (let shelf = 0; shelf < 3; shelf++) {
		for (let i = 0; i < 7; i++) {
			ctx.fillStyle = colors[(i + shelf * 2) % colors.length];
			ctx.fillRect(60 + i * 11, 60 + shelf * 28, 7, 17 + ((i + shelf) % 3) * 3);
		}
	}
	ctx.fillStyle = '#f4d69b';
	ctx.fillRect(118, 112, 13, 18);
}

function drawFireplace(ctx: CanvasRenderingContext2D, time: number) {
	fillRoundedRect(ctx, 650, 48, 148, 96, 8, '#8c6258');
	fillRoundedRect(ctx, 676, 76, 96, 58, 7, '#3e2a2a');
	ctx.fillStyle = '#b98766';
	ctx.fillRect(660, 58, 128, 8);
	ctx.fillRect(660, 136, 128, 8);
	for (let i = 0; i < 9; i++) {
		ctx.fillStyle = i % 2 === 0 ? '#a9796a' : '#795047';
		ctx.fillRect(660 + i * 14, 58, 10, 78);
	}
	const flicker = Math.sin(time / 140) * 3 + Math.sin(time / 83) * 2;
	ctx.fillStyle = '#492c24';
	ctx.fillRect(694, 120, 60, 8);
	ctx.fillStyle = '#ffb347';
	ctx.beginPath();
	ctx.moveTo(722, 122);
	ctx.bezierCurveTo(696, 102 + flicker, 706, 84, 721, 78 + flicker);
	ctx.bezierCurveTo(738, 92, 750, 102 + flicker, 722, 122);
	ctx.fill();
	ctx.fillStyle = '#ff724d';
	ctx.beginPath();
	ctx.moveTo(721, 124);
	ctx.bezierCurveTo(707, 108, 716, 96 + flicker, 725, 88);
	ctx.bezierCurveTo(736, 103, 738, 113, 721, 124);
	ctx.fill();
	ctx.fillStyle = '#ffe08a';
	ctx.beginPath();
	ctx.moveTo(721, 121);
	ctx.bezierCurveTo(715, 112, 720, 102, 726, 98 + flicker);
	ctx.bezierCurveTo(731, 111, 729, 118, 721, 121);
	ctx.fill();
}

function drawCouchBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 176, 210, 196, 62, 13, '#9a586a');
	fillRoundedRect(ctx, 188, 198, 172, 38, 11, '#b96c78');
	fillRoundedRect(ctx, 190, 230, 76, 42, 9, '#c57982');
	fillRoundedRect(ctx, 278, 230, 76, 42, 9, '#c57982');
}

function drawCouchFront(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 176, 266, 196, 7, 4, '#9a586a');
	ctx.fillStyle = '#7b3f55';
	ctx.fillRect(196, 270, 18, 10);
	ctx.fillRect(334, 270, 18, 10);
	ctx.strokeStyle = '#6d394c';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(184, 270.5);
	ctx.lineTo(364, 270.5);
	ctx.stroke();
}

function drawDiningChairs(ctx: CanvasRenderingContext2D) {
	const chairColor = '#9f6b44';
	fillRoundedRect(ctx, 526, 176, 80, 35, 7, chairColor);
	fillRoundedRect(ctx, 526, 276, 80, 35, 7, chairColor);
	fillRoundedRect(ctx, 462, 220, 43, 50, 7, chairColor);
	fillRoundedRect(ctx, 628, 220, 43, 50, 7, chairColor);
}

function drawDiningTable(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 496, 202, 140, 76, 10, '#bf814f');
	fillRoundedRect(ctx, 511, 214, 110, 52, 7, '#d3945b');
	ctx.fillStyle = '#8f5c3d';
	ctx.fillRect(518, 272, 12, 16);
	ctx.fillRect(602, 272, 12, 16);
	ctx.fillRect(518, 186, 12, 16);
	ctx.fillRect(602, 186, 12, 16);
	ctx.fillStyle = '#f7dfaf';
	ctx.fillRect(544, 228, 28, 17);
	ctx.fillRect(585, 238, 24, 14);
	drawEllipse(ctx, 562, 256, 18, 8, '#8aa56a');
	ctx.fillStyle = '#d86c51';
	ctx.fillRect(556, 250, 6, 9);
	ctx.fillRect(566, 249, 6, 10);
}

function drawBedBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 1124, 178, 192, 118, 12, '#80583e');
	fillRoundedRect(ctx, 1140, 190, 160, 92, 8, '#f1d6ad');
	fillRoundedRect(ctx, 1150, 198, 68, 35, 8, '#fff2d3');
	fillRoundedRect(ctx, 1223, 198, 68, 35, 8, '#fff2d3');
	fillRoundedRect(ctx, 1140, 232, 160, 54, 9, '#7295a5');
	ctx.fillStyle = '#5e7888';
	ctx.fillRect(1148, 241, 144, 7);
}

function drawBedFront(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 1140, 276, 160, 10, 6, '#7295a5');
	ctx.fillStyle = '#5e7888';
	ctx.fillRect(1148, 278, 144, 5);
	ctx.fillStyle = '#5b3d32';
	ctx.fillRect(1134, 292, 18, 12);
	ctx.fillRect(1286, 292, 18, 12);
}

function drawArmchairBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 908, 212, 104, 70, 12, '#7f7960');
	fillRoundedRect(ctx, 922, 202, 76, 38, 10, '#98906d');
	fillRoundedRect(ctx, 930, 236, 60, 42, 9, '#aca477');
}

function drawArmchairFront(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 908, 274, 104, 8, 5, '#7f7960');
	fillRoundedRect(ctx, 930, 272, 60, 6, 4, '#aca477');
	ctx.strokeStyle = '#5f5946';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(916, 280.5);
	ctx.lineTo(1004, 280.5);
	ctx.stroke();
}

function drawTeaCounter(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 1118, 56, 154, 68, 7, '#7c5647');
	ctx.fillStyle = '#d2b07b';
	ctx.fillRect(1126, 64, 138, 12);
	ctx.fillStyle = '#4e3937';
	ctx.fillRect(1132, 84, 34, 26);
	ctx.fillRect(1177, 84, 34, 26);
	ctx.fillRect(1222, 84, 34, 26);
	drawEllipse(ctx, 1195, 74, 16, 6, '#91a86d');
	ctx.fillStyle = '#e8d7ae';
	ctx.fillRect(1230, 65, 20, 14);
}

function drawPlant(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 1332, 178, 34, 42, 5, '#9a6545');
	ctx.fillStyle = '#486f4c';
	for (let i = 0; i < 8; i++) {
		ctx.beginPath();
		ctx.ellipse(1348 + Math.sin(i) * 18, 160 + i * 2, 10, 24, (i - 3) * 0.38, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.fillStyle = '#77a565';
	ctx.beginPath();
	ctx.ellipse(1345, 148, 11, 28, -0.3, 0, Math.PI * 2);
	ctx.fill();
}

function drawDecor(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 382, 76, 88, 42, 6, '#785d4c');
	ctx.fillStyle = '#d7b078';
	ctx.fillRect(394, 86, 24, 22);
	ctx.fillStyle = '#8bb28e';
	ctx.fillRect(429, 84, 28, 25);
	fillRoundedRect(ctx, 902, 76, 106, 44, 6, '#72513f');
	ctx.fillStyle = '#edc470';
	ctx.fillRect(918, 88, 26, 20);
	ctx.fillStyle = '#9bbad6';
	ctx.fillRect(954, 86, 36, 24);
	drawPlant(ctx);
}

function drawFloorAndWalls(ctx: CanvasRenderingContext2D) {
	const wallGradient = ctx.createLinearGradient(0, 0, 0, 122);
	wallGradient.addColorStop(0, '#6d7564');
	wallGradient.addColorStop(1, '#a5916d');
	ctx.fillStyle = '#312820';
	ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
	fillRoundedRect(ctx, 18, 16, MAP_WIDTH - 36, MAP_HEIGHT - 28, 8, '#5a3e34');
	ctx.fillStyle = wallGradient;
	ctx.fillRect(28, 28, MAP_WIDTH - 56, 94);
	ctx.fillStyle = '#7b5846';
	ctx.fillRect(28, 118, MAP_WIDTH - 56, 10);
	const floorGradient = ctx.createLinearGradient(0, 124, 0, MAP_HEIGHT);
	floorGradient.addColorStop(0, '#c38d58');
	floorGradient.addColorStop(1, '#9e6845');
	ctx.fillStyle = floorGradient;
	ctx.fillRect(28, 128, MAP_WIDTH - 56, 196);
	for (let y = 132; y < 324; y += 18) {
		ctx.fillStyle = y % 36 === 0 ? 'rgba(86,51,34,0.22)' : 'rgba(255,239,196,0.12)';
		ctx.fillRect(30, y, MAP_WIDTH - 60, 2);
		for (let x = 42 + ((y / 18) % 3) * 40; x < MAP_WIDTH - 40; x += 128) {
			ctx.fillStyle = 'rgba(84,48,32,0.16)';
			ctx.fillRect(x, y - 16, 2, 17);
		}
	}
	fillRoundedRect(ctx, 406, 172, 330, 140, 18, '#85515a');
	fillRoundedRect(ctx, 420, 184, 302, 116, 14, '#b46f69');
	ctx.fillStyle = 'rgba(255,235,187,0.26)';
	for (let x = 438; x < 702; x += 28) {
		ctx.fillRect(x, 194, 12, 96);
	}
	fillRoundedRect(ctx, 82, 184, 190, 92, 18, '#637b72');
	ctx.fillStyle = 'rgba(245,230,180,0.23)';
	for (let i = 0; i < 7; i++) {
		ctx.fillRect(106 + i * 22, 198, 12, 64);
	}
	fillRoundedRect(ctx, 1026, 142, 268, 82, 16, '#766645');
	ctx.fillStyle = 'rgba(245,230,180,0.20)';
	for (let i = 0; i < 9; i++) {
		ctx.fillRect(1046 + i * 26, 154, 13, 56);
	}
	drawPixelWindow(ctx, 190, 44);
	drawPixelWindow(ctx, 1018, 44);
}

function drawLighting(
	ctx: CanvasRenderingContext2D,
	time: number,
	cameraX: number,
	cameraY: number,
	canvasWidth: number
) {
	ctx.save();
	ctx.globalCompositeOperation = 'screen';
	const firePulse = 0.72 + Math.sin(time / 190) * 0.08 + Math.sin(time / 73) * 0.05;
	let glow = ctx.createRadialGradient(724, 108, 10, 724, 118, 170);
	glow.addColorStop(0, `rgba(255, 188, 91, ${0.45 * firePulse})`);
	glow.addColorStop(0.55, `rgba(255, 130, 76, ${0.2 * firePulse})`);
	glow.addColorStop(1, 'rgba(255, 132, 74, 0)');
	ctx.fillStyle = glow;
	ctx.fillRect(548, 8, 360, 270);
	glow = ctx.createRadialGradient(184, 176, 8, 184, 176, 104);
	glow.addColorStop(0, 'rgba(255, 225, 160, 0.2)');
	glow.addColorStop(1, 'rgba(255, 225, 160, 0)');
	ctx.fillStyle = glow;
	ctx.fillRect(70, 64, 230, 220);
	glow = ctx.createRadialGradient(1120, 138, 10, 1120, 138, 120);
	glow.addColorStop(0, 'rgba(179, 222, 255, 0.18)');
	glow.addColorStop(1, 'rgba(179, 222, 255, 0)');
	ctx.fillStyle = glow;
	ctx.fillRect(980, 44, 280, 210);
	ctx.restore();

	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	const vignette = ctx.createRadialGradient(
		cameraX + canvasWidth / 2,
		190,
		130,
		cameraX + canvasWidth / 2,
		190,
		620
	);
	vignette.addColorStop(0, 'rgba(255,255,255,0)');
	vignette.addColorStop(0.75, 'rgba(77,48,34,0.08)');
	vignette.addColorStop(1, 'rgba(38,26,29,0.35)');
	ctx.fillStyle = vignette;
	ctx.fillRect(cameraX, cameraY, canvasWidth, GAME_HEIGHT);
	ctx.restore();
}

function drawInteractionSpark(
	ctx: CanvasRenderingContext2D,
	player: CottagePlayerSyncState,
	time: number
) {
	if (player.action !== 'interacting') {
		return;
	}
	const y = player.y - 44 + Math.sin(time / 180) * 2;
	ctx.save();
	ctx.globalAlpha = 0.92;
	ctx.fillStyle = '#fff0a8';
	for (let i = 0; i < 3; i++) {
		const angle = time / 380 + i * 2.1;
		const x = player.x + Math.cos(angle) * (12 + i * 2);
		const sy = y + Math.sin(angle) * 6;
		ctx.beginPath();
		ctx.moveTo(x, sy - 5);
		ctx.lineTo(x + 3, sy);
		ctx.lineTo(x, sy + 5);
		ctx.lineTo(x - 3, sy);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, player: CottagePlayerSyncState, time: number) {
	const interaction = findInteraction(player.interactionId);
	const color = getPlayerFallbackColor(player.name);
	const bob = player.action === 'walking' ? Math.sin(time / 85 + player.x * 0.08) * 2 : 0;
	const poseX = player.x;
	const poseY =
		player.action === 'sleeping' && interaction?.id === 'bed' ? interaction.anchorY - 28 : player.y;
	const nameY = player.action === 'sleeping' ? poseY - 34 : poseY - 48 + bob;
	drawEllipse(ctx, player.x, player.y + 4, 18, 8, 'rgba(35, 24, 18, 0.22)');

	ctx.save();
	ctx.translate(poseX, poseY + bob);
	if (player.action === 'sleeping') {
		ctx.rotate(-0.05);
		fillRoundedRect(ctx, -32, -16, 68, 28, 10, color);
		fillRoundedRect(ctx, -37, -18, 24, 24, 10, '#f0b78b');
		ctx.fillStyle = '#4f322a';
		ctx.fillRect(-38, -19, 20, 8);
		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		ctx.fillRect(-6, -12, 28, 5);
		ctx.restore();
	} else {
		if (player.action === 'sitting') {
			ctx.translate(0, 5);
		}
		const legSpread = player.action === 'walking' ? Math.sin(time / 85) * 5 : 2;
		ctx.fillStyle = '#3d3b48';
		if (player.action !== 'sitting') {
			fillRoundedRect(ctx, -8 - legSpread * 0.25, 6, 7, 16, 3, '#3d3b48');
			fillRoundedRect(ctx, 2 + legSpread * 0.25, 6, 7, 16, 3, '#3d3b48');
		} else {
			fillRoundedRect(ctx, -12, 8, 10, 10, 4, '#3d3b48');
			fillRoundedRect(ctx, 2, 8, 10, 10, 4, '#3d3b48');
		}
		fillRoundedRect(ctx, -14, -16, 28, 30, 9, color);
		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		ctx.fillRect(-9, -11, 18, 5);
		fillRoundedRect(ctx, -12, -36, 24, 24, 10, '#f0b78b');
		ctx.fillStyle = '#4f322a';
		if (player.facing === 'up') {
			ctx.fillRect(-12, -37, 24, 12);
		} else {
			ctx.fillRect(-12, -38, 24, 8);
			ctx.fillRect(-12, -33, 5, 8);
			ctx.fillRect(7, -33, 5, 8);
			ctx.fillStyle = '#3a2926';
			const eyeOffset = player.facing === 'left' ? -2 : player.facing === 'right' ? 2 : 0;
			ctx.fillRect(-5 + eyeOffset, -26, 3, 3);
			ctx.fillRect(4 + eyeOffset, -26, 3, 3);
		}
		ctx.restore();
	}

	drawInteractionSpark(ctx, player, time);

	ctx.save();
	ctx.font = '700 12px Inter, ui-sans-serif, system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const text = player.name;
	const width = Math.min(124, Math.ceil(ctx.measureText(text).width) + 18);
	fillRoundedRect(ctx, player.x - width / 2, nameY - 9, width, 18, 7, 'rgba(34, 28, 24, 0.58)');
	ctx.strokeStyle = 'rgba(255, 235, 196, 0.22)';
	ctx.lineWidth = 1;
	roundedRect(ctx, player.x - width / 2, nameY - 9, width, 18, 7);
	ctx.stroke();
	ctx.fillStyle = '#fff4da';
	ctx.fillText(text.length > 18 ? `${text.slice(0, 17)}...` : text, player.x, nameY + 0.5);
	ctx.restore();
}

function drawScene(
	ctx: CanvasRenderingContext2D,
	players: CottagePlayerSyncState[],
	cameraX: number,
	cameraY: number,
	canvasWidth: number,
	time: number
) {
	ctx.clearRect(0, 0, canvasWidth, GAME_HEIGHT);
	ctx.save();
	const mapOffsetX = Math.max(0, (canvasWidth - MAP_WIDTH) / 2);
	ctx.translate(mapOffsetX - cameraX, -cameraY);
	drawFloorAndWalls(ctx);
	drawBookshelf(ctx);
	drawFireplace(ctx, time);
	drawTeaCounter(ctx);
	drawDecor(ctx);
	drawDiningChairs(ctx);

	const drawItems: { sortY: number; draw: () => void }[] = [
		{ sortY: 236, draw: () => drawCouchBase(ctx) },
		{ sortY: 240, draw: () => drawArmchairBase(ctx) },
		{ sortY: 264, draw: () => drawBedBase(ctx) },
		{ sortY: 278, draw: () => drawDiningTable(ctx) },
		{ sortY: 279, draw: () => drawCouchFront(ctx) },
		{ sortY: 289, draw: () => drawArmchairFront(ctx) },
		{ sortY: 301, draw: () => drawBedFront(ctx) },
		...players.map((player) => ({
			sortY: getInteractionSortY(player),
			draw: () => drawPlayer(ctx, player, time)
		}))
	];

	drawItems.sort((a, b) => a.sortY - b.sortY);
	for (const item of drawItems) {
		item.draw();
	}

	drawLighting(ctx, time, cameraX, cameraY, Math.min(canvasWidth, MAP_WIDTH));
	ctx.restore();
}

function getVisiblePlayers(
	playersById: Record<string, CottagePlayerSyncState>,
	roomPlayers: RoomPlayer[],
	currentPlayer: CottagePlayerIdentity | null
) {
	const activeIds = new Set(roomPlayers.map((player) => player.id));
	const hasCurrentInRoom = currentPlayer ? activeIds.has(currentPlayer.id) : false;
	if (currentPlayer) {
		activeIds.add(currentPlayer.id);
	}
	const visible: CottagePlayerSyncState[] = [];
	for (const player of roomPlayers) {
		const synced = playersById[player.id];
		if (synced) {
			visible.push({ ...synced, name: getDisplayName(player), profileId: player.profileId });
			continue;
		}
		visible.push(createDefaultPlayer(player));
	}
	if (currentPlayer && !hasCurrentInRoom) {
		const synced = playersById[currentPlayer.id];
		visible.push(synced ?? createDefaultPlayer(currentPlayer));
	}
	return visible.filter((player, index, all) => {
		return all.findIndex((candidate) => candidate.id === player.id) === index;
	});
}

function shouldAutoStand(player: CottagePlayerSyncState) {
	return player.action === 'interacting';
}

function applyIncomingCottagePlayer(
	existing: CottagePlayerSyncState | undefined,
	incoming: CottagePlayerSyncState,
	now: number
) {
	const target = getMoveTarget(incoming);
	if (target) {
		const movementStartAt = incoming.updatedAt || now;
		const base: CottagePlayerSyncState = {
			...incoming,
			x: incoming.x,
			y: incoming.y,
			action: incoming.action,
			facing: incoming.facing,
			targetX: undefined,
			targetY: undefined,
			updatedAt: movementStartAt
		};
		const moving = setPlayerMoveTarget(base, target, movementStartAt);
		if (!incoming.updatedAt) {
			return moving;
		}
		const elapsedSeconds = Math.min(30, Math.max(0, (now - incoming.updatedAt) / 1000));
		return advancePlayerTowardTarget(moving, elapsedSeconds, now);
	}

	const interaction = findInteraction(incoming.interactionId);
	if (
		interaction &&
		(incoming.action === 'sitting' ||
			incoming.action === 'sleeping' ||
			incoming.action === 'interacting')
	) {
		return interactPlayer(incoming, interaction, now);
	}

	return {
		...incoming,
		x: incoming.x,
		y: incoming.y,
		targetX: undefined,
		targetY: undefined,
		updatedAt: now
	};
}

export function CottageGamePlaceholder() {
	return (
		<div
			aria-hidden="true"
			className={`${COTTAGE_GAME_SURFACE_CLASS_NAME} opacity-85 saturate-[0.92]`}
			style={{ height: GAME_HEIGHT }}
		>
			<div className="absolute inset-0 bg-[#312820]" />
			<div className="absolute inset-x-0 top-0 h-[37%] bg-[linear-gradient(180deg,#69725f_0%,#a28d68_100%)]" />
			<div className="absolute inset-x-0 bottom-0 h-[66%] bg-[linear-gradient(180deg,#bd8755_0%,#92603f_100%)]" />
			<div className="absolute inset-x-0 top-[34%] h-[6px] bg-[#785644]" />
			<div className="absolute inset-x-0 top-[45%] h-px bg-white/10" />
			<div className="absolute inset-x-0 top-[56%] h-px bg-black/10" />
			<div className="absolute inset-x-0 top-[68%] h-px bg-white/10" />
			<div className="absolute inset-x-0 top-[80%] h-px bg-black/10" />

			<div className="absolute left-[13%] top-[12%] h-[27%] w-[9.5%] bg-[#7b3942]">
				<div className="absolute left-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute right-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute left-[46%] top-[18%] h-[58%] w-[7%] bg-[#6f4050]" />
			</div>
			<div className="absolute right-[20%] top-[12%] h-[27%] w-[9.5%] bg-[#7b3942]">
				<div className="absolute left-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute right-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute left-[46%] top-[18%] h-[58%] w-[7%] bg-[#6f4050]" />
			</div>

			<div className="absolute left-[4%] top-[18%] h-[38%] w-[7%] rounded-sm bg-[#8e5940]">
				<div className="absolute left-[12%] top-[16%] h-[10%] w-[72%] bg-[#57372f]" />
				<div className="absolute left-[16%] top-[31%] h-[19%] w-[7%] bg-[#d7a84a]" />
				<div className="absolute left-[28%] top-[28%] h-[23%] w-[7%] bg-[#628bb0]" />
				<div className="absolute left-[40%] top-[32%] h-[18%] w-[7%] bg-[#6a9b68]" />
				<div className="absolute left-[52%] top-[29%] h-[21%] w-[7%] bg-[#bb777d]" />
				<div className="absolute left-[64%] top-[30%] h-[20%] w-[7%] bg-[#e0c383]" />
				<div className="absolute left-[12%] top-[57%] h-[10%] w-[72%] bg-[#57372f]" />
			</div>

			<div className="absolute left-[46%] top-[12%] h-[52%] w-[10.5%] rounded-md bg-[#8c6258]">
				<div className="absolute left-[17%] top-[23%] h-[48%] w-[66%] rounded bg-[#3e2a2a]" />
				<div className="absolute left-[42%] top-[42%] h-[28%] w-[18%] rounded-full bg-[#ffb347] shadow-[0_0_36px_rgba(255,177,71,0.58)]" />
				<div className="absolute left-[46%] top-[50%] h-[20%] w-[10%] rounded-full bg-[#ff724d]" />
			</div>

			<div className="absolute left-[13%] top-[60%] h-[25%] w-[13%] rounded-lg bg-[#9a586a]">
				<div className="absolute -top-[21%] left-[6%] h-[43%] w-[88%] rounded-md bg-[#b96c78]" />
				<div className="absolute bottom-[10%] left-[10%] h-[44%] w-[35%] rounded bg-[#c57982]" />
				<div className="absolute bottom-[10%] right-[10%] h-[44%] w-[35%] rounded bg-[#c57982]" />
			</div>

			<div className="absolute left-[35%] top-[58%] h-[32%] w-[10%] rounded-md bg-[#bf814f]">
				<div className="absolute left-[12%] top-[15%] h-[58%] w-[76%] rounded bg-[#d3945b]" />
				<div className="absolute -left-[30%] top-[28%] h-[44%] w-[27%] rounded bg-[#9f6b44]" />
				<div className="absolute -right-[30%] top-[28%] h-[44%] w-[27%] rounded bg-[#9f6b44]" />
				<div className="absolute left-[33%] top-[38%] h-[13%] w-[22%] bg-[#f7dfaf]" />
				<div className="absolute right-[19%] top-[45%] h-[11%] w-[18%] bg-[#f7dfaf]" />
			</div>

			<div className="absolute right-[8%] top-[54%] h-[34%] w-[13%] rounded-md bg-[#80583e]">
				<div className="absolute left-[8%] top-[10%] h-[75%] w-[84%] rounded bg-[#f1d6ad]" />
				<div className="absolute left-[10%] top-[18%] h-[24%] w-[35%] rounded bg-[#fff2d3]" />
				<div className="absolute right-[10%] top-[18%] h-[24%] w-[35%] rounded bg-[#fff2d3]" />
				<div className="absolute bottom-[12%] left-[8%] h-[38%] w-[84%] rounded bg-[#7295a5]" />
			</div>

			<div className="absolute right-[4%] top-[32%] h-[48%] w-[5%]">
				<div className="absolute bottom-0 left-[28%] h-[35%] w-[38%] rounded bg-[#9a6545]" />
				<div className="absolute left-[25%] top-[9%] h-[44%] w-[26%] rotate-[-18deg] rounded-full bg-[#486f4c]" />
				<div className="absolute right-[8%] top-[16%] h-[38%] w-[24%] rotate-[24deg] rounded-full bg-[#77a565]" />
				<div className="absolute left-[2%] top-[31%] h-[34%] w-[32%] rotate-[-35deg] rounded-full bg-[#486f4c]" />
			</div>

			<div className="absolute inset-0 bg-[radial-gradient(circle_at_51%_28%,rgba(255,188,91,0.28),transparent_22%),radial-gradient(circle_at_16%_62%,rgba(255,225,160,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_38%,rgba(30,20,18,0.22))] mix-blend-screen" />
			<div className="absolute inset-0 bg-black/10" />
		</div>
	);
}

export function CottageGame({
	backendBaseUrl,
	roomId,
	socketConnected,
	currentPlayer,
	roomPlayers
}: CottageGameProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const reconnectAttemptRef = useRef(0);
	const playersRef = useRef<Record<string, CottagePlayerSyncState>>({});
	const incomingClockRef = useRef<Record<string, number>>({});
	const remoteActionUntilRef = useRef<Record<string, number>>({});
	const roomPlayersRef = useRef<RoomPlayer[]>(roomPlayers);
	const currentPlayerRef = useRef<CottagePlayerIdentity | null>(currentPlayer);
	const canvasSizeRef = useRef({ width: MAP_WIDTH, height: GAME_HEIGHT, dpr: 1 });
	const cameraXRef = useRef(0);
	const cameraYRef = useRef(ROOM_CROP_TOP);
	const targetRef = useRef<MoveTarget | null>(null);
	const keyboardDirectionRef = useRef('');
	const keysRef = useRef<Set<string>>(new Set());
	const actionUntilRef = useRef(0);
	const lastFrameAtRef = useRef(0);
	const animationFrameRef = useRef<number | null>(null);

	const sendSelfSnapshot = useCallback(() => {
		const self = currentPlayerRef.current;
		if (!self) {
			return;
		}
		if (!playersRef.current[self.id]) {
			return;
		}
		const latestSelf = currentPlayerRef.current;
		const latestSocket = socketRef.current;
		const latestPlayer = latestSelf ? playersRef.current[latestSelf.id] : null;
		if (!latestPlayer || latestSocket?.readyState !== WebSocket.OPEN) {
			return;
		}
		latestSocket.send(
			JSON.stringify({
				type: SyncTypes.CottageSync,
				cottage: {
					players: [latestPlayer],
					updatedAt: latestPlayer.updatedAt
				}
			})
		);
	}, []);

	const requestPeerSnapshots = useCallback(() => {
		const socket = socketRef.current;
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(
			JSON.stringify({
				type: SyncTypes.CottageSync,
				cottage: {
					players: [],
					updatedAt: 0
				}
			})
		);
	}, []);

	useEffect(() => {
		roomPlayersRef.current = roomPlayers;
	}, [roomPlayers]);

	useEffect(() => {
		currentPlayerRef.current = currentPlayer;
		if (!currentPlayer) {
			return;
		}
		const existing = playersRef.current[currentPlayer.id];
		const next = existing
			? {
					...existing,
					name: getDisplayName(currentPlayer),
					...(currentPlayer.profileId ? { profileId: currentPlayer.profileId } : {}),
					updatedAt: Date.now()
				}
			: createDefaultPlayer(currentPlayer);
		playersRef.current = {
			...playersRef.current,
			[currentPlayer.id]: next
		};
		sendSelfSnapshot();
	}, [currentPlayer, sendSelfSnapshot]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}

		const resize = () => {
			const rect = canvas.getBoundingClientRect();
			const width = Math.max(1, rect.width);
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = Math.round(width * dpr);
			canvas.height = Math.round(GAME_HEIGHT * dpr);
			canvasSizeRef.current = { width, height: GAME_HEIGHT, dpr };
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				ctx.imageSmoothingEnabled = false;
			}
		};

		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		window.addEventListener('resize', resize);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', resize);
		};
	}, []);

	useEffect(() => {
		if (!socketConnected || !currentPlayer || !roomId) {
			const socket = socketRef.current;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
			}
			socketRef.current = null;
			return;
		}

		let disposed = false;
		const syncRoom = `cottage:${roomId}`;
		const socketUrl = getBackendWebSocketUrl(
			backendBaseUrl,
			`/sync/${encodeURIComponent(syncRoom)}/${encodeURIComponent(`${currentPlayer.id}-cottage`)}`
		);

		const clearReconnectTimer = () => {
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
		};

		const connect = () => {
			if (disposed) {
				return;
			}
			const existing = socketRef.current;
			if (
				existing &&
				(existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)
			) {
				return;
			}
			clearReconnectTimer();
			const socket = new WebSocket(socketUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				if (socketRef.current !== socket) {
					socket.close();
					return;
				}
				reconnectAttemptRef.current = 0;
				socket.send(JSON.stringify({ type: SyncTypes.NewPlayer }));
				sendSelfSnapshot();
				requestPeerSnapshots();
			};

			socket.onmessage = (event: MessageEvent) => {
				if (socketRef.current !== socket) {
					return;
				}
				let payload: SendPayload;
				try {
					payload = JSON.parse(event.data) as SendPayload;
				} catch (error) {
					console.warn('Ignoring malformed cottage sync payload', error);
					return;
				}
				if (payload.type !== SyncTypes.CottageSync || !payload.cottage) {
					return;
				}
				const incoming = normalizeCottageSyncState(payload.cottage);
				if (incoming.updatedAt === 0) {
					sendSelfSnapshot();
					return;
				}
				const selfId = currentPlayerRef.current?.id;
				const nextPlayers = { ...playersRef.current };
				let changed = false;
				for (const incomingPlayer of incoming.players) {
					if (incomingPlayer.id === selfId) {
						continue;
					}
					const lastIncomingAt = incomingClockRef.current[incomingPlayer.id] ?? 0;
					if (incomingPlayer.updatedAt < lastIncomingAt) {
						continue;
					}
					const existingPlayer = nextPlayers[incomingPlayer.id];
					incomingClockRef.current[incomingPlayer.id] = incomingPlayer.updatedAt;
					const nextPlayer = applyIncomingCottagePlayer(existingPlayer, incomingPlayer, Date.now());
					if (!existingPlayer || hasPlayerChanged(existingPlayer, nextPlayer)) {
						nextPlayers[incomingPlayer.id] = nextPlayer;
						if (shouldAutoStand(nextPlayer)) {
							remoteActionUntilRef.current[nextPlayer.id] = Date.now() + INTERACTION_ACTION_MS;
						} else {
							delete remoteActionUntilRef.current[nextPlayer.id];
						}
						changed = true;
					}
				}
				if (changed) {
					playersRef.current = nextPlayers;
				}
			};

			socket.onerror = () => {
				if (socketRef.current === socket) {
					socket.close();
				}
			};

			socket.onclose = () => {
				if (socketRef.current !== socket) {
					return;
				}
				socketRef.current = null;
				if (disposed) {
					return;
				}
				const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttemptRef.current, 5));
				reconnectAttemptRef.current += 1;
				reconnectTimerRef.current = window.setTimeout(() => {
					reconnectTimerRef.current = null;
					connect();
				}, delay);
			};
		};

		connect();

		return () => {
			disposed = true;
			clearReconnectTimer();
			const socket = socketRef.current;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				if (socket.readyState !== WebSocket.CLOSED) {
					socket.close();
				}
			}
			if (socketRef.current === socket) {
				socketRef.current = null;
			}
		};
	}, [
		backendBaseUrl,
		currentPlayer,
		requestPeerSnapshots,
		roomId,
		sendSelfSnapshot,
		socketConnected
	]);

	const updateSelf = useCallback(
		(deltaSeconds: number) => {
			const selfId = currentPlayerRef.current?.id;
			if (!selfId) {
				return;
			}
			const current = playersRef.current[selfId] ?? createDefaultPlayer(currentPlayerRef.current!);
			let next = current;
			let shouldSend = false;
			const keys = keysRef.current;
			const left = keys.has('arrowleft') || keys.has('a');
			const right = keys.has('arrowright') || keys.has('d');
			const up = keys.has('arrowup') || keys.has('w');
			const down = keys.has('arrowdown') || keys.has('s');
			const moveX = (right ? 1 : 0) - (left ? 1 : 0);
			const moveY = (down ? 1 : 0) - (up ? 1 : 0);
			const hasKeyboardMovement = moveX !== 0 || moveY !== 0;
			const keyboardDirection = hasKeyboardMovement ? `${moveX}:${moveY}` : '';
			const now = Date.now();

			if (
				next.action === 'interacting' &&
				actionUntilRef.current > 0 &&
				now > actionUntilRef.current
			) {
				next = standPlayer(next, now);
				actionUntilRef.current = 0;
				shouldSend = true;
			}

			if (hasKeyboardMovement) {
				if (
					next.action === 'sitting' ||
					next.action === 'sleeping' ||
					next.action === 'interacting'
				) {
					next = standPlayer(next, now);
					actionUntilRef.current = 0;
					shouldSend = true;
				}
				if (keyboardDirectionRef.current !== keyboardDirection || !targetRef.current) {
					const destination = getDirectionalDestination(next, moveX, moveY);
					keyboardDirectionRef.current = keyboardDirection;
					if (distance(next.x, next.y, destination.x, destination.y) >= 5) {
						targetRef.current = destination;
						next = setPlayerMoveTarget(next, destination, now);
						shouldSend = true;
					} else {
						targetRef.current = null;
						if (next.action === 'walking') {
							next = standPlayer(next, now);
							shouldSend = true;
						}
					}
				}
			} else if (keyboardDirectionRef.current) {
				keyboardDirectionRef.current = '';
				if (targetRef.current && !targetRef.current.interactionId) {
					targetRef.current = null;
				}
				if (next.action === 'walking') {
					next = standPlayer(next, now);
					shouldSend = true;
				}
			}

			if (targetRef.current) {
				const activeTarget = targetRef.current;
				const previousAction = next.action;
				next = advancePlayerTowardTarget(next, deltaSeconds, now);
				if (!getMoveTarget(next)) {
					targetRef.current = null;
					if (!hasKeyboardMovement || activeTarget.interactionId) {
						shouldSend = true;
					}
				}
				if (previousAction !== 'interacting' && next.action === 'interacting') {
					actionUntilRef.current = now + INTERACTION_ACTION_MS;
					shouldSend = true;
				}
			} else if (!hasKeyboardMovement && next.action === 'walking') {
				next = standPlayer(next, now);
				shouldSend = true;
			}

			if (hasPlayerChanged(current, next)) {
				playersRef.current = {
					...playersRef.current,
					[selfId]: next
				};
				if (shouldSend) {
					sendSelfSnapshot();
				}
			}
		},
		[sendSelfSnapshot]
	);

	const updateRemotePlayers = useCallback((deltaSeconds: number) => {
		const selfId = currentPlayerRef.current?.id;
		const now = Date.now();
		let nextPlayers: Record<string, CottagePlayerSyncState> | null = null;

		for (const [id, player] of Object.entries(playersRef.current)) {
			if (id === selfId) {
				continue;
			}
			let next = player;
			const autoStandAt = remoteActionUntilRef.current[id];
			if (next.action === 'interacting' && autoStandAt && now > autoStandAt) {
				next = standPlayer(next, now);
				delete remoteActionUntilRef.current[id];
			}

			const previousAction = next.action;
			next = advancePlayerTowardTarget(next, deltaSeconds, now);
			if (previousAction !== 'interacting' && next.action === 'interacting') {
				remoteActionUntilRef.current[id] = now + INTERACTION_ACTION_MS;
			} else if (next.action !== 'interacting') {
				delete remoteActionUntilRef.current[id];
			}

			if (hasPlayerChanged(player, next)) {
				if (!nextPlayers) {
					nextPlayers = { ...playersRef.current };
				}
				nextPlayers[id] = next;
			}
		}

		if (nextPlayers) {
			playersRef.current = nextPlayers;
		}
	}, []);

	useEffect(() => {
		const draw = (time: number) => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext('2d');
			if (!canvas || !ctx) {
				animationFrameRef.current = window.requestAnimationFrame(draw);
				return;
			}
			const previous = lastFrameAtRef.current || time;
			const deltaSeconds = Math.min(0.05, Math.max(0, (time - previous) / 1000));
			lastFrameAtRef.current = time;
			updateSelf(deltaSeconds);
			updateRemotePlayers(deltaSeconds);

			const self = currentPlayerRef.current
				? playersRef.current[currentPlayerRef.current.id]
				: null;
			const size = canvasSizeRef.current;
			const viewWidth = Math.min(MAP_WIDTH, size.width);
			const cameraTarget = self ? self.x - viewWidth / 2 : MAP_WIDTH / 2 - viewWidth / 2;
			cameraXRef.current = clamp(cameraTarget, 0, Math.max(0, MAP_WIDTH - viewWidth));
			const cameraMinY = ROOM_CROP_TOP;
			const cameraMaxY = Math.max(cameraMinY, MAP_HEIGHT - ROOM_CROP_BOTTOM - GAME_HEIGHT);
			const cameraTargetY = self
				? self.y - GAME_HEIGHT / 2
				: cameraMinY + (cameraMaxY - cameraMinY) / 2;
			cameraYRef.current = clamp(cameraTargetY, cameraMinY, cameraMaxY);
			ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
			ctx.imageSmoothingEnabled = false;
			drawScene(
				ctx,
				getVisiblePlayers(playersRef.current, roomPlayersRef.current, currentPlayerRef.current),
				cameraXRef.current,
				cameraYRef.current,
				size.width,
				time
			);
			animationFrameRef.current = window.requestAnimationFrame(draw);
		};

		animationFrameRef.current = window.requestAnimationFrame(draw);
		return () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
		};
	}, [updateRemotePlayers, updateSelf]);

	const focusGame = useCallback(() => {
		wrapperRef.current?.focus();
	}, []);

	const screenToWorld = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return null;
		}
		const rect = canvas.getBoundingClientRect();
		const size = canvasSizeRef.current;
		const mapOffsetX = Math.max(0, (size.width - MAP_WIDTH) / 2);
		return {
			x: clamp(
				event.clientX - rect.left - mapOffsetX + cameraXRef.current,
				FLOOR_BOUNDS.minX,
				FLOOR_BOUNDS.maxX
			),
			y: clamp(
				((event.clientY - rect.top) / rect.height) * GAME_HEIGHT + cameraYRef.current,
				FLOOR_BOUNDS.minY,
				FLOOR_BOUNDS.maxY
			)
		};
	}, []);

	const setTarget = useCallback(
		(target: MoveTarget) => {
			const selfId = currentPlayerRef.current?.id;
			if (!selfId) {
				return;
			}
			const interaction = findInteraction(target.interactionId);
			const targetPoint = interaction ? getInteractionTarget(interaction) : target;
			const walkTarget = isWalkable(targetPoint.x, targetPoint.y)
				? targetPoint
				: {
						...targetPoint,
						x: clamp(targetPoint.x, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX),
						y: clamp(targetPoint.y, FLOOR_BOUNDS.minY, FLOOR_BOUNDS.maxY)
					};
			targetRef.current = walkTarget;
			keyboardDirectionRef.current = '';
			const self = playersRef.current[selfId];
			if (self) {
				const now = Date.now();
				const moveStart =
					self.action === 'sitting' || self.action === 'sleeping' || self.action === 'interacting'
						? standPlayer(self, now)
						: self;
				const next = setPlayerMoveTarget(moveStart, walkTarget, now);
				if (!getMoveTarget(next)) {
					targetRef.current = null;
				}
				actionUntilRef.current = next.action === 'interacting' ? now + INTERACTION_ACTION_MS : 0;
				playersRef.current = {
					...playersRef.current,
					[selfId]: next
				};
				sendSelfSnapshot();
			}
		},
		[sendSelfSnapshot]
	);

	const handlePointerDown = useCallback(
		(event: PointerEvent<HTMLCanvasElement>) => {
			focusGame();
			const point = screenToWorld(event);
			const selfId = currentPlayerRef.current?.id;
			const self = selfId ? playersRef.current[selfId] : null;
			if (!point || !self) {
				return;
			}
			const interaction = findClickedInteraction(point.x, point.y);
			if (interaction) {
				setTarget(getInteractionTarget(interaction));
				return;
			}
			if (isWalkable(point.x, point.y)) {
				setTarget(point);
			}
		},
		[focusGame, screenToWorld, setTarget]
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const key = event.key.toLowerCase();
			const movementKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'];
			if (movementKeys.includes(key)) {
				event.preventDefault();
				keysRef.current.add(key);
				return;
			}
			if (key !== 'e' && key !== ' ' && key !== 'enter') {
				return;
			}
			event.preventDefault();
			const selfId = currentPlayerRef.current?.id;
			const self = selfId ? playersRef.current[selfId] : null;
			if (!self) {
				return;
			}
			if (
				self.action === 'sitting' ||
				self.action === 'sleeping' ||
				self.action === 'interacting'
			) {
				const next = standPlayer(self, Date.now());
				playersRef.current = { ...playersRef.current, [self.id]: next };
				actionUntilRef.current = 0;
				targetRef.current = null;
				keyboardDirectionRef.current = '';
				sendSelfSnapshot();
				return;
			}
			const interaction = findNearestInteraction(self);
			if (interaction) {
				setTarget(getInteractionTarget(interaction));
			}
		},
		[sendSelfSnapshot, setTarget]
	);

	const handleKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
		keysRef.current.delete(event.key.toLowerCase());
	}, []);

	return (
		<div
			ref={wrapperRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onKeyUp={handleKeyUp}
			onBlur={() => {
				keysRef.current.clear();
			}}
			className={COTTAGE_GAME_SURFACE_CLASS_NAME}
			style={{ height: GAME_HEIGHT }}
		>
			<canvas
				ref={canvasRef}
				aria-label="Synced cozy cottage game"
				className="block w-full cursor-pointer select-none"
				style={{ height: GAME_HEIGHT }}
				onPointerDown={handlePointerDown}
			/>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,245,213,0.17),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.08),transparent_32%,rgba(34,24,20,0.16))] mix-blend-screen"
			/>
		</div>
	);
}
