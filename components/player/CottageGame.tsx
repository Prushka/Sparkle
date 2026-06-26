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
const CLUB_LEFT_X = -520;
const CLUB_RIGHT_X = 18;
const WORLD_MIN_X = CLUB_LEFT_X;
const WORLD_MAX_X = MAP_WIDTH;
const WORLD_WIDTH = WORLD_MAX_X - WORLD_MIN_X;
const MAP_HEIGHT = 1188;
const ROOM_CROP_TOP = 28;
const ROOM_CROP_BOTTOM = 8;
const GAME_HEIGHT = 208;
const PLAYER_SPEED = 124;
const PLAYER_RADIUS = 11;
const INTERACTION_CLICK_RADIUS = 24;
const INTERACTION_ACTION_MS = 2500;
const KEYBOARD_SYNC_INTERVAL_MS = 100;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;
const COTTAGE_GAME_SURFACE_CLASS_NAME =
	'relative mx-auto w-full max-w-[90rem] overflow-hidden bg-[#312820] outline-none focus-visible:outline-none';

const BASE_ROOM_BOTTOM_Y = 324;
const ROOM_BOTTOM_Y = 360;
const GARDEN_TOP_Y = ROOM_BOTTOM_Y - 6;
const GARDEN_ITEM_SHIFT = ROOM_BOTTOM_Y - BASE_ROOM_BOTTOM_Y;
const YURT_CENTER_X = 720;
const YURT_CENTER_Y = 880;
const YURT_RADIUS_X = 382;
const YURT_RADIUS_Y = 244;
const YURT_TOP_Y = YURT_CENTER_Y - YURT_RADIUS_Y;
const YURT_BOTTOM_Y = YURT_CENTER_Y + YURT_RADIUS_Y;
const FLOOR_BOUNDS = { minX: CLUB_LEFT_X + 44, maxX: 1396, minY: 116, maxY: YURT_BOTTOM_Y - 22 };
const GARDEN_BEDS = [
	{ x: 154, y: 390 + GARDEN_ITEM_SHIFT },
	{ x: 1008, y: 382 + GARDEN_ITEM_SHIFT }
] as const;

const ROOM_WALL_COLLIDERS: Rect[] = [
	{ x: CLUB_LEFT_X + 18, y: 16, w: CLUB_RIGHT_X - CLUB_LEFT_X, h: 100 },
	{ x: 18, y: 16, w: MAP_WIDTH - 36, h: 100 },
	{ x: CLUB_RIGHT_X - 18, y: 128, w: 18, h: 90 },
	{ x: CLUB_RIGHT_X - 18, y: 330, w: 18, h: ROOM_BOTTOM_Y - 330 },
	{ x: 18, y: ROOM_BOTTOM_Y - 20, w: 630, h: 12 },
	{ x: 792, y: ROOM_BOTTOM_Y - 20, w: MAP_WIDTH - 810, h: 12 },
	{ x: MAP_WIDTH - 28, y: 128, w: 10, h: ROOM_BOTTOM_Y - 128 }
];

const YURT_WALL_COLLIDERS: Rect[] = [
	{ x: YURT_CENTER_X - YURT_RADIUS_X + 28, y: YURT_TOP_Y + 86, w: 36, h: 330 },
	{ x: YURT_CENTER_X + YURT_RADIUS_X - 64, y: YURT_TOP_Y + 86, w: 36, h: 330 },
	{ x: YURT_CENTER_X - YURT_RADIUS_X + 70, y: YURT_TOP_Y + 12, w: 238, h: 34 },
	{ x: YURT_CENTER_X + 74, y: YURT_TOP_Y + 12, w: 238, h: 34 },
	{ x: YURT_CENTER_X - 250, y: YURT_BOTTOM_Y - 66, w: 500, h: 36 },
	{ x: YURT_CENTER_X - YURT_RADIUS_X + 70, y: YURT_BOTTOM_Y - 130, w: 106, h: 52 },
	{ x: YURT_CENTER_X + YURT_RADIUS_X - 176, y: YURT_BOTTOM_Y - 130, w: 106, h: 52 }
];

// Include front strips and legs so Y-sorted furniture never clips a walking player.
const FURNITURE_COLLIDERS: Rect[] = [
	{ x: -486, y: 62, w: 106, h: 64 },
	{ x: -472, y: 170, w: 98, h: 50 },
	{ x: -462, y: 274, w: 122, h: 30 },
	{ x: -300, y: 66, w: 68, h: 78 },
	{ x: -252, y: 224, w: 92, h: 38 },
	{ x: -110, y: 72, w: 82, h: 68 },
	{ x: -112, y: 288, w: 96, h: 28 },
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
	{ x: 1328, y: 116, w: 54, h: 92 },
	{ x: 154, y: 390 + GARDEN_ITEM_SHIFT, w: 220, h: 78 },
	{ x: 1008, y: 382 + GARDEN_ITEM_SHIFT, w: 220, h: 78 },
	{ x: 408, y: 382 + GARDEN_ITEM_SHIFT, w: 224, h: 86 },
	{ x: 1248, y: 424 + GARDEN_ITEM_SHIFT, w: 44, h: 74 },
	{ x: 520, y: 742, w: 84, h: 50 },
	{ x: 880, y: 900, w: 166, h: 62 },
	{ x: 898, y: 730, w: 164, h: 84 },
	{ x: 438, y: 846, w: 122, h: 58 },
	{ x: 828, y: 982, w: 168, h: 58 }
];

const COLLIDERS: Rect[] = [...ROOM_WALL_COLLIDERS, ...YURT_WALL_COLLIDERS, ...FURNITURE_COLLIDERS];

