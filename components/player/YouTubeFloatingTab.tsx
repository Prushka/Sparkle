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
	IconArrowsDiagonal,
	IconBrandYoutubeFilled,
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
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

let youTubeApiPromise: Promise<YouTubeNamespace> | null = null;
let youtubeTabZIndexCounter = 120;

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
			reject(new Error('Timed out loading the YouTube player API'));
		}, 15000);

		window.onYouTubeIframeAPIReady = () => {
			previousReady?.();
			window.clearTimeout(timeout);
			if (window.YT?.Player) {
				resolve(window.YT);
			} else {
				reject(new Error('YouTube player API loaded without a player constructor'));
			}
		};

		if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
			const script = document.createElement('script');
			script.src = 'https://www.youtube.com/iframe_api';
			script.async = true;
			script.onerror = () => {
				window.clearTimeout(timeout);
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

function getDefaultLayout(initialIndex = 0): YouTubeTabLayout {
	if (typeof window === 'undefined') {
		return { x: 24, y: 96, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
	}
	const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 32));
	const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 32));
	const offset = Math.min(160, Math.max(0, initialIndex) * 32);
	return {
		x: Math.max(16, window.innerWidth - width - 24 - offset),
		y: Math.min(96 + offset, Math.max(16, window.innerHeight - height - 24)),
		width,
		height
	};
}

function clampLayout(layout: YouTubeTabLayout): YouTubeTabLayout {
	if (typeof window === 'undefined') {
		return layout;
	}
	const width = Math.min(
		Math.max(layout.width, MIN_WIDTH),
		Math.max(MIN_WIDTH, window.innerWidth - 16)
	);
	const height = Math.min(
		Math.max(layout.height, MIN_HEIGHT),
		Math.max(MIN_HEIGHT, window.innerHeight - 16)
	);
	return {
		x: Math.min(Math.max(8, layout.x), Math.max(8, window.innerWidth - width - 8)),
		y: Math.min(Math.max(8, layout.y), Math.max(8, window.innerHeight - height - 8)),
		width,
		height
	};
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
	const panelRef = useRef<HTMLDivElement | null>(null);
	const playerRef = useRef<YouTubePlayer | null>(null);
	const readyRef = useRef(false);
	const applyingRemoteRef = useRef(false);
	const lastAppliedVideoIdRef = useRef('');
	const stateRef = useRef(state);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		x: number;
		y: number;
	} | null>(null);
	const resizeRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		width: number;
		height: number;
	} | null>(null);
	const [layoutReady, setLayoutReady] = useState(false);
	const [layout, setLayout] = useState<YouTubeTabLayout>({
		x: 24,
		y: 96,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT
	});
	const [zIndex, setZIndex] = useState(() => ++youtubeTabZIndexCounter);
	const [urlInput, setUrlInput] = useState(state.url);
	const [urlError, setUrlError] = useState('');

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

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
				const next = clampLayout(typeof updater === 'function' ? updater(current) : updater);
				if (isSameLayout(current, next)) {
					return current;
				}
				saveLayout(next);
				return next;
			});
		},
		[saveLayout]
	);

	const bringToFront = useCallback(() => {
		youtubeTabZIndexCounter += 1;
		setZIndex(youtubeTabZIndexCounter);
	}, []);

	useLayoutEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			setLayout(clampLayout(readStoredLayout(storageKey) ?? getDefaultLayout(initialIndex)));
			setLayoutReady(true);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [initialIndex, storageKey]);

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
				if (Math.abs(currentTime - targetTime) > 2.5) {
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
		if (!state.open || !state.videoId) {
			return;
		}
		let cancelled = false;
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
							readyRef.current = true;
							applyStateToPlayer(stateRef.current, true);
						},
						onStateChange: (event) => handleYouTubeStateChangeRef.current(event.data),
						onPlaybackRateChange: (event) => handlePlaybackRateChangeRef.current(event.data)
					}
				});
			})
			.catch((error) => {
				console.error(error);
			});
		return () => {
			cancelled = true;
		};
	}, [applyStateToPlayer, playerElementId, state.open, state.videoId]);

	useEffect(() => {
		if (!state.open || !state.videoId) {
			return;
		}
		applyStateToPlayer(state);
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
		if (playerRef.current) {
			playerRef.current.destroy();
			playerRef.current = null;
		}
		readyRef.current = false;
		lastAppliedVideoIdRef.current = '';
	}, [state.open]);

	useEffect(() => {
		return () => {
			if (playerRef.current) {
				playerRef.current.destroy();
				playerRef.current = null;
			}
			readyRef.current = false;
		};
	}, []);

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
			if ((playing && drift >= 2) || drift > 3) {
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
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: layout.x,
			y: layout.y
		};
	}

	function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		updateLayout({
			...layout,
			x: drag.x + event.clientX - drag.startX,
			y: drag.y + event.clientY - drag.startY
		});
	}

	function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
		if (dragRef.current?.pointerId === event.pointerId) {
			dragRef.current = null;
		}
	}

	function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			width: layout.width,
			height: layout.height
		};
	}

	function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
		const resize = resizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) {
			return;
		}
		updateLayout({
			...layout,
			width: resize.width + event.clientX - resize.startX,
			height: resize.height + event.clientY - resize.startY
		});
	}

	function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
		if (resizeRef.current?.pointerId === event.pointerId) {
			resizeRef.current = null;
		}
	}

	if (!state.open || !layoutReady) {
		return null;
	}

	return (
		<div
			ref={panelRef}
			data-youtube-tab={state.id}
			className="fixed flex min-h-[260px] min-w-[320px] overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
			onFocusCapture={bringToFront}
			onPointerDownCapture={bringToFront}
			style={{
				left: layout.x,
				top: layout.y,
				width: layout.width,
				height: layout.height,
				zIndex
			}}
		>
			<div className="flex min-h-0 w-full flex-col">
				<div
					className="flex h-11 shrink-0 cursor-move items-center gap-2 border-b bg-muted/65 px-2"
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
						onClick={closeTab}
						aria-label="Close YouTube tab"
					>
						<IconX size={17} stroke={2} />
					</Button>
				</div>
				{urlError ? (
					<div className="border-b bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
						{urlError}
					</div>
				) : null}
				<div className="relative min-h-0 flex-1 bg-black">
					{state.videoId ? (
						<div id={playerElementId} className="h-full w-full" />
					) : (
						<div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-white/70">
							Enter a YouTube URL
						</div>
					)}
				</div>
			</div>
			<div
				className="absolute bottom-0 right-0 flex h-7 w-7 cursor-nwse-resize touch-none items-end justify-end p-1.5 text-muted-foreground/70"
				onPointerDown={handleResizeStart}
				onPointerMove={handleResizeMove}
				onPointerUp={handleResizeEnd}
				onPointerCancel={handleResizeEnd}
				aria-hidden="true"
			>
				<IconArrowsDiagonal size={15} stroke={2} />
			</div>
		</div>
	);
}
