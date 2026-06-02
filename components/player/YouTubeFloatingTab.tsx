'use client';

import {
	type FormEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState
} from 'react';
import {
	IconArrowRight,
	IconBrandYoutubeFilled,
	IconChevronDown,
	IconChevronUp,
	IconGripVertical,
	IconX
} from '@tabler/icons-react';
import type { YouTubeTabSyncState } from '@/lib/player/t';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type YouTubePlayer = {
	cueVideoById: (options: { videoId: string; startSeconds?: number }) => void;
	loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
	playVideo: () => void;
	pauseVideo: () => void;
	seekTo: (seconds: number, allowSeekAhead: boolean) => void;
	setPlaybackRate: (rate: number) => void;
	getPlaybackRate: () => number;
	getCurrentTime: () => number;
	getPlayerState: () => number;
	destroy: () => void;
};

type YouTubeNamespace = {
	Player: new (
		elementId: string,
		options: {
			videoId?: string;
			playerVars?: Record<string, string | number>;
			events?: {
				onReady?: () => void;
				onStateChange?: (event: { data: number }) => void;
				onPlaybackRateChange?: (event: { data: number }) => void;
			};
		}
	) => YouTubePlayer;
	PlayerState: {
		ENDED: number;
		PLAYING: number;
		PAUSED: number;
		BUFFERING: number;
		CUED: number;
	};
};

declare global {
	interface Window {
		YT?: YouTubeNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

type YouTubeTabLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

type ParsedYouTubeURL = {
	videoId: string;
	startSeconds: number;
};

type YouTubeFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: YouTubeTabSyncState;
	onStateChange: (patch: Partial<YouTubeTabSyncState>) => void;
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 260;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 420;
const COLLAPSED_HEIGHT = 44;
const VIEWPORT_MARGIN = 8;
const YOUTUBE_TIME_SYNC_THRESHOLD_SECONDS = 6;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

let youTubeApiPromise: Promise<YouTubeNamespace> | null = null;
let youtubeTabZIndexCounter = 120;

type FloatingZIndexWindow = Window & {
	__sparkleFloatingTabZIndex?: number;
};

function nextFloatingTabZIndex() {
	if (typeof window === 'undefined') {
		youtubeTabZIndexCounter += 1;
		return youtubeTabZIndexCounter;
	}
	const zWindow = window as FloatingZIndexWindow;
	const current = Math.max(zWindow.__sparkleFloatingTabZIndex ?? 120, youtubeTabZIndexCounter);
	const next = current + 1;
	zWindow.__sparkleFloatingTabZIndex = next;
	youtubeTabZIndexCounter = next;
	return next;
}

function loadYouTubeApi() {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('YouTube API is unavailable during server rendering'));
	}
	if (window.YT?.Player) {
		return Promise.resolve(window.YT);
	}
	if (youTubeApiPromise) {
		return youTubeApiPromise;
	}

	youTubeApiPromise = new Promise((resolve, reject) => {
		const previousReady = window.onYouTubeIframeAPIReady;
		const timeout = window.setTimeout(() => {
			youTubeApiPromise = null;
			reject(new Error('Timed out loading the YouTube player API'));
		}, 15000);

		window.onYouTubeIframeAPIReady = () => {
			previousReady?.();
			window.clearTimeout(timeout);
			if (window.YT?.Player) {
				resolve(window.YT);
			} else {
				youTubeApiPromise = null;
				reject(new Error('YouTube player API loaded without a player constructor'));
			}
		};

		if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
			const script = document.createElement('script');
			script.src = 'https://www.youtube.com/iframe_api';
			script.async = true;
			script.onerror = () => {
				window.clearTimeout(timeout);
				youTubeApiPromise = null;
				reject(new Error('Unable to load the YouTube player API'));
			};
			document.head.appendChild(script);
		}
	});

	return youTubeApiPromise;
}