const INTERACTIONS: CottageInteraction[] = [
	{
		id: 'club-lounge',
		x: -480,
		y: 164,
		w: 130,
		h: 76,
		anchorX: -418,
		anchorY: 214,
		targetX: -418,
		targetY: 254,
		facing: 'down',
		action: 'sitting',
		radius: 60,
		sortY: 258
	},
	{
		id: 'club-stage',
		x: -464,
		y: 258,
		w: 160,
		h: 64,
		anchorX: -386,
		anchorY: 302,
		targetX: -386,
		targetY: 336,
		facing: 'up',
		action: 'interacting',
		radius: 68,
		sortY: 326
	},
	{
		id: 'club-cross',
		x: -306,
		y: 58,
		w: 98,
		h: 108,
		anchorX: -256,
		anchorY: 162,
		targetX: -256,
		targetY: 184,
		facing: 'up',
		action: 'sitting',
		radius: 64,
		sortY: 172
	},
	{
		id: 'club-swing',
		x: -286,
		y: 184,
		w: 158,
		h: 100,
		anchorX: -214,
		anchorY: 250,
		targetX: -204,
		targetY: 314,
		facing: 'up',
		action: 'sitting',
		radius: 72,
		sortY: 286
	},
	{
		id: 'club-rack',
		x: -124,
		y: 66,
		w: 114,
		h: 94,
		anchorX: -66,
		anchorY: 164,
		targetX: -66,
		targetY: 184,
		facing: 'up',
		action: 'interacting',
		radius: 62,
		sortY: 166
	},
	{
		id: 'club-bench',
		x: -130,
		y: 276,
		w: 132,
		h: 58,
		anchorX: -66,
		anchorY: 316,
		targetX: -64,
		targetY: 338,
		facing: 'up',
		action: 'sitting',
		radius: 58,
		sortY: 342
	},
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
		targetX: 1324,
		targetY: 232,
		facing: 'up',
		action: 'interacting',
		radius: 54,
		sortY: 216
	},
	{
		id: 'garden-bed',
		x: 148,
		y: 384 + GARDEN_ITEM_SHIFT,
		w: 232,
		h: 90,
		anchorX: 264,
		anchorY: 426 + GARDEN_ITEM_SHIFT,
		targetX: 264,
		targetY: Math.min(FLOOR_BOUNDS.maxY, 488 + GARDEN_ITEM_SHIFT),
		facing: 'up',
		action: 'interacting',
		radius: 74,
		sortY: 474 + GARDEN_ITEM_SHIFT
	},
	{
		id: 'garden-pond',
		x: 402,
		y: 376 + GARDEN_ITEM_SHIFT,
		w: 236,
		h: 98,
		anchorX: 520,
		anchorY: 430 + GARDEN_ITEM_SHIFT,
		targetX: 520,
		targetY: Math.min(FLOOR_BOUNDS.maxY, 492 + GARDEN_ITEM_SHIFT),
		facing: 'up',
		action: 'interacting',
		radius: 76,
		sortY: 476 + GARDEN_ITEM_SHIFT
	},
	{
		id: 'garden-tree',
		x: 1216,
		y: 356 + GARDEN_ITEM_SHIFT,
		w: 120,
		h: 152,
		anchorX: 1270,
		anchorY: 456 + GARDEN_ITEM_SHIFT,
		targetX: 1320,
		targetY: 482 + GARDEN_ITEM_SHIFT,
		facing: 'left',
		action: 'interacting',
		radius: 78,
		sortY: 512 + GARDEN_ITEM_SHIFT
	},
	{
		id: 'yurt-hearth',
		x: 512,
		y: 728,
		w: 112,
		h: 86,
		anchorX: 660,
		anchorY: 782,
		targetX: 660,
		targetY: 782,
		facing: 'left',
		action: 'interacting',
		radius: 96,
		sortY: 798
	},
	{
		id: 'yurt-table',
		x: 866,
		y: 888,
		w: 186,
		h: 92,
		anchorX: 824,
		anchorY: 970,
		targetX: 824,
		targetY: 970,
		facing: 'right',
		action: 'sitting',
		radius: 100,
		sortY: 980
	},
	{
		id: 'yurt-bed',
		x: 890,
		y: 716,
		w: 184,
		h: 122,
		anchorX: 980,
		anchorY: 790,
		targetX: 842,
		targetY: 794,
		facing: 'right',
		action: 'sleeping',
		radius: 98,
		sortY: 846
	},
	{
		id: 'yurt-chest',
		x: 426,
		y: 838,
		w: 146,
		h: 86,
		anchorX: 612,
		anchorY: 894,
		targetX: 612,
		targetY: 894,
		facing: 'left',
		action: 'interacting',
		radius: 88,
		sortY: 924
	},
	{
		id: 'yurt-dombra',
		x: 452,
		y: 938,
		w: 150,
		h: 108,
		anchorX: 616,
		anchorY: 992,
		targetX: 616,
		targetY: 992,
		facing: 'left',
		action: 'interacting',
		radius: 92,
		sortY: 1010
	},
	{
		id: 'yurt-loom',
		x: 820,
		y: 972,
		w: 184,
		h: 110,
		anchorX: 782,
		anchorY: 1020,
		targetX: 782,
		targetY: 1020,
		facing: 'right',
		action: 'interacting',
		radius: 96,
		sortY: 1060
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
	if (x < CLUB_RIGHT_X && y > ROOM_BOTTOM_Y - PLAYER_RADIUS) {
		return false;
	}
	return !COLLIDERS.some((collider) => isPointInRect(x, y, collider, PLAYER_RADIUS));
}

