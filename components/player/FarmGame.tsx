'use client';

/* Pixel-art HUD icons are tiny static sprites that must stay crisp, so we use
   plain <img> with image-rendering: pixelated rather than next/image. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CROPS } from '@/lib/farm/crops';
import { GAME_HEIGHT } from '@/lib/farm/world';
import {
	SyncTypes,
	type FarmPlayerSyncState,
	type FarmPlotSyncState,
	type FarmSyncState,
	type Player as RoomPlayer,
	type SendPayload
} from '@/lib/player/t';
import type { FarmBridge, FarmKeys, FarmSceneApi, FarmTool } from '@/lib/farm/scene';

type FarmPlayerIdentity = {
	id: string;
	name: string;
	profileId?: string;
};

type FarmGameProps = {
	backendBaseUrl: string;
	roomId: string;
	socketConnected: boolean;
	currentPlayer: FarmPlayerIdentity | null;
	roomPlayers: RoomPlayer[];
};

const FARM_SURFACE_CLASS_NAME =
	'relative mx-auto w-full max-w-[90rem] overflow-hidden rounded-md bg-[#5a8a4a] outline-none focus-visible:outline-none select-none';

const MOVE_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'];

const TOOLS: { id: FarmTool; label: string; key: string; icon: string }[] = [
	{ id: 'hoe', label: 'Till', key: '1', icon: '/farm/icons/hoe.png' },
	{ id: 'can', label: 'Water', key: '2', icon: '/farm/icons/can.png' },
	{ id: 'seed', label: 'Plant', key: '3', icon: '' },
	{ id: 'basket', label: 'Harvest', key: '4', icon: '/farm/icons/basket.png' }
];

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

function displayName(player: Pick<RoomPlayer, 'id' | 'name'> | FarmPlayerIdentity) {
	return (player.name || player.id || 'Guest').trim().slice(0, 40) || 'Guest';
}

export function FarmGamePlaceholder() {
	return (
		<div
			aria-hidden="true"
			className={`${FARM_SURFACE_CLASS_NAME} opacity-90`}
			style={{ height: GAME_HEIGHT }}
		>
			<div className="absolute inset-0 bg-[linear-gradient(180deg,#8fc16a_0%,#6ea84f_55%,#5a8a4a_100%)]" />
			<div className="absolute inset-x-0 bottom-0 h-[44%] bg-[linear-gradient(180deg,rgba(120,90,55,0)_0%,rgba(120,90,55,0.25)_100%)]" />
			<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-sm text-[#2f4a28]/70">
				loading farm…
			</div>
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,245,213,0.25),transparent_42%)] mix-blend-screen" />
		</div>
	);
}

export function FarmGame({
	backendBaseUrl,
	roomId,
	socketConnected,
	currentPlayer,
	roomPlayers
}: FarmGameProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const gameRef = useRef<{
		destroy: (removeCanvas: boolean) => void;
		scale: { resize: (w: number, h: number) => void };
	} | null>(null);
	const sceneRef = useRef<FarmSceneApi | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const reconnectAttemptRef = useRef(0);

	const keysRef = useRef<Set<string>>(new Set());
	const toolRef = useRef<FarmTool>('hoe');
	const seedIndexRef = useRef(0);
	const selfStateRef = useRef<FarmPlayerSyncState | null>(null);
	const pendingPlayersRef = useRef<FarmPlayerSyncState[]>([]);
	const pendingPlotsRef = useRef<FarmPlotSyncState[]>([]);
	const currentPlayerRef = useRef<FarmPlayerIdentity | null>(currentPlayer);
	const roomPlayersRef = useRef<RoomPlayer[]>(roomPlayers);

	const [tool, setTool] = useState<FarmTool>('hoe');
	const [seedIndex, setSeedIndex] = useState(0);
	const [harvest, setHarvest] = useState<{ total: number; last: string | null }>({
		total: 0,
		last: null
	});

	useEffect(() => {
		currentPlayerRef.current = currentPlayer;
	}, [currentPlayer]);
	useEffect(() => {
		roomPlayersRef.current = roomPlayers;
		if (sceneRef.current?.ready) {
			sceneRef.current.setRoster(new Set(roomPlayers.map((p) => p.id)));
		}
	}, [roomPlayers]);
	useEffect(() => {
		toolRef.current = tool;
	}, [tool]);
	useEffect(() => {
		seedIndexRef.current = seedIndex;
	}, [seedIndex]);

	const sendFarm = useCallback((state: FarmSyncState) => {
		const socket = socketRef.current;
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(JSON.stringify({ type: SyncTypes.FarmSync, farm: state }));
	}, []);

	const flushPending = useCallback(() => {
		const scene = sceneRef.current;
		if (!scene?.ready) {
			return;
		}
		if (pendingPlayersRef.current.length) {
			scene.applyRemotePlayers(pendingPlayersRef.current);
			pendingPlayersRef.current = [];
		}
		if (pendingPlotsRef.current.length) {
			scene.applyRemotePlots(pendingPlotsRef.current);
			pendingPlotsRef.current = [];
		}
		scene.setRoster(new Set(roomPlayersRef.current.map((p) => p.id)));
	}, []);

	// --- Phaser game lifecycle ---
	useEffect(() => {
		const self = currentPlayer;
		const container = containerRef.current;
		if (!self || !container) {
			return;
		}
		let disposed = false;
		let resizeObserver: ResizeObserver | null = null;

		const bridge: FarmBridge = {
			sendPlayer: (state) => {
				selfStateRef.current = state;
				sendFarm({ players: [state], plots: [], updatedAt: state.updatedAt });
			},
			sendPlot: (plot) => {
				sendFarm({ players: [], plots: [plot], updatedAt: plot.updatedAt });
			},
			onHarvest: (cropId) => {
				setHarvest((prev) => ({ total: prev.total + 1, last: cropId }));
			}
		};
		const getTool = () => toolRef.current;
		const getSeedCrop = () => CROPS[seedIndexRef.current]?.id ?? CROPS[0].id;
		const getKeys = (): FarmKeys => {
			const k = keysRef.current;
			return {
				left: k.has('arrowleft') || k.has('a'),
				right: k.has('arrowright') || k.has('d'),
				up: k.has('arrowup') || k.has('w'),
				down: k.has('arrowdown') || k.has('s')
			};
		};

		(async () => {
			const [{ default: Phaser }, { createFarmScene }] = await Promise.all([
				import('phaser'),
				import('@/lib/farm/scene')
			]);
			if (disposed || !containerRef.current) {
				return;
			}
			const scene = createFarmScene(Phaser, {
				selfId: self.id,
				selfName: displayName(self),
				selfProfileId: self.profileId,
				bridge,
				getTool,
				getSeedCrop,
				getKeys,
				onReady: () => {
					sceneRef.current = scene;
					flushPending();
				}
			});
			const width = Math.max(1, containerRef.current.clientWidth);
			const game = new Phaser.Game({
				type: Phaser.AUTO,
				parent: containerRef.current,
				width,
				height: GAME_HEIGHT,
				pixelArt: true,
				roundPixels: true,
				backgroundColor: '#5a8a4a',
				banner: false,
				scale: { mode: Phaser.Scale.NONE, width, height: GAME_HEIGHT },
				scene
			});
			gameRef.current = game as unknown as typeof gameRef.current;

			resizeObserver = new ResizeObserver(() => {
				const el = containerRef.current;
				if (el && gameRef.current) {
					gameRef.current.scale.resize(Math.max(1, el.clientWidth), GAME_HEIGHT);
				}
			});
			resizeObserver.observe(containerRef.current);
		})();

		return () => {
			disposed = true;
			sceneRef.current = null;
			resizeObserver?.disconnect();
			gameRef.current?.destroy(true);
			gameRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentPlayer?.id]);

	// --- websocket lifecycle ---
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
		const syncRoom = `farm:${roomId}`;
		const socketUrl = getBackendWebSocketUrl(
			backendBaseUrl,
			`/sync/${encodeURIComponent(syncRoom)}/${encodeURIComponent(`${currentPlayer.id}-farm`)}`
		);

		const clearReconnect = () => {
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
		};

		const requestSnapshot = () => sendFarm({ players: [], plots: [], updatedAt: 0 });

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
			clearReconnect();
			const socket = new WebSocket(socketUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				if (socketRef.current !== socket) {
					socket.close();
					return;
				}
				reconnectAttemptRef.current = 0;
				socket.send(JSON.stringify({ type: SyncTypes.NewPlayer }));
				if (selfStateRef.current) {
					sendFarm({
						players: [selfStateRef.current],
						plots: [],
						updatedAt: selfStateRef.current.updatedAt
					});
				}
				requestSnapshot();
			};

			socket.onmessage = (event: MessageEvent) => {
				if (socketRef.current !== socket) {
					return;
				}
				let payload: SendPayload;
				try {
					payload = JSON.parse(event.data) as SendPayload;
				} catch (error) {
					console.warn('Ignoring malformed farm sync payload', error);
					return;
				}
				if (payload.type !== SyncTypes.FarmSync || !payload.farm) {
					return;
				}
				const farm = payload.farm;
				const selfId = currentPlayerRef.current?.id;
				const players = Array.isArray(farm.players)
					? farm.players.filter((p) => p && p.id && p.id !== selfId)
					: [];
				const plots = Array.isArray(farm.plots) ? farm.plots.filter((p) => p && p.id) : [];
				if (farm.updatedAt === 0 && players.length === 0 && plots.length === 0) {
					if (selfStateRef.current) {
						sendFarm({
							players: [selfStateRef.current],
							plots: [],
							updatedAt: selfStateRef.current.updatedAt
						});
					}
					return;
				}
				const scene = sceneRef.current;
				if (scene?.ready) {
					if (players.length) scene.applyRemotePlayers(players);
					if (plots.length) scene.applyRemotePlots(plots);
				} else {
					if (players.length) pendingPlayersRef.current.push(...players);
					if (plots.length) pendingPlotsRef.current.push(...plots);
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
			clearReconnect();
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
	}, [backendBaseUrl, currentPlayer, roomId, sendFarm, socketConnected]);

	// --- HUD interactions ---
	const focusGame = useCallback(() => {
		wrapperRef.current?.focus();
	}, []);

	const selectTool = useCallback((id: FarmTool) => {
		if (id === 'seed' && toolRef.current === 'seed') {
			setSeedIndex((prev) => (prev + 1) % CROPS.length);
		}
		setTool(id);
	}, []);

	const triggerUse = useCallback(() => {
		sceneRef.current?.useTool();
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const key = event.key.toLowerCase();
			if (MOVE_KEYS.includes(key)) {
				event.preventDefault();
				keysRef.current.add(key);
				return;
			}
			if (key === '1' || key === '2' || key === '3' || key === '4') {
				event.preventDefault();
				selectTool(TOOLS[Number(key) - 1].id);
				return;
			}
			if (key === ' ' || key === 'e' || key === 'enter') {
				event.preventDefault();
				triggerUse();
			}
		},
		[selectTool, triggerUse]
	);

	const handleKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
		keysRef.current.delete(event.key.toLowerCase());
	}, []);

	const seedCrop = CROPS[seedIndex] ?? CROPS[0];
	const harvestIcon = harvest.last
		? `/farm/icons/item-${harvest.last}.png`
		: '/farm/icons/basket.png';

	return (
		<div
			ref={wrapperRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onKeyUp={handleKeyUp}
			onPointerDown={focusGame}
			onBlur={() => keysRef.current.clear()}
			className={FARM_SURFACE_CLASS_NAME}
			style={{ height: GAME_HEIGHT }}
		>
			<div ref={containerRef} className="absolute inset-0 [&>canvas]:!h-full [&>canvas]:!w-full" />

			{/* hotbar */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
				<div className="pointer-events-auto flex gap-1.5">
					{TOOLS.map((t) => {
						const active = tool === t.id;
						const icon = t.id === 'seed' ? `/farm/icons/seed-${seedCrop.id}.png` : t.icon;
						return (
							<button
								key={t.id}
								type="button"
								onClick={() => {
									selectTool(t.id);
									focusGame();
								}}
								title={
									t.id === 'seed' ? `Plant ${seedCrop.label} (3 to cycle)` : `${t.label} (${t.key})`
								}
								className={`group relative flex h-11 w-11 items-center justify-center rounded-md border-2 transition-colors ${
									active
										? 'border-[#f4ead6] bg-[#caa46e]'
										: 'border-[#6b4a30]/70 bg-[#9a7250]/85 hover:bg-[#a9805a]'
								}`}
							>
								<img
									src={icon}
									alt={t.label}
									className="h-7 w-7"
									style={{ imageRendering: 'pixelated' }}
									draggable={false}
								/>
								<span className="absolute -bottom-0.5 right-0.5 font-mono text-[8px] leading-none text-[#3a2a1c]">
									{t.key}
								</span>
							</button>
						);
					})}
				</div>

				<div className="pointer-events-auto flex items-center gap-2">
					<div className="flex items-center gap-1 rounded-md border-2 border-[#6b4a30]/70 bg-[#9a7250]/85 px-2 py-1">
						<img
							src={harvestIcon}
							alt="harvested"
							className="h-6 w-6"
							style={{ imageRendering: 'pixelated' }}
							draggable={false}
						/>
						<span className="font-mono text-sm font-bold text-[#fff6da] tabular-nums">
							{harvest.total}
						</span>
					</div>
					<button
						type="button"
						onPointerDown={(e) => {
							e.preventDefault();
							focusGame();
							triggerUse();
						}}
						className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#f4ead6] bg-[#7bbd5a] font-mono text-xs font-bold text-[#2f4a28] shadow-md active:scale-95"
						title="Use tool (Space / E)"
					>
						USE
					</button>
				</div>
			</div>

			{/* controls + credit hint */}
			<div className="pointer-events-none absolute left-2 top-2 rounded bg-black/25 px-2 py-1 font-mono text-[9px] leading-tight text-white/85">
				WASD / click to move · 1–4 tools · space to use
			</div>
			<div className="pointer-events-none absolute right-2 top-2 font-mono text-[8px] text-white/55">
				art: Sprout Lands — Cup Nooble
			</div>
		</div>
	);
}