function parseTimeParam(value: string | null) {
	if (!value) {
		return 0;
	}
	if (/^\d+$/.test(value)) {
		return Number(value);
	}
	const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
	if (!match) {
		return 0;
	}
	return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function parseYouTubeURL(value: string): ParsedYouTubeURL | null {
	const input = value.trim();
	if (YOUTUBE_ID_PATTERN.test(input)) {
		return { videoId: input, startSeconds: 0 };
	}

	try {
		const url = new URL(input);
		const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
		let videoId = '';
		if (host === 'youtu.be') {
			videoId = url.pathname.split('/').filter(Boolean)[0] || '';
		} else if (host === 'youtube.com' || host === 'music.youtube.com') {
			if (url.pathname === '/watch') {
				videoId = url.searchParams.get('v') || '';
			} else {
				const parts = url.pathname.split('/').filter(Boolean);
				if (['embed', 'shorts', 'live'].includes(parts[0])) {
					videoId = parts[1] || '';
				}
			}
		}
		if (!YOUTUBE_ID_PATTERN.test(videoId)) {
			return null;
		}
		return {
			videoId,
			startSeconds: parseTimeParam(url.searchParams.get('t') || url.searchParams.get('start'))
		};
	} catch {
		return null;
	}
}

function normalizeYouTubeURL(videoId: string) {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function isDiscordActivityEnvironment() {
	if (typeof window === 'undefined') {
		return false;
	}
	const params = new URLSearchParams(window.location.search);
	return (
		params.has('frame_id') ||
		params.has('instance_id') ||
		/^[0-9]+\.discordsays\.com(?::\d+)?$/.test(window.location.host)
	);
}

function readStoredLayout(storageKey: string): YouTubeTabLayout | null {
	if (typeof window === 'undefined') {
		return null;
	}
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (!stored) {
			return null;
		}
		const parsed = JSON.parse(stored) as Partial<YouTubeTabLayout>;
		if (
			typeof parsed.x !== 'number' ||
			typeof parsed.y !== 'number' ||
			typeof parsed.width !== 'number' ||
			typeof parsed.height !== 'number'
		) {
			return null;
		}
		return parsed as YouTubeTabLayout;
	} catch {
		return null;
	}
}

function readStoredCollapsed(storageKey: string) {
	if (typeof window === 'undefined') {
		return false;
	}
	return window.localStorage.getItem(storageKey) === 'true';
}

function getDefaultLayout(initialIndex = 0): YouTubeTabLayout {
	if (typeof window === 'undefined') {
		return { x: 24, y: 96, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
	}
	const limits = getLayoutLimits();
	const preferredWidth = Math.min(DEFAULT_WIDTH, Math.max(0, window.innerWidth - 32));
	const preferredHeight = Math.min(DEFAULT_HEIGHT, Math.max(0, window.innerHeight - 32));
	const width = Math.min(limits.maxWidth, Math.max(limits.minWidth, preferredWidth));
	const height = Math.min(limits.maxHeight, Math.max(limits.minHeight, preferredHeight));
	const offset = Math.min(160, Math.max(0, initialIndex) * 32);
	return {
		x: Math.max(VIEWPORT_MARGIN, window.innerWidth - width - 24 - offset),
		y: Math.min(96 + offset, Math.max(VIEWPORT_MARGIN, window.innerHeight - height - 24)),
		width,
		height
	};
}

function getLayoutLimits() {
	const maxWidth = Math.max(1, window.innerWidth - VIEWPORT_MARGIN * 2);
	const maxHeight = Math.max(1, window.innerHeight - VIEWPORT_MARGIN * 2);
	return {
		minWidth: Math.min(MIN_WIDTH, maxWidth),
		minHeight: Math.min(MIN_HEIGHT, maxHeight),
		maxWidth,
		maxHeight
	};
}

function clampLayout(layout: YouTubeTabLayout, visibleHeight = layout.height): YouTubeTabLayout {
	if (typeof window === 'undefined') {
		return layout;
	}
	const limits = getLayoutLimits();
	const width = Math.min(Math.max(layout.width, limits.minWidth), limits.maxWidth);
	const height = Math.min(Math.max(layout.height, limits.minHeight), limits.maxHeight);
	const boxHeight = Math.max(0, Math.min(visibleHeight, limits.maxHeight));
	return {
		x: Math.min(
			Math.max(VIEWPORT_MARGIN, layout.x),
			Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
		),
		y: Math.min(
			Math.max(VIEWPORT_MARGIN, layout.y),
			Math.max(VIEWPORT_MARGIN, window.innerHeight - boxHeight - VIEWPORT_MARGIN)
		),
		width,
		height
	};
}

function constrainResizeSize(width: number, height: number) {
	if (typeof window === 'undefined') {
		return {
			width: Math.max(width, MIN_WIDTH),
			height: Math.max(height, MIN_HEIGHT)
		};
	}
	const limits = getLayoutLimits();
	return {
		width: Math.min(Math.max(width, limits.minWidth), limits.maxWidth),
		height: Math.min(Math.max(height, limits.minHeight), limits.maxHeight)
	};
}

function resizeLayoutFromCorner(
	start: YouTubeTabLayout,
	corner: ResizeCorner,
	deltaX: number,
	deltaY: number
) {
	const right = start.x + start.width;
	const bottom = start.y + start.height;
	if (corner === 'top-left') {
		const size = constrainResizeSize(start.width - deltaX, start.height - deltaY);
		return clampLayout({
			x: right - size.width,
			y: bottom - size.height,
			width: size.width,
			height: size.height
		});
	}
	if (corner === 'top-right') {
		const size = constrainResizeSize(start.width + deltaX, start.height - deltaY);
		return clampLayout({
			x: start.x,
			y: bottom - size.height,
			width: size.width,
			height: size.height
		});
	}
	if (corner === 'bottom-left') {
		const size = constrainResizeSize(start.width - deltaX, start.height + deltaY);
		return clampLayout({
			x: right - size.width,
			y: start.y,
			width: size.width,
			height: size.height
		});
	}
	return clampLayout({
		...start,
		width: start.width + deltaX,
		height: start.height + deltaY
	});
}

function safeNumber(value: number, fallback: number) {
	return Number.isFinite(value) ? value : fallback;
}

function isSameLayout(a: YouTubeTabLayout, b: YouTubeTabLayout) {
	return (
		Math.abs(a.x - b.x) < 0.5 &&
		Math.abs(a.y - b.y) < 0.5 &&
		Math.abs(a.width - b.width) < 0.5 &&
		Math.abs(a.height - b.height) < 0.5
	);
}

export function YouTubeFloatingTab({
	roomId,
	initialIndex = 0,
	state,
	onStateChange
}: YouTubeFloatingTabProps) {
	const reactId = useId();
	const playerElementId = `youtube-player-${reactId.replace(/:/g, '')}`;
	const storageKey = `sparkle:youtube-tab-layout:${roomId}:${state.id}`;
	const collapsedStorageKey = `sparkle:youtube-tab-collapsed:${roomId}:${state.id}`;
	const panelRef = useRef<HTMLDivElement | null>(null);
	const playerRef = useRef<YouTubePlayer | null>(null);
	const readyRef = useRef(false);
	const applyingRemoteRef = useRef(false);
	const lastAppliedVideoIdRef = useRef('');
	const stateRef = useRef(state);
	const playerReadyTimerRef = useRef<number | null>(null);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		x: number;
		y: number;
	} | null>(null);
	const dragCleanupRef = useRef<(() => void) | null>(null);
	const resizeRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		x: number;
		y: number;
		width: number;
		height: number;
		corner: ResizeCorner;
	} | null>(null);
	const resizeCleanupRef = useRef<(() => void) | null>(null);
	const [layoutReady, setLayoutReady] = useState(false);
	const [layout, setLayout] = useState<YouTubeTabLayout>({
		x: 24,
		y: 96,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT
	});
	const [zIndex, setZIndex] = useState(nextFloatingTabZIndex);
	const [urlInput, setUrlInput] = useState(state.url);
	const [urlError, setUrlError] = useState('');
	const [playerError, setPlayerError] = useState('');
	const [collapsed, setCollapsed] = useState(false);
	const [playerMountKey, setPlayerMountKey] = useState(0);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	useEffect(() => {
		return () => {
			dragCleanupRef.current?.();
			dragCleanupRef.current = null;
			resizeCleanupRef.current?.();
			resizeCleanupRef.current = null;
		};
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setUrlInput(state.url);
			setUrlError('');
		}, 0);
		return () => window.clearTimeout(timer);
	}, [state.url]);

	const saveLayout = useCallback(
		(next: YouTubeTabLayout) => {
			if (typeof window === 'undefined') {
				return;
			}
			window.localStorage.setItem(storageKey, JSON.stringify(next));
		},
		[storageKey]
	);

	const updateLayout = useCallback(
		(updater: YouTubeTabLayout | ((current: YouTubeTabLayout) => YouTubeTabLayout)) => {
			setLayout((current) => {
				const next = clampLayout(
					typeof updater === 'function' ? updater(current) : updater,
					collapsed ? COLLAPSED_HEIGHT : undefined
				);
				if (isSameLayout(current, next)) {
					return current;
				}
				saveLayout(next);
				return next;
			});
		},
		[collapsed, saveLayout]
	);

	const bringToFront = useCallback(() => {
		setZIndex(nextFloatingTabZIndex());
	}, []);

	const resetPlayerInstance = useCallback(() => {
		if (playerReadyTimerRef.current !== null) {
			window.clearTimeout(playerReadyTimerRef.current);
			playerReadyTimerRef.current = null;
		}
		if (playerRef.current) {
			try {
				playerRef.current.destroy();
			} catch {
				// YouTube can throw if the iframe was already removed by a fast tab close.
			}
			playerRef.current = null;
		}
		readyRef.current = false;
		lastAppliedVideoIdRef.current = '';
	}, []);

	const toggleCollapsed = useCallback(() => {
		const nextCollapsed = !collapsed;
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(collapsedStorageKey, String(nextCollapsed));
		}
		setCollapsed(nextCollapsed);
		setLayout((current) => {
			const next = clampLayout(current, nextCollapsed ? COLLAPSED_HEIGHT : undefined);
			if (isSameLayout(current, next)) {
				return current;
			}
			saveLayout(next);
			return next;
		});
	}, [collapsed, collapsedStorageKey, saveLayout]);

	useLayoutEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			const storedCollapsed = readStoredCollapsed(collapsedStorageKey);
			setLayout(
				clampLayout(
					readStoredLayout(storageKey) ?? getDefaultLayout(initialIndex),
					storedCollapsed ? COLLAPSED_HEIGHT : undefined
				)
			);
			setCollapsed(storedCollapsed);
			setLayoutReady(true);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [collapsedStorageKey, initialIndex, storageKey]);

	useEffect(() => {
		if (!state.open) {
			return;
		}
		const handleResize = () => updateLayout((current) => current);
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [state.open, updateLayout]);

	const applyStateToPlayer = useCallback((nextState: YouTubeTabSyncState, forceVideo = false) => {
		const player = playerRef.current;
		if (!player || !readyRef.current || !nextState.videoId) {
			return;
		}

		applyingRemoteRef.current = true;
		const targetTime = Math.max(0, safeNumber(nextState.time, 0));
		const playbackRate = safeNumber(nextState.playbackRate, 1) || 1;
		try {
			if (forceVideo || lastAppliedVideoIdRef.current !== nextState.videoId) {
				if (nextState.paused) {
					player.cueVideoById({ videoId: nextState.videoId, startSeconds: targetTime });
				} else {
					player.loadVideoById({ videoId: nextState.videoId, startSeconds: targetTime });
				}
				lastAppliedVideoIdRef.current = nextState.videoId;
			} else {
				const currentTime = safeNumber(player.getCurrentTime(), 0);
				if (Math.abs(currentTime - targetTime) > YOUTUBE_TIME_SYNC_THRESHOLD_SECONDS) {
					player.seekTo(targetTime, true);
				}
			}
			player.setPlaybackRate(playbackRate);
			if (nextState.paused) {
				player.pauseVideo();
			} else {
				player.playVideo();
			}
		} finally {
			window.setTimeout(() => {
				applyingRemoteRef.current = false;
			}, 700);
		}
	}, []);

	const emitPlayerState = useCallback(
		(patch: Partial<YouTubeTabSyncState>) => {
			if (applyingRemoteRef.current) {
				return;
			}
			const player = playerRef.current;
			const time = player
				? Math.max(0, safeNumber(player.getCurrentTime(), stateRef.current.time))
				: undefined;
			const playbackRate = player
				? Math.max(0.25, safeNumber(player.getPlaybackRate(), stateRef.current.playbackRate || 1))
				: undefined;
			onStateChange({
				...patch,
				...(time === undefined ? {} : { time }),
				...(playbackRate === undefined ? {} : { playbackRate })
			});
		},
		[onStateChange]
	);

	const handleYouTubeStateChange = useCallback(
		(playerState: number) => {
			const namespace = window.YT;
			if (!namespace) {
				return;
			}
			if (playerState === namespace.PlayerState.PLAYING) {
				emitPlayerState({ paused: false });
			} else if (
				playerState === namespace.PlayerState.PAUSED ||
				playerState === namespace.PlayerState.ENDED ||
				playerState === namespace.PlayerState.CUED
			) {
				emitPlayerState({ paused: true });
			}
		},
		[emitPlayerState]
	);

	const handlePlaybackRateChange = useCallback(
		(playbackRate: number) => {
			emitPlayerState({ playbackRate });
		},
		[emitPlayerState]
	);
	const handleYouTubeStateChangeRef = useRef(handleYouTubeStateChange);
	const handlePlaybackRateChangeRef = useRef(handlePlaybackRateChange);

	useEffect(() => {
		handleYouTubeStateChangeRef.current = handleYouTubeStateChange;
	}, [handleYouTubeStateChange]);

	useEffect(() => {
		handlePlaybackRateChangeRef.current = handlePlaybackRateChange;
	}, [handlePlaybackRateChange]);

	useEffect(() => {
		if (!state.open || !state.videoId || collapsed) {
			return;
		}
		if (isDiscordActivityEnvironment()) {
			return;
		}
		let cancelled = false;
		if (playerReadyTimerRef.current !== null) {
			window.clearTimeout(playerReadyTimerRef.current);
			playerReadyTimerRef.current = null;
		}
		loadYouTubeApi()
			.then((YT) => {
				if (cancelled || playerRef.current) {
					return;
				}
				playerRef.current = new YT.Player(playerElementId, {
					videoId: state.videoId,
					playerVars: {
						enablejsapi: 1,
						origin: window.location.origin,
						playsinline: 1,
						rel: 0
					},
					events: {
						onReady: () => {
							if (playerReadyTimerRef.current !== null) {
								window.clearTimeout(playerReadyTimerRef.current);
								playerReadyTimerRef.current = null;
							}
							readyRef.current = true;
							setPlayerError('');
							applyStateToPlayer(stateRef.current, true);
						},
						onStateChange: (event) => handleYouTubeStateChangeRef.current(event.data),
						onPlaybackRateChange: (event) => handlePlaybackRateChangeRef.current(event.data)
					}
				});
				playerReadyTimerRef.current = window.setTimeout(() => {
					if (cancelled || readyRef.current) {
						return;
					}
					resetPlayerInstance();
					setPlayerMountKey((key) => key + 1);
				}, 8000);
			})
			.catch((error) => {
				console.error(error);
				if (!cancelled) {
					setPlayerError('Unable to load the YouTube player.');
				}
			});
		return () => {
			cancelled = true;
			if (playerReadyTimerRef.current !== null) {
				window.clearTimeout(playerReadyTimerRef.current);
				playerReadyTimerRef.current = null;
			}
		};
	}, [
		applyStateToPlayer,
		collapsed,
		playerElementId,
		playerMountKey,
		resetPlayerInstance,
		state.open,
		state.videoId
	]);

	useEffect(() => {
		if (!state.open || !state.videoId) {
			return;
		}
		applyStateToPlayer(stateRef.current);
	}, [
		applyStateToPlayer,
		state.open,
		state.videoId,
		state.time,
		state.paused,
		state.playbackRate,
		state.updatedAt
	]);

	useEffect(() => {
		if (state.open) {
			return;
		}
		resetPlayerInstance();
	}, [resetPlayerInstance, state.open]);

	useEffect(() => {
		return () => {
			resetPlayerInstance();
		};
	}, [resetPlayerInstance]);

	useEffect(() => {
		if (!state.open || !state.videoId) {
			return;
		}
		const timer = window.setInterval(() => {
			const player = playerRef.current;
			const namespace = window.YT;
			if (!player || !namespace || !readyRef.current || applyingRemoteRef.current) {
				return;
			}
			const currentTime = Math.max(0, safeNumber(player.getCurrentTime(), 0));
			const playerState = player.getPlayerState();
			const playing = playerState === namespace.PlayerState.PLAYING;
			const previous = stateRef.current;
			const drift = Math.abs(currentTime - previous.time);
			if (
				(playing && drift >= YOUTUBE_TIME_SYNC_THRESHOLD_SECONDS) ||
				drift > YOUTUBE_TIME_SYNC_THRESHOLD_SECONDS
			) {
				emitPlayerState({ paused: !playing });
			}
		}, 1000);
		return () => window.clearInterval(timer);
	}, [emitPlayerState, state.open, state.videoId]);

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = parseYouTubeURL(urlInput);
		if (!parsed) {
			setUrlError('Enter a valid YouTube URL');
			return;
		}
		setUrlError('');
		setPlayerError('');
		onStateChange({
			open: true,
			url: normalizeYouTubeURL(parsed.videoId),
			videoId: parsed.videoId,
			time: parsed.startSeconds,
			paused: true,
			playbackRate: 1
		});
	}

	function closeTab() {
		const player = playerRef.current;
		onStateChange({
			open: false,
			paused: true,
			time: player ? Math.max(0, safeNumber(player.getCurrentTime(), state.time)) : state.time
		});
	}

	function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Window listeners below keep drag working when pointer capture is unavailable.
		}
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: layout.x,
			y: layout.y
		};
		dragCleanupRef.current?.();

		const handleWindowDragMove = (moveEvent: PointerEvent) => {
			applyDrag(moveEvent.pointerId, moveEvent.clientX, moveEvent.clientY);
		};
		const handleWindowDragEnd = (endEvent: PointerEvent) => {
			finishDrag(endEvent.pointerId);
		};

		window.addEventListener('pointermove', handleWindowDragMove);
		window.addEventListener('pointerup', handleWindowDragEnd);
		window.addEventListener('pointercancel', handleWindowDragEnd);
		dragCleanupRef.current = () => {
			window.removeEventListener('pointermove', handleWindowDragMove);
			window.removeEventListener('pointerup', handleWindowDragEnd);
			window.removeEventListener('pointercancel', handleWindowDragEnd);
		};
	}

	function applyDrag(pointerId: number, clientX: number, clientY: number) {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== pointerId) {
			return;
		}
		updateLayout({
			...layout,
			x: drag.x + clientX - drag.startX,
			y: drag.y + clientY - drag.startY
		});
	}

	function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
		applyDrag(event.pointerId, event.clientX, event.clientY);
	}

	function finishDrag(pointerId: number) {
		if (dragRef.current?.pointerId === pointerId) {
			dragRef.current = null;
			dragCleanupRef.current?.();
			dragCleanupRef.current = null;
		}
	}

	function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
		finishDrag(event.pointerId);
	}

	function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>, corner: ResizeCorner) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Window listeners below keep resize working when pointer capture is unavailable.
		}
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: layout.x,
			y: layout.y,
			width: layout.width,
			height: layout.height,
			corner
		};
		resizeCleanupRef.current?.();

		const handleWindowResizeMove = (moveEvent: PointerEvent) => {
			applyResize(moveEvent.pointerId, moveEvent.clientX, moveEvent.clientY);
		};
		const handleWindowResizeEnd = (endEvent: PointerEvent) => {
			finishResize(endEvent.pointerId);
		};

		window.addEventListener('pointermove', handleWindowResizeMove);
		window.addEventListener('pointerup', handleWindowResizeEnd);
		window.addEventListener('pointercancel', handleWindowResizeEnd);
		resizeCleanupRef.current = () => {
			window.removeEventListener('pointermove', handleWindowResizeMove);
			window.removeEventListener('pointerup', handleWindowResizeEnd);
			window.removeEventListener('pointercancel', handleWindowResizeEnd);
		};
	}

	function applyResize(pointerId: number, clientX: number, clientY: number) {
		const resize = resizeRef.current;
		if (!resize || resize.pointerId !== pointerId) {
			return;
		}
		updateLayout(
			resizeLayoutFromCorner(
				resize,
				resize.corner,
				clientX - resize.startX,
				clientY - resize.startY
			)
		);
	}

	function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
		applyResize(event.pointerId, event.clientX, event.clientY);
	}

	function finishResize(pointerId: number) {
		if (resizeRef.current?.pointerId === pointerId) {
			resizeRef.current = null;
			resizeCleanupRef.current?.();
			resizeCleanupRef.current = null;
		}
	}

	function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
		finishResize(event.pointerId);
	}

	if (!state.open || !layoutReady) {
		return null;
	}

	const embedBlockedMessage =
		state.videoId && isDiscordActivityEnvironment()
			? 'YouTube embeds are blocked inside Discord Activities.'
			: '';

	return (
		<div
			ref={panelRef}
			data-youtube-tab={state.id}
			data-collapsed={collapsed ? 'true' : 'false'}
			className={`fixed flex min-w-0 overflow-hidden rounded-lg border border-border bg-background shadow-2xl ${
				collapsed ? 'min-h-11' : 'min-h-0'
			}`}
			onFocusCapture={bringToFront}
			onPointerDownCapture={bringToFront}
			style={{
				left: layout.x,
				top: layout.y,
				width: layout.width,
				height: collapsed ? COLLAPSED_HEIGHT : layout.height,
				zIndex
			}}
		>
			<div className="flex min-h-0 w-full flex-col">
				<div
					className="flex h-11 shrink-0 cursor-move touch-none select-none items-center gap-2 border-b bg-muted/65 px-2"
					onPointerDown={handleDragStart}
					onPointerMove={handleDragMove}
					onPointerUp={handleDragEnd}
					onPointerCancel={handleDragEnd}
				>
					<IconGripVertical className="shrink-0 text-muted-foreground" size={18} stroke={2} />
					<IconBrandYoutubeFilled className="shrink-0 text-red-600" size={20} />
					<form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={handleSubmit}>
						<Input
							value={urlInput}
							onPointerDown={(event) => event.stopPropagation()}
							onChange={(event) => setUrlInput(event.target.value)}
							className="h-8 min-w-0 bg-background/95 text-sm"
							placeholder="YouTube URL"
							aria-label="YouTube URL"
						/>
						<Button
							type="submit"
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							onPointerDown={(event) => event.stopPropagation()}
							aria-label="Load YouTube URL"
						>
							<IconArrowRight size={17} stroke={2} />
						</Button>
					</form>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={toggleCollapsed}
						aria-label={collapsed ? 'Expand YouTube tab' : 'Collapse YouTube tab'}
						aria-expanded={!collapsed}
					>
						{collapsed ? (
							<IconChevronDown size={17} stroke={2} />
						) : (
							<IconChevronUp size={17} stroke={2} />
						)}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={closeTab}
						aria-label="Close YouTube tab"
					>
						<IconX size={17} stroke={2} />
					</Button>
				</div>
				{urlError && !collapsed ? (
					<div className="border-b bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
						{urlError}
					</div>
				) : null}
				<div
					className={`relative min-h-0 flex-1 bg-black ${collapsed ? 'hidden' : ''}`}
					aria-hidden={collapsed}
				>
					{state.videoId ? (
						embedBlockedMessage ? (
							<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm font-semibold text-white/70">
								<p>{embedBlockedMessage}</p>
								<Button asChild size="sm" variant="secondary">
									<a
										href={state.url || normalizeYouTubeURL(state.videoId)}
										target="_blank"
										rel="noreferrer"
									>
										Open YouTube
									</a>
								</Button>
							</div>
						) : (
							<>
								<div key={playerMountKey} id={playerElementId} className="h-full w-full" />
								{playerError ? (
									<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center text-sm font-semibold text-white/70">
										<p>{playerError}</p>
										<Button asChild size="sm" variant="secondary">
											<a
												href={state.url || normalizeYouTubeURL(state.videoId)}
												target="_blank"
												rel="noreferrer"
											>
												Open YouTube
											</a>
										</Button>
									</div>
								) : null}
							</>
						)
					) : (
						<div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-white/70">
							Enter a YouTube URL
						</div>
					)}
				</div>
			</div>
			{collapsed ? null : (
				<>
					<div
						className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
						onPointerDown={(event) => handleResizeStart(event, 'top-left')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
					<div
						className="absolute right-0 top-0 z-10 h-4 w-4 cursor-nesw-resize touch-none"
						onPointerDown={(event) => handleResizeStart(event, 'top-right')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
					<div
						className="absolute bottom-0 left-0 z-10 h-5 w-5 cursor-nesw-resize touch-none sm:h-4 sm:w-4"
						onPointerDown={(event) => handleResizeStart(event, 'bottom-left')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
					<div
						className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize touch-none sm:h-4 sm:w-4"
						onPointerDown={(event) => handleResizeStart(event, 'bottom-right')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
				</>
			)}
		</div>
	);
}