function findNearestWalkablePoint(x: number, y: number) {
	if (isWalkable(x, y)) {
		return { x, y };
	}
	const radii = [12, 24, 36, 52, 72, 96];
	for (const radius of radii) {
		const steps = Math.max(8, Math.ceil((Math.PI * 2 * radius) / 16));
		for (let step = 0; step < steps; step += 1) {
			const angle = (Math.PI * 2 * step) / steps;
			const candidateX = clamp(x + Math.cos(angle) * radius, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX);
			const candidateY = clamp(y + Math.sin(angle) * radius, FLOOR_BOUNDS.minY, FLOOR_BOUNDS.maxY);
			if (isWalkable(candidateX, candidateY)) {
				return { x: candidateX, y: candidateY };
			}
		}
	}
	return null;
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

function getSafeInteractionExit(interaction: CottageInteraction): MoveTarget {
	const target = getInteractionTarget(interaction);
	if (isWalkable(target.x, target.y)) {
		return target;
	}
	const offsets = [
		[0, -26],
		[0, 26],
		[-28, 0],
		[28, 0],
		[-28, -24],
		[28, -24],
		[-28, 24],
		[28, 24],
		[0, -52],
		[0, 52]
	] as const;
	for (const [dx, dy] of offsets) {
		const x = clamp(target.x + dx, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX);
		const y = clamp(target.y + dy, FLOOR_BOUNDS.minY, FLOOR_BOUNDS.maxY);
		if (isWalkable(x, y)) {
			return { x, y, interactionId: interaction.id };
		}
	}
	return target;
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
	const exitTarget = interaction ? getSafeInteractionExit(interaction) : null;
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
	const start = findNearestWalkablePoint(player.x, player.y) ?? { x: player.x, y: player.y };
	let x = start.x;
	let y = start.y;
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

function movePlayerWithKeyboard(
	player: CottagePlayerSyncState,
	moveX: number,
	moveY: number,
	deltaSeconds: number,
	updatedAt: number
): CottagePlayerSyncState {
	const magnitude = Math.hypot(moveX, moveY) || 1;
	const dx = (moveX / magnitude) * PLAYER_SPEED * deltaSeconds;
	const dy = (moveY / magnitude) * PLAYER_SPEED * deltaSeconds;
	const moved = moveWithCollision(player, dx, dy);
	const didMove = moved.x !== player.x || moved.y !== player.y;
	return {
		...player,
		...moved,
		action: didMove ? 'walking' : 'idle',
		facing: getFacingFromDelta(moveX, moveY, player.facing),
		interactionId: undefined,
		targetX: undefined,
		targetY: undefined,
		updatedAt
	};
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

function drawClubRoom(ctx: CanvasRenderingContext2D, time: number) {
	const pulse = 0.62 + Math.sin(time / 190) * 0.18;
	const wallGradient = ctx.createLinearGradient(CLUB_LEFT_X, 22, CLUB_RIGHT_X, 128);
	wallGradient.addColorStop(0, '#17151b');
	wallGradient.addColorStop(0.52, '#262029');
	wallGradient.addColorStop(1, '#111217');
	fillRoundedRect(
		ctx,
		CLUB_LEFT_X + 18,
		16,
		CLUB_RIGHT_X - CLUB_LEFT_X,
		ROOM_BOTTOM_Y + 10,
		8,
		'#151016'
	);
	ctx.fillStyle = wallGradient;
	ctx.fillRect(CLUB_LEFT_X + 28, 28, CLUB_RIGHT_X - CLUB_LEFT_X - 18, 96);
	ctx.fillStyle = '#4d1d2b';
	ctx.fillRect(CLUB_LEFT_X + 28, 118, CLUB_RIGHT_X - CLUB_LEFT_X - 18, 10);
	ctx.fillStyle = 'rgba(20, 20, 28, 0.72)';
	for (let x = CLUB_LEFT_X + 62; x < CLUB_RIGHT_X - 38; x += 28) {
		ctx.fillRect(x, 34, 3, 88);
	}
	ctx.strokeStyle = 'rgba(207, 208, 220, 0.24)';
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (let x = CLUB_LEFT_X + 76; x < CLUB_RIGHT_X - 46; x += 64) {
		ctx.moveTo(x, 34);
		ctx.lineTo(x, 118);
	}
	ctx.stroke();
	const floorGradient = ctx.createLinearGradient(0, 128, 0, ROOM_BOTTOM_Y);
	floorGradient.addColorStop(0, '#3a3038');
	floorGradient.addColorStop(1, '#16151a');
	ctx.fillStyle = floorGradient;
	ctx.fillRect(CLUB_LEFT_X + 28, 128, CLUB_RIGHT_X - CLUB_LEFT_X - 18, ROOM_BOTTOM_Y - 128);
	for (let y = 134; y < ROOM_BOTTOM_Y; y += 20) {
		ctx.fillStyle = y % 40 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(115,22,55,0.20)';
		ctx.fillRect(CLUB_LEFT_X + 34, y, CLUB_RIGHT_X - CLUB_LEFT_X - 32, 2);
		for (let x = CLUB_LEFT_X + 42 + ((y / 20) % 3) * 28; x < CLUB_RIGHT_X - 34; x += 92) {
			ctx.fillStyle = 'rgba(0,0,0,0.24)';
			ctx.fillRect(x, y - 18, 2, 18);
		}
	}

	fillRoundedRect(ctx, -492, 54, 128, 76, 7, '#31212b');
	ctx.fillStyle = '#0d0d12';
	ctx.fillRect(-482, 62, 108, 58);
	ctx.fillStyle = '#f23f7d';
	ctx.font = '800 13px Inter, ui-sans-serif, system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('BERLIN XXX', -428, 82);
	ctx.strokeStyle = `rgba(242, 63, 125, ${pulse})`;
	ctx.lineWidth = 3;
	roundedRect(ctx, -478, 66, 100, 38, 5);
	ctx.stroke();
	ctx.fillStyle = '#68d4ff';
	ctx.font = '700 10px Inter, ui-sans-serif, system-ui, sans-serif';
	ctx.fillText('18+ NACHT', -428, 104);

	fillRoundedRect(ctx, -488, 172, 140, 60, 12, '#4d1f31');
	fillRoundedRect(ctx, -474, 160, 112, 36, 10, '#7a3150');
	fillRoundedRect(ctx, -468, 204, 48, 34, 8, '#913a5c');
	fillRoundedRect(ctx, -404, 204, 48, 34, 8, '#913a5c');
	ctx.fillStyle = '#25131c';
	ctx.fillRect(-462, 232, 16, 10);
	ctx.fillRect(-378, 232, 16, 10);
	ctx.strokeStyle = '#c9cad5';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-472, 184, 7, 0, Math.PI * 2);
	ctx.arc(-364, 184, 7, 0, Math.PI * 2);
	ctx.moveTo(-465, 184);
	ctx.lineTo(-371, 184);
	ctx.stroke();
	ctx.strokeStyle = '#231019';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(-468, 176);
	ctx.lineTo(-356, 176);
	ctx.moveTo(-462, 214);
	ctx.lineTo(-356, 214);
	ctx.stroke();
	fillRoundedRect(ctx, -348, 196, 22, 40, 6, '#21141d');
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-337, 206, 6, 0, Math.PI * 2);
	ctx.arc(-337, 225, 6, 0, Math.PI * 2);
	ctx.moveTo(-337, 212);
	ctx.lineTo(-337, 219);
	ctx.stroke();
	ctx.strokeStyle = '#8b2f4f';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.moveTo(-482, 218);
	ctx.bezierCurveTo(-500, 214, -502, 190, -478, 184);
	ctx.stroke();

	fillRoundedRect(ctx, -462, 272, 132, 34, 11, '#24171f');
	fillRoundedRect(ctx, -446, 260, 112, 22, 8, '#503045');
	ctx.fillStyle = '#ef3d75';
	for (let i = 0; i < 7; i += 1) {
		drawEllipse(ctx, -436 + i * 16, 298 + Math.sin(time / 260 + i) * 2, 5, 4, '#ef3d75');
	}
	ctx.fillStyle = '#0f1015';
	ctx.fillRect(-392, 224, 10, 74);
	ctx.fillStyle = '#dadce8';
	ctx.fillRect(-389, 222, 4, 78);
	ctx.strokeStyle = `rgba(239, 61, 117, ${pulse})`;
	ctx.lineWidth = 2;
	roundedRect(ctx, -458, 268, 124, 36, 10);
	ctx.stroke();
	ctx.fillStyle = '#21141d';
	fillRoundedRect(ctx, -458, 308, 18, 12, 4, '#21141d');
	fillRoundedRect(ctx, -354, 308, 18, 12, 4, '#21141d');
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-449, 314, 5, 0, Math.PI * 2);
	ctx.arc(-345, 314, 5, 0, Math.PI * 2);
	ctx.stroke();

	ctx.strokeStyle = '#5c6273';
	ctx.lineWidth = 7;
	ctx.beginPath();
	ctx.moveTo(-260, 74);
	ctx.lineTo(-302, 142);
	ctx.moveTo(-218, 74);
	ctx.lineTo(-268, 148);
	ctx.stroke();
	ctx.strokeStyle = '#1f2028';
	ctx.lineWidth = 14;
	ctx.beginPath();
	ctx.moveTo(-286, 70);
	ctx.lineTo(-224, 150);
	ctx.moveTo(-218, 72);
	ctx.lineTo(-294, 148);
	ctx.stroke();
	ctx.fillStyle = '#3c4250';
	ctx.fillRect(-300, 66, 92, 10);
	ctx.fillRect(-300, 146, 92, 10);
	ctx.fillStyle = '#a4a9b8';
	ctx.fillRect(-256, 54, 14, 112);
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	for (const [x, y] of [
		[-294, 78],
		[-212, 78],
		[-292, 148],
		[-214, 148]
	] as const) {
		ctx.beginPath();
		ctx.arc(x, y, 8, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = '#7f243f';
		fillRoundedRect(ctx, x - 9, y - 3, 18, 6, 3, '#7f243f');
	}
	ctx.strokeStyle = '#8b90a0';
	ctx.lineWidth = 2;
	for (let y = 86; y <= 128; y += 21) {
		ctx.beginPath();
		ctx.moveTo(-258, y);
		ctx.lineTo(-286, y - 8);
		ctx.moveTo(-242, y + 8);
		ctx.lineTo(-216, y + 1);
		ctx.stroke();
	}
	ctx.fillStyle = '#151016';
	fillRoundedRect(ctx, -272, 102, 34, 22, 8, '#151016');
	ctx.strokeStyle = '#c6c8d2';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-255, 112, 11, 0, Math.PI * 2);
	ctx.stroke();
	ctx.fillStyle = '#7f243f';
	for (const [x, y] of [
		[-294, 94],
		[-214, 94],
		[-292, 134],
		[-216, 134]
	] as const) {
		fillRoundedRect(ctx, x - 10, y - 3, 20, 6, 3, '#7f243f');
		ctx.fillStyle = '#d0b05f';
		ctx.fillRect(x - 2, y - 5, 4, 10);
	}

	ctx.strokeStyle = '#525869';
	ctx.lineWidth = 5;
	ctx.beginPath();
	ctx.moveTo(-250, 188);
	ctx.lineTo(-236, 250);
	ctx.moveTo(-150, 188);
	ctx.lineTo(-166, 250);
	ctx.stroke();
	ctx.strokeStyle = '#b5b8c4';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(-232, 172);
	ctx.lineTo(-232, 234);
	ctx.moveTo(-174, 172);
	ctx.lineTo(-174, 234);
	ctx.stroke();
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	for (const [x, y] of [
		[-236, 182],
		[-170, 182],
		[-246, 254],
		[-160, 254]
	] as const) {
		ctx.beginPath();
		ctx.arc(x, y, 6, 0, Math.PI * 2);
		ctx.stroke();
	}
	fillRoundedRect(ctx, -248, 236, 94, 30, 12, '#642a43');
	fillRoundedRect(ctx, -236, 242, 70, 14, 6, '#a74468');
	ctx.strokeStyle = '#22151d';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(-244, 246);
	ctx.lineTo(-158, 246);
	ctx.moveTo(-226, 236);
	ctx.lineTo(-212, 266);
	ctx.moveTo(-182, 236);
	ctx.lineTo(-196, 266);
	ctx.stroke();
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-224, 272, 8, 0, Math.PI * 2);
	ctx.arc(-180, 272, 8, 0, Math.PI * 2);
	ctx.moveTo(-224, 264);
	ctx.lineTo(-236, 286);
	ctx.moveTo(-180, 264);
	ctx.lineTo(-166, 286);
	ctx.stroke();
	ctx.strokeStyle = '#8b2f4f';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.moveTo(-248, 236);
	ctx.bezierCurveTo(-238, 282, -164, 282, -154, 236);
	ctx.stroke();

	fillRoundedRect(ctx, -124, 66, 112, 96, 6, '#252333');
	ctx.fillStyle = '#4f5264';
	ctx.fillRect(-114, 82, 92, 5);
	ctx.fillRect(-114, 112, 92, 5);
	ctx.fillRect(-114, 142, 92, 5);
	ctx.strokeStyle = '#c6c8d2';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-104, 98, 7, 0, Math.PI * 2);
	ctx.arc(-88, 98, 7, 0, Math.PI * 2);
	ctx.moveTo(-97, 98);
	ctx.lineTo(-95, 98);
	ctx.stroke();
	fillRoundedRect(ctx, -72, 88, 10, 28, 5, '#8b2f4f');
	drawEllipse(ctx, -67, 84, 10, 6, '#8b2f4f');
	ctx.strokeStyle = '#d0b05f';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(-46, 88);
	ctx.lineTo(-46, 116);
	for (let i = 0; i < 5; i += 1) {
		ctx.moveTo(-46, 98);
		ctx.lineTo(-58 + i * 6, 118);
	}
	ctx.stroke();
	ctx.strokeStyle = '#2f85a3';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.arc(-102, 130, 14, 0.25, Math.PI * 1.75);
	ctx.stroke();
	ctx.fillStyle = '#c6c8d2';
	for (let i = 0; i < 3; i += 1) {
		ctx.fillRect(-76 + i * 14, 124, 5, 24);
		drawEllipse(ctx, -74 + i * 14, 148, 5, 3, '#c6c8d2');
	}
	ctx.strokeStyle = '#8b2f4f';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(-36, 130, 11, 0, Math.PI * 2);
	ctx.stroke();
	ctx.fillStyle = '#151016';
	fillRoundedRect(ctx, -28, 90, 10, 30, 5, '#151016');
	drawEllipse(ctx, -23, 88, 7, 9, '#151016');
	fillRoundedRect(ctx, -31, 118, 16, 5, 3, '#151016');
	ctx.fillStyle = '#2f85a3';
	ctx.beginPath();
	ctx.moveTo(-28, 140);
	ctx.quadraticCurveTo(-18, 126, -8, 140);
	ctx.quadraticCurveTo(-12, 154, -24, 154);
	ctx.closePath();
	ctx.fill();
	drawEllipse(ctx, -18, 158, 17, 4, '#2f85a3');
	ctx.strokeStyle = '#d0b05f';
	ctx.lineWidth = 2;
	for (let i = 0; i < 3; i += 1) {
		ctx.beginPath();
		ctx.arc(-110 + i * 12, 150, 6 + i * 2, 0.2, Math.PI * 1.8);
		ctx.stroke();
	}
	ctx.strokeStyle = '#8b2f4f';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(-58, 124);
	ctx.lineTo(-38, 148);
	ctx.moveTo(-38, 124);
	ctx.lineTo(-58, 148);
	ctx.stroke();

	fillRoundedRect(ctx, -128, 288, 120, 30, 9, '#32202b');
	fillRoundedRect(ctx, -116, 276, 96, 24, 8, '#7b3150');
	ctx.strokeStyle = '#22151d';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(-112, 288);
	ctx.lineTo(-22, 288);
	ctx.moveTo(-92, 276);
	ctx.lineTo(-76, 300);
	ctx.moveTo(-54, 276);
	ctx.lineTo(-38, 300);
	ctx.stroke();
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	for (const x of [-116, -18]) {
		ctx.beginPath();
		ctx.arc(x, 286, 6, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.fillStyle = '#151016';
	ctx.fillRect(-112, 318, 14, 10);
	ctx.fillRect(-34, 318, 14, 10);
	fillRoundedRect(ctx, -118, 320, 28, 18, 7, '#24171f');
	fillRoundedRect(ctx, -42, 320, 28, 18, 7, '#24171f');
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	for (const [x, y] of [
		[-104, 328],
		[-28, 328],
		[-116, 296],
		[-18, 296]
	] as const) {
		ctx.beginPath();
		ctx.arc(x, y, 6, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.strokeStyle = '#8b2f4f';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.moveTo(-116, 284);
	ctx.lineTo(-20, 306);
	ctx.moveTo(-116, 304);
	ctx.lineTo(-20, 282);
	ctx.stroke();

	ctx.fillStyle = 'rgba(104, 212, 255, 0.18)';
	for (let i = 0; i < 10; i += 1) {
		ctx.fillRect(CLUB_LEFT_X + 54 + i * 46, 42, 18, 70);
	}
	ctx.strokeStyle = 'rgba(242, 63, 125, 0.34)';
	ctx.lineWidth = 2;
	for (let x = CLUB_LEFT_X + 40; x < CLUB_RIGHT_X - 42; x += 38) {
		ctx.beginPath();
		ctx.moveTo(x, 128);
		ctx.lineTo(x + Math.sin(time / 360 + x) * 4, 356);
		ctx.stroke();
	}

	ctx.fillStyle = '#2f2630';
	ctx.fillRect(CLUB_RIGHT_X - 18, 132, 18, ROOM_BOTTOM_Y - 132);
	fillRoundedRect(ctx, CLUB_RIGHT_X - 18, 230, 38, 96, 8, '#5a3e34');
	ctx.fillStyle = '#241d1b';
	ctx.fillRect(CLUB_RIGHT_X - 10, 240, 22, 74);
}

function drawGardenGround(ctx: CanvasRenderingContext2D) {
	const grassGradient = ctx.createLinearGradient(0, GARDEN_TOP_Y, 0, MAP_HEIGHT - 18);
	grassGradient.addColorStop(0, '#4f774c');
	grassGradient.addColorStop(1, '#304f38');
	fillRoundedRect(
		ctx,
		18,
		GARDEN_TOP_Y,
		MAP_WIDTH - 36,
		MAP_HEIGHT - GARDEN_TOP_Y - 10,
		8,
		'#36553c'
	);
	ctx.fillStyle = grassGradient;
	ctx.fillRect(28, GARDEN_TOP_Y + 8, MAP_WIDTH - 56, MAP_HEIGHT - GARDEN_TOP_Y - 36);

	ctx.fillStyle = '#88674a';
	for (let x = 36; x < MAP_WIDTH - 36; x += 34) {
		if (x > 642 && x < 798) {
			continue;
		}
		fillRoundedRect(ctx, x, GARDEN_TOP_Y + 12, 10, 34, 3, '#8e6c4d');
	}
	ctx.fillStyle = '#6b4f3e';
	ctx.fillRect(38, GARDEN_TOP_Y + 26, 606, 7);
	ctx.fillRect(796, GARDEN_TOP_Y + 26, MAP_WIDTH - 834, 7);

	ctx.fillStyle = 'rgba(255, 241, 180, 0.12)';
	for (let y = GARDEN_TOP_Y + 20; y < MAP_HEIGHT - 30; y += 18) {
		for (let x = 48 + ((y / 18) % 4) * 30; x < MAP_WIDTH - 48; x += 118) {
			ctx.fillRect(x, y, 2, 8);
			ctx.fillRect(x + 3, y + 3, 2, 6);
		}
	}

	const flowerColors = ['#f4cf63', '#e6877e', '#d9a6d8', '#f3f0c5'];
	for (let i = 0; i < 32; i += 1) {
		const x = 70 + ((i * 173) % 1290);
		const y = GARDEN_TOP_Y + 44 + ((i * 47) % 164);
		if (x > 410 && x < 640 && y > 370 + GARDEN_ITEM_SHIFT && y < 500 + GARDEN_ITEM_SHIFT) {
			continue;
		}
		ctx.fillStyle = '#345f38';
		ctx.fillRect(x, y + 4, 2, 6);
		ctx.fillStyle = flowerColors[i % flowerColors.length];
		ctx.fillRect(x - 2, y, 3, 3);
		ctx.fillRect(x + 2, y + 1, 3, 3);
	}
}

function drawGardenPath(ctx: CanvasRenderingContext2D) {
	const pathStartY = ROOM_BOTTOM_Y - 24;
	const pathBottomY = YURT_TOP_Y + 8;
	const innerPathStartY = ROOM_BOTTOM_Y - 14;
	const innerPathBottomY = YURT_TOP_Y + 4;
	const pathGradient = ctx.createLinearGradient(0, pathStartY, 0, pathBottomY);
	pathGradient.addColorStop(0, '#ba9367');
	pathGradient.addColorStop(1, '#80624d');
	fillRoundedRect(ctx, 660, pathStartY, 120, pathBottomY - pathStartY, 16, '#8c6a4f');
	ctx.fillStyle = pathGradient;
	ctx.fillRect(674, innerPathStartY, 92, innerPathBottomY - innerPathStartY);
	ctx.fillStyle = '#d2b37f';
	for (let y = ROOM_BOTTOM_Y + 6; y < pathBottomY - 38; y += 36) {
		fillRoundedRect(ctx, 686 + ((y / 36) % 2) * 16, y, 44, 14, 7, '#d2b37f');
		fillRoundedRect(ctx, 742 - ((y / 36) % 2) * 16, y + 14, 34, 12, 6, '#ba9367');
	}
	fillRoundedRect(ctx, 648, ROOM_BOTTOM_Y - 28, 144, 18, 6, '#6b4a38');
	ctx.fillStyle = '#e0b87d';
	ctx.fillRect(674, ROOM_BOTTOM_Y - 20, 92, 5);
	fillRoundedRect(ctx, YURT_CENTER_X - 92, YURT_TOP_Y - 10, 184, 20, 8, '#6b4a38');
	ctx.fillStyle = '#e0b87d';
	ctx.fillRect(YURT_CENTER_X - 62, YURT_TOP_Y - 4, 124, 5);
}

function drawYurtShell(ctx: CanvasRenderingContext2D, time: number) {
	drawEllipse(
		ctx,
		YURT_CENTER_X,
		YURT_CENTER_Y + 12,
		YURT_RADIUS_X + 18,
		YURT_RADIUS_Y + 14,
		'rgba(36, 24, 18, 0.24)'
	);
	drawEllipse(ctx, YURT_CENTER_X, YURT_CENTER_Y, YURT_RADIUS_X, YURT_RADIUS_Y, '#8b6745');
	drawEllipse(
		ctx,
		YURT_CENTER_X,
		YURT_CENTER_Y - 8,
		YURT_RADIUS_X - 18,
		YURT_RADIUS_Y - 18,
		'#ead7aa'
	);
	ctx.save();
	ctx.beginPath();
	ctx.ellipse(
		YURT_CENTER_X,
		YURT_CENTER_Y - 8,
		YURT_RADIUS_X - 42,
		YURT_RADIUS_Y - 44,
		0,
		0,
		Math.PI * 2
	);
	ctx.clip();
	ctx.fillStyle = '#d9bf86';
	ctx.fillRect(YURT_CENTER_X - YURT_RADIUS_X, YURT_TOP_Y, YURT_RADIUS_X * 2, YURT_RADIUS_Y * 2);
	ctx.fillStyle = 'rgba(255,255,255,0.16)';
	for (let y = YURT_TOP_Y + 62; y < YURT_BOTTOM_Y - 48; y += 38) {
		ctx.fillRect(YURT_CENTER_X - 310, y, 620, 3);
	}
	ctx.strokeStyle = 'rgba(118, 78, 46, 0.42)';
	ctx.lineWidth = 3;
	for (let i = 0; i < 24; i += 1) {
		const angle = (Math.PI * 2 * i) / 24 + 0.05;
		ctx.beginPath();
		ctx.moveTo(YURT_CENTER_X, YURT_CENTER_Y - 132);
		ctx.lineTo(
			YURT_CENTER_X + Math.cos(angle) * (YURT_RADIUS_X - 76),
			YURT_CENTER_Y - 12 + Math.sin(angle) * (YURT_RADIUS_Y - 72)
		);
		ctx.stroke();
	}
	drawEllipse(ctx, YURT_CENTER_X, YURT_CENTER_Y + 20, 154, 86, '#9f3f46');
	drawEllipse(ctx, YURT_CENTER_X, YURT_CENTER_Y + 18, 126, 68, '#1e6f78');
	drawEllipse(ctx, YURT_CENTER_X, YURT_CENTER_Y + 16, 82, 42, '#d6b35d');
	ctx.strokeStyle = '#f3ddb1';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.ellipse(YURT_CENTER_X, YURT_CENTER_Y + 18, 116, 58, 0, 0, Math.PI * 2);
	ctx.stroke();
	ctx.fillStyle = '#f3ddb1';
	for (let i = 0; i < 14; i += 1) {
		const x = YURT_CENTER_X - 138 + i * 22;
		ctx.fillRect(x, YURT_CENTER_Y - 52, 10, 12);
		ctx.fillRect(x, YURT_CENTER_Y + 82, 10, 12);
	}
	ctx.restore();

	ctx.strokeStyle = '#6d4a30';
	ctx.lineWidth = 10;
	ctx.beginPath();
	ctx.ellipse(
		YURT_CENTER_X,
		YURT_CENTER_Y,
		YURT_RADIUS_X - 10,
		YURT_RADIUS_Y - 10,
		0,
		0,
		Math.PI * 2
	);
	ctx.stroke();
	ctx.strokeStyle = '#d0a85a';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.ellipse(
		YURT_CENTER_X,
		YURT_CENTER_Y,
		YURT_RADIUS_X - 34,
		YURT_RADIUS_Y - 34,
		0,
		0,
		Math.PI * 2
	);
	ctx.stroke();

	drawEllipse(ctx, YURT_CENTER_X, YURT_CENTER_Y - 132, 62, 36, '#a75736');
	ctx.strokeStyle = '#f1d18a';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.ellipse(YURT_CENTER_X, YURT_CENTER_Y - 132, 44, 24, 0, 0, Math.PI * 2);
	ctx.moveTo(YURT_CENTER_X - 36, YURT_CENTER_Y - 132);
	ctx.lineTo(YURT_CENTER_X + 36, YURT_CENTER_Y - 132);
	ctx.moveTo(YURT_CENTER_X, YURT_CENTER_Y - 156);
	ctx.lineTo(YURT_CENTER_X, YURT_CENTER_Y - 108);
	ctx.stroke();

	fillRoundedRect(ctx, YURT_CENTER_X - 86, YURT_TOP_Y + 4, 172, 64, 22, '#8c6a4f');
	fillRoundedRect(ctx, YURT_CENTER_X - 66, YURT_TOP_Y + 14, 132, 48, 16, '#c79b62');
	ctx.fillStyle = '#4e3829';
	ctx.fillRect(YURT_CENTER_X - 4, YURT_TOP_Y + 16, 8, 44);
	ctx.strokeStyle = `rgba(241, 209, 138, ${0.6 + Math.sin(time / 240) * 0.18})`;
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(YURT_CENTER_X - 54, YURT_TOP_Y + 58);
	ctx.quadraticCurveTo(YURT_CENTER_X, YURT_TOP_Y + 88, YURT_CENTER_X + 54, YURT_TOP_Y + 58);
	ctx.stroke();
}

function drawYurtHearthBase(ctx: CanvasRenderingContext2D, time: number) {
	drawEllipse(ctx, 562, 774, 48, 25, '#5f4638');
	drawEllipse(ctx, 562, 770, 36, 18, '#2d2b2c');
	ctx.fillStyle = '#d0b05f';
	ctx.fillRect(546, 748, 32, 25);
	drawEllipse(ctx, 562, 748, 18, 8, '#d0b05f');
	ctx.fillStyle = '#9c6d3d';
	ctx.fillRect(558, 732, 8, 17);
	const flame = Math.sin(time / 130) * 3;
	ctx.fillStyle = '#ffb347';
	ctx.beginPath();
	ctx.moveTo(562, 770);
	ctx.bezierCurveTo(544, 754 + flame, 554, 736, 564, 730 + flame);
	ctx.bezierCurveTo(580, 748, 578, 762, 562, 770);
	ctx.fill();
	ctx.fillStyle = '#ffe08a';
	ctx.beginPath();
	ctx.moveTo(563, 768);
	ctx.bezierCurveTo(554, 756, 560, 742 + flame, 568, 738);
	ctx.bezierCurveTo(574, 752, 574, 762, 563, 768);
	ctx.fill();
}

function drawYurtHearthFront(ctx: CanvasRenderingContext2D) {
	drawEllipse(ctx, 562, 782, 52, 16, '#6f5242');
	ctx.fillStyle = '#d0b05f';
	for (let x = 528; x <= 592; x += 16) {
		ctx.fillRect(x, 784, 10, 5);
	}
}

function drawYurtTableBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 880, 900, 166, 62, 14, '#8c5f3b');
	fillRoundedRect(ctx, 900, 908, 126, 40, 9, '#c58a4f');
	ctx.fillStyle = '#f2d79c';
	ctx.fillRect(920, 920, 30, 16);
	ctx.fillRect(974, 921, 28, 15);
	drawEllipse(ctx, 964, 940, 30, 11, '#8ab862');
	ctx.fillStyle = '#d86c51';
	ctx.fillRect(956, 934, 8, 11);
	ctx.fillRect(968, 933, 8, 12);
}

function drawYurtTableFront(ctx: CanvasRenderingContext2D) {
	ctx.fillStyle = '#5f3e2c';
	ctx.fillRect(898, 960, 14, 18);
	ctx.fillRect(1014, 960, 14, 18);
	fillRoundedRect(ctx, 888, 954, 148, 10, 5, '#6e472f');
}

function drawYurtBedBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 898, 730, 164, 84, 14, '#7f4e3e');
	fillRoundedRect(ctx, 914, 742, 132, 56, 10, '#bb5360');
	fillRoundedRect(ctx, 924, 750, 50, 25, 8, '#f0d8ad');
	fillRoundedRect(ctx, 986, 750, 46, 25, 8, '#f0d8ad');
	ctx.fillStyle = '#d0b05f';
	for (let x = 924; x < 1030; x += 20) {
		ctx.fillRect(x, 788, 11, 8);
	}
}

function drawYurtBedFront(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 904, 804, 152, 14, 7, '#6b4337');
	ctx.fillStyle = '#5f3e2c';
	ctx.fillRect(908, 812, 14, 12);
	ctx.fillRect(1040, 812, 14, 12);
}

function drawYurtChestBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 438, 846, 122, 58, 9, '#8d4f32');
	fillRoundedRect(ctx, 452, 860, 94, 30, 6, '#c66e43');
	ctx.strokeStyle = '#f0c96b';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(452, 874);
	ctx.lineTo(546, 874);
	ctx.moveTo(499, 860);
	ctx.lineTo(499, 890);
	ctx.stroke();
	drawEllipse(ctx, 499, 875, 8, 5, '#2f85a3');
}

function drawYurtChestFront(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 446, 896, 106, 10, 5, '#5f3e2c');
	ctx.fillStyle = '#5f3e2c';
	ctx.fillRect(446, 904, 12, 8);
	ctx.fillRect(540, 904, 12, 8);
}

function drawYurtDombra(ctx: CanvasRenderingContext2D) {
	ctx.strokeStyle = '#5e3a24';
	ctx.lineWidth = 5;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(488, 1012);
	ctx.lineTo(566, 944);
	ctx.stroke();
	drawEllipse(ctx, 478, 1020, 22, 12, '#b56d3a');
	drawEllipse(ctx, 470, 1024, 14, 8, '#d08c4e');
	ctx.strokeStyle = '#ead7aa';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(482, 1018);
	ctx.lineTo(564, 946);
	ctx.moveTo(490, 1024);
	ctx.lineTo(572, 952);
	ctx.stroke();
	ctx.fillStyle = '#1e6f78';
	fillRoundedRect(ctx, 532, 974, 44, 9, 5, '#1e6f78');
}

function drawYurtLoomBase(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 828, 982, 168, 58, 9, '#6b4a38');
	ctx.fillStyle = '#2f2d31';
	ctx.fillRect(844, 992, 136, 4);
	ctx.fillRect(844, 1028, 136, 4);
	ctx.fillStyle = '#bb5360';
	for (let x = 852; x < 974; x += 16) {
		ctx.fillRect(x, 996, 9, 34);
	}
	ctx.fillStyle = '#d0b05f';
	for (let x = 862; x < 974; x += 32) {
		ctx.fillRect(x, 1006, 20, 8);
	}
}

function drawYurtLoomFront(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 840, 1034, 144, 10, 5, '#4f3629');
	ctx.strokeStyle = '#f0d8ad';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(842, 1040);
	ctx.lineTo(826, 1066);
	ctx.moveTo(980, 1040);
	ctx.lineTo(998, 1066);
	ctx.stroke();
}

function drawYurtFront(ctx: CanvasRenderingContext2D) {
	ctx.save();
	ctx.beginPath();
	ctx.ellipse(YURT_CENTER_X, YURT_CENTER_Y, YURT_RADIUS_X - 6, YURT_RADIUS_Y - 8, 0, 0, Math.PI);
	ctx.lineWidth = 22;
	ctx.strokeStyle = '#6d4a30';
	ctx.stroke();
	ctx.beginPath();
	ctx.ellipse(YURT_CENTER_X, YURT_CENTER_Y, YURT_RADIUS_X - 30, YURT_RADIUS_Y - 30, 0, 0, Math.PI);
	ctx.lineWidth = 8;
	ctx.strokeStyle = '#d0a85a';
	ctx.stroke();
	ctx.fillStyle = '#ead7aa';
	for (let i = 0; i < 17; i += 1) {
		const x = YURT_CENTER_X - 252 + i * 32;
		fillRoundedRect(ctx, x, YURT_BOTTOM_Y - 72 + (i % 2) * 5, 20, 11, 5, '#ead7aa');
	}
	ctx.restore();
}

function drawGardenBedBase(ctx: CanvasRenderingContext2D, x: number, y: number) {
	fillRoundedRect(ctx, x, y, 220, 78, 10, '#7a4f38');
	fillRoundedRect(ctx, x + 12, y + 10, 196, 56, 8, '#6b4c2e');
	ctx.fillStyle = '#365f37';
	for (let row = 0; row < 3; row += 1) {
		ctx.fillRect(x + 24, y + 20 + row * 14, 172, 4);
		for (let i = 0; i < 7; i += 1) {
			drawEllipse(ctx, x + 38 + i * 24, y + 18 + row * 14, 5, 8, row === 1 ? '#8ab862' : '#6f9f59');
		}
	}
}

function drawGardenBedFront(ctx: CanvasRenderingContext2D, x: number, y: number) {
	ctx.fillStyle = '#c98755';
	ctx.fillRect(x + 16, y + 66, 188, 5);
	ctx.fillStyle = '#5d3f2f';
	ctx.fillRect(x + 20, y + 70, 18, 8);
	ctx.fillRect(x + 182, y + 70, 18, 8);
	ctx.strokeStyle = '#6b472f';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(x + 18, y + 69.5);
	ctx.lineTo(x + 202, y + 69.5);
	ctx.stroke();
}

function drawGardenPond(ctx: CanvasRenderingContext2D, time: number) {
	drawEllipse(ctx, 520, 424 + GARDEN_ITEM_SHIFT, 112, 48, '#426f78');
	drawEllipse(ctx, 520, 420 + GARDEN_ITEM_SHIFT, 96, 38, '#5e9cac');
	ctx.strokeStyle = 'rgba(215, 244, 224, 0.5)';
	ctx.lineWidth = 3;
	for (let i = 0; i < 3; i += 1) {
		ctx.beginPath();
		ctx.ellipse(
			486 + i * 36,
			414 + GARDEN_ITEM_SHIFT + Math.sin(time / 400 + i) * 3,
			22,
			7,
			0,
			0,
			Math.PI * 2
		);
		ctx.stroke();
	}
	drawEllipse(ctx, 438, 398 + GARDEN_ITEM_SHIFT, 18, 8, '#6fa35f');
	drawEllipse(ctx, 604, 442 + GARDEN_ITEM_SHIFT, 20, 9, '#6fa35f');
	ctx.fillStyle = '#f3d77a';
	ctx.fillRect(600, 434 + GARDEN_ITEM_SHIFT, 6, 6);
}

function drawGardenTree(ctx: CanvasRenderingContext2D) {
	fillRoundedRect(ctx, 1248, 420 + GARDEN_ITEM_SHIFT, 44, 78, 10, '#76543b');
	ctx.fillStyle = '#5e3f2f';
	ctx.fillRect(1264, 432 + GARDEN_ITEM_SHIFT, 8, 56);
	const leaves = [
		[1230, 390 + GARDEN_ITEM_SHIFT, 42, 40, '#426d45'],
		[1274, 372 + GARDEN_ITEM_SHIFT, 54, 48, '#4f7e4f'],
		[1316, 398 + GARDEN_ITEM_SHIFT, 44, 42, '#3f6845'],
		[1248, 430 + GARDEN_ITEM_SHIFT, 48, 42, '#5b8b55'],
		[1296, 430 + GARDEN_ITEM_SHIFT, 50, 42, '#477848']
	] as const;
	for (const [x, y, radiusX, radiusY, fill] of leaves) {
		drawEllipse(ctx, x, y, radiusX, radiusY, fill);
	}
	ctx.fillStyle = '#e2b36c';
	ctx.fillRect(1288, 438 + GARDEN_ITEM_SHIFT, 8, 8);
	ctx.fillRect(1236, 408 + GARDEN_ITEM_SHIFT, 7, 7);
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

function drawFloorAndWalls(ctx: CanvasRenderingContext2D, time: number) {
	const wallGradient = ctx.createLinearGradient(0, 0, 0, 122);
	wallGradient.addColorStop(0, '#6d7564');
	wallGradient.addColorStop(1, '#a5916d');
	ctx.fillStyle = '#312820';
	ctx.fillRect(WORLD_MIN_X, 0, WORLD_WIDTH, MAP_HEIGHT);
	drawGardenGround(ctx);
	drawClubRoom(ctx, time);
	fillRoundedRect(ctx, 18, 16, MAP_WIDTH - 36, ROOM_BOTTOM_Y + 10, 8, '#5a3e34');
	ctx.fillStyle = wallGradient;
	ctx.fillRect(28, 28, MAP_WIDTH - 56, 94);
	ctx.fillStyle = '#7b5846';
	ctx.fillRect(28, 118, MAP_WIDTH - 56, 10);
	const floorGradient = ctx.createLinearGradient(0, 124, 0, ROOM_BOTTOM_Y);
	floorGradient.addColorStop(0, '#c38d58');
	floorGradient.addColorStop(1, '#9e6845');
	ctx.fillStyle = floorGradient;
	ctx.fillRect(28, 128, MAP_WIDTH - 56, ROOM_BOTTOM_Y - 128);
	for (let y = 132; y < ROOM_BOTTOM_Y; y += 18) {
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
	drawGardenPath(ctx);
	drawYurtShell(ctx, time);
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
	glow = ctx.createRadialGradient(-300, 184, 12, -300, 184, 240);
	glow.addColorStop(0, 'rgba(242, 63, 125, 0.28)');
	glow.addColorStop(0.55, 'rgba(104, 212, 255, 0.12)');
	glow.addColorStop(1, 'rgba(242, 63, 125, 0)');
	ctx.fillStyle = glow;
	ctx.fillRect(CLUB_LEFT_X + 24, 26, CLUB_RIGHT_X - CLUB_LEFT_X, 314);
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

function strokeClubLimb(
	ctx: CanvasRenderingContext2D,
	points: readonly (readonly [number, number])[],
	color: string,
	width = 6
) {
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	points.forEach(([x, y], index) => {
		if (index === 0) {
			ctx.moveTo(x, y);
			return;
		}
		ctx.lineTo(x, y);
	});
	ctx.stroke();
}

function drawClubPoseHead(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	facing: CottagePlayerFacing = 'down'
) {
	fillRoundedRect(ctx, x - 12, y - 12, 24, 24, 10, '#f0b78b');
	ctx.fillStyle = '#4f322a';
	if (facing === 'up') {
		ctx.fillRect(x - 12, y - 13, 24, 12);
		return;
	}
	ctx.fillRect(x - 12, y - 14, 24, 8);
	ctx.fillRect(x - 12, y - 9, 5, 8);
	ctx.fillRect(x + 7, y - 9, 5, 8);
	ctx.fillStyle = '#3a2926';
	const eyeOffset = facing === 'left' ? -2 : facing === 'right' ? 2 : 0;
	ctx.fillRect(x - 5 + eyeOffset, y - 2, 3, 3);
	ctx.fillRect(x + 4 + eyeOffset, y - 2, 3, 3);
}

function drawClubCuff(ctx: CanvasRenderingContext2D, x: number, y: number) {
	ctx.strokeStyle = '#d1d3de';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(x, y, 5, 0, Math.PI * 2);
	ctx.stroke();
	fillRoundedRect(ctx, x - 7, y - 2, 14, 4, 2, '#7f243f');
}

function drawClubPlayerPose(
	ctx: CanvasRenderingContext2D,
	player: CottagePlayerSyncState,
	interaction: CottageInteraction | undefined,
	color: string,
	time: number
) {
	if (
		!interaction?.id.startsWith('club-') ||
		(player.action !== 'interacting' && player.action !== 'sitting')
	) {
		return false;
	}

	const skin = '#f0b78b';
	const pants = '#3d3b48';
	const boot = '#24242d';
	const sway = Math.sin(time / 180) * 2;

	ctx.save();
	switch (interaction.id) {
		case 'club-lounge':
			ctx.translate(0, 6);
			strokeClubLimb(
				ctx,
				[
					[-2, -8],
					[18, 4],
					[30, 8]
				],
				pants,
				7
			);
			strokeClubLimb(
				ctx,
				[
					[-10, -4],
					[-30, 4],
					[-40, 8]
				],
				pants,
				7
			);
			fillRoundedRect(ctx, -34, -30, 58, 24, 10, color);
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			ctx.fillRect(-22, -24, 28, 5);
			strokeClubLimb(
				ctx,
				[
					[-24, -22],
					[-42, -28]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[14, -20],
					[28, -30]
				],
				skin,
				5
			);
			drawClubPoseHead(ctx, -34, -34, 'right');
			break;
		case 'club-stage':
			strokeClubLimb(
				ctx,
				[
					[9, -31],
					[9 + sway, -54],
					[5 + sway, -72]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[-10, -29],
					[-24, -14]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[-6, 8],
					[-18, 24]
				],
				pants,
				7
			);
			strokeClubLimb(
				ctx,
				[
					[7, 8],
					[18, 15],
					[22, 28]
				],
				pants,
				7
			);
			fillRoundedRect(ctx, -14, -34, 28, 42, 9, color);
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			ctx.fillRect(-8, -27, 16, 5);
			drawClubPoseHead(ctx, 0, -48, 'down');
			ctx.fillStyle = '#fff0a8';
			for (let i = 0; i < 3; i += 1) {
				drawEllipse(ctx, -22 + i * 20, -56 + Math.sin(time / 160 + i) * 3, 3, 3, '#fff0a8');
			}
			break;
		case 'club-cross':
			strokeClubLimb(
				ctx,
				[
					[-10, -32],
					[-28, -60],
					[-38, -78]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[10, -32],
					[28, -60],
					[38, -78]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[-8, 7],
					[-13, 28]
				],
				pants,
				7
			);
			strokeClubLimb(
				ctx,
				[
					[8, 7],
					[13, 28]
				],
				pants,
				7
			);
			fillRoundedRect(ctx, -14, -36, 28, 44, 9, color);
			ctx.fillStyle = 'rgba(255,255,255,0.16)';
			ctx.fillRect(-8, -29, 16, 5);
			drawClubPoseHead(ctx, 0, -50, 'up');
			drawClubCuff(ctx, -38, -78);
			drawClubCuff(ctx, 38, -78);
			break;
		case 'club-swing':
			ctx.translate(0, -6);
			strokeClubLimb(
				ctx,
				[
					[-20, -22],
					[-28, -48]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[18, -22],
					[30, -48]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[14, -6],
					[36, 6],
					[48, 4]
				],
				pants,
				7
			);
			strokeClubLimb(
				ctx,
				[
					[5, -2],
					[24, 18],
					[38, 20]
				],
				pants,
				7
			);
			fillRoundedRect(ctx, -34, -28, 66, 24, 10, color);
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			ctx.fillRect(-18, -22, 30, 5);
			drawClubPoseHead(ctx, -42, -26, 'right');
			ctx.fillStyle = boot;
			drawEllipse(ctx, 52, 4, 7, 4, boot);
			drawEllipse(ctx, 42, 20, 7, 4, boot);
			drawClubCuff(ctx, -28, -48);
			drawClubCuff(ctx, 30, -48);
			break;
		case 'club-rack':
			strokeClubLimb(
				ctx,
				[
					[10, -29],
					[28, -49],
					[35, -66]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[-11, -27],
					[-22, -16]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[-7, 8],
					[-9, 27]
				],
				pants,
				7
			);
			strokeClubLimb(
				ctx,
				[
					[7, 8],
					[10, 27]
				],
				pants,
				7
			);
			fillRoundedRect(ctx, -14, -34, 28, 42, 9, color);
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			ctx.fillRect(-8, -27, 16, 5);
			drawClubPoseHead(ctx, 0, -48, 'up');
			ctx.fillStyle = '#8b2f4f';
			fillRoundedRect(ctx, 31, -76, 10, 24, 5, '#8b2f4f');
			drawEllipse(ctx, 36, -79, 10, 6, '#8b2f4f');
			break;
		case 'club-bench':
			ctx.translate(0, -2);
			strokeClubLimb(
				ctx,
				[
					[-8, -7],
					[-22, 12],
					[-22, 28]
				],
				pants,
				7
			);
			strokeClubLimb(
				ctx,
				[
					[8, -7],
					[24, 10],
					[24, 28]
				],
				pants,
				7
			);
			fillRoundedRect(ctx, -42, -30, 72, 22, 10, color);
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			ctx.fillRect(-24, -24, 32, 5);
			strokeClubLimb(
				ctx,
				[
					[-26, -22],
					[-46, -28]
				],
				skin,
				5
			);
			strokeClubLimb(
				ctx,
				[
					[18, -21],
					[38, -28]
				],
				skin,
				5
			);
			drawClubPoseHead(ctx, -48, -30, 'right');
			drawClubCuff(ctx, -46, -28);
			drawClubCuff(ctx, 38, -28);
			break;
		default:
			ctx.restore();
			return false;
	}
	ctx.restore();
	return true;
}

function drawPlayer(ctx: CanvasRenderingContext2D, player: CottagePlayerSyncState, time: number) {
	const interaction = findInteraction(player.interactionId);
	const color = getPlayerFallbackColor(player.name);
	const bob = player.action === 'walking' ? Math.sin(time / 85 + player.x * 0.08) * 2 : 0;
	const poseX = player.x;
	const poseY =
		player.action === 'sleeping' && (interaction?.id === 'bed' || interaction?.id === 'yurt-bed')
			? interaction.anchorY - 28
			: player.y;
	const nameY = player.action === 'sleeping' ? poseY - 34 : poseY - 48 + bob;
	drawEllipse(ctx, player.x, player.y + 4, 18, 8, 'rgba(35, 24, 18, 0.22)');

	ctx.save();
	ctx.translate(poseX, poseY + bob);
	if (drawClubPlayerPose(ctx, player, interaction, color, time)) {
		ctx.restore();
	} else if (player.action === 'sleeping') {
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
	const mapOffsetX = Math.max(0, (canvasWidth - WORLD_WIDTH) / 2);
	ctx.translate(mapOffsetX - cameraX, -cameraY);
	drawFloorAndWalls(ctx, time);
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
		...GARDEN_BEDS.flatMap((bed) => [
			{ sortY: bed.y + 56, draw: () => drawGardenBedBase(ctx, bed.x, bed.y) },
			{ sortY: bed.y + 70, draw: () => drawGardenBedFront(ctx, bed.x, bed.y) }
		]),
		{ sortY: 476 + GARDEN_ITEM_SHIFT, draw: () => drawGardenPond(ctx, time) },
		{ sortY: 512 + GARDEN_ITEM_SHIFT, draw: () => drawGardenTree(ctx) },
		{ sortY: 798, draw: () => drawYurtHearthBase(ctx, time) },
		{ sortY: 808, draw: () => drawYurtHearthFront(ctx) },
		{ sortY: 810, draw: () => drawYurtBedBase(ctx) },
		{ sortY: 858, draw: () => drawYurtBedFront(ctx) },
		{ sortY: 892, draw: () => drawYurtChestBase(ctx) },
		{ sortY: 916, draw: () => drawYurtChestFront(ctx) },
		{ sortY: 948, draw: () => drawYurtTableBase(ctx) },
		{ sortY: 978, draw: () => drawYurtTableFront(ctx) },
		{ sortY: 1010, draw: () => drawYurtDombra(ctx) },
		{ sortY: 1040, draw: () => drawYurtLoomBase(ctx) },
		{ sortY: 1062, draw: () => drawYurtLoomFront(ctx) },
		{ sortY: YURT_BOTTOM_Y - 10, draw: () => drawYurtFront(ctx) },
		...players.map((player) => ({
			sortY: getInteractionSortY(player),
			draw: () => drawPlayer(ctx, player, time)
		}))
	];

	drawItems.sort((a, b) => a.sortY - b.sortY);
	for (const item of drawItems) {
		item.draw();
	}

	drawLighting(ctx, time, cameraX, cameraY, Math.min(canvasWidth, WORLD_WIDTH));
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
			<div className="absolute inset-x-0 bottom-0 h-[34%] bg-[linear-gradient(180deg,#4f774c_0%,#304f38_100%)]" />
			<div className="absolute left-1/2 bottom-0 h-[38%] w-[8%] -translate-x-1/2 rounded-t-lg bg-[#8c6a4f]" />
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
			<div className="absolute left-[11%] bottom-[9%] h-[12%] w-[15%] rounded-md bg-[#7a4f38]">
				<div className="absolute inset-[14%] rounded bg-[#6b4c2e]" />
			</div>
			<div className="absolute left-[43%] bottom-[10%] h-[11%] w-[16%] rounded-full bg-[#5e9cac]" />
			<div className="absolute right-[10%] bottom-[8%] h-[22%] w-[10%]">
				<div className="absolute bottom-0 left-[40%] h-[42%] w-[22%] rounded bg-[#76543b]" />
				<div className="absolute left-[5%] top-0 h-[62%] w-[58%] rounded-full bg-[#4f7e4f]" />
				<div className="absolute right-0 top-[14%] h-[54%] w-[52%] rounded-full bg-[#3f6845]" />
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
	const canvasSizeRef = useRef({ width: WORLD_WIDTH, height: GAME_HEIGHT, dpr: 1 });
	const cameraXRef = useRef(0);
	const cameraYRef = useRef(ROOM_CROP_TOP);
	const targetRef = useRef<MoveTarget | null>(null);
	const keyboardDirectionRef = useRef('');
	const lastKeyboardSnapshotAtRef = useRef(0);
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
				targetRef.current = null;
				const keyboardDirectionChanged = keyboardDirectionRef.current !== keyboardDirection;
				const beforeKeyboardMove = next;
				next = movePlayerWithKeyboard(next, moveX, moveY, deltaSeconds, now);
				keyboardDirectionRef.current = keyboardDirection;
				if (
					hasPlayerChanged(beforeKeyboardMove, next) &&
					(keyboardDirectionChanged ||
						now - lastKeyboardSnapshotAtRef.current >= KEYBOARD_SYNC_INTERVAL_MS)
				) {
					lastKeyboardSnapshotAtRef.current = now;
					shouldSend = true;
				}
			} else if (keyboardDirectionRef.current) {
				keyboardDirectionRef.current = '';
				lastKeyboardSnapshotAtRef.current = 0;
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
			const viewWidth = Math.min(WORLD_WIDTH, size.width);
			const defaultCameraX = WORLD_MIN_X + (WORLD_WIDTH - viewWidth) / 2;
			const cameraTarget = self ? self.x - viewWidth / 2 : defaultCameraX;
			cameraXRef.current = clamp(cameraTarget, WORLD_MIN_X, WORLD_MAX_X - viewWidth);
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
		const mapOffsetX = Math.max(0, (size.width - WORLD_WIDTH) / 2);
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
			lastKeyboardSnapshotAtRef.current = 0;
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
				lastKeyboardSnapshotAtRef.current = 0;
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
