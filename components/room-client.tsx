'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LibraryHome } from '@/components/library-home';
import { Player } from '@/components/player/Player';
import {
	createRoomRecord,
	fetchMediaData,
	fetchRoomRecord,
	loadRuntimeConfig,
	resetClientDataCache,
	updateRoomRecord,
	type RuntimeConfig
} from '@/lib/player/data';
import type { ServerData } from '@/lib/player/t';

type RoomRoute =
	| { roomId: string; view: 'library' }
	| { roomId: string; view: 'media'; mediaId: string };

type SearchValues = {
	legacyRoomId?: string;
	legacyMediaId?: string;
	redirectQuery?: string;
};

function getRedirectQuery(searchParams: URLSearchParams) {
	const params = new URLSearchParams(searchParams.toString());
	params.delete('room');
	params.delete('mediaId');
	const query = params.toString();
	return query || undefined;
}

function buildMediaPath(roomId: string, mediaId: string, suffix = '') {
	return `/${encodeURIComponent(roomId)}/media/${encodeURIComponent(mediaId)}${suffix}`;
}

type LoadState =
	| { status: 'loading' }
	| { status: 'library'; config: RuntimeConfig; roomId: string }
	| { status: 'player'; data: ServerData }
	| { status: 'error'; message: string };

function setThemeColor(color: string) {
	let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!theme) {
		theme = document.createElement('meta');
		theme.name = 'theme-color';
		document.head.appendChild(theme);
	}
	theme.content = color;
}

function LoadingView() {
	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-[#08090d] px-4 text-zinc-200">
			<div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm shadow-2xl shadow-black/25">
				Loading...
			</div>
		</main>
	);
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-[#08090d] px-4 text-zinc-200">
			<div className="max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
				<h1 className="text-base font-semibold text-white">Unable to load room</h1>
				<p className="mt-2 text-sm text-zinc-400">{message}</p>
				<button
					type="button"
					onClick={onRetry}
					className="mt-4 rounded-md bg-white px-3 py-2 text-sm font-semibold text-zinc-950"
				>
					Retry
				</button>
			</div>
		</main>
	);
}

export function RoomClient({
	route
}: {
	route: RoomRoute;
}) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [state, setState] = useState<LoadState>({ status: 'loading' });
	const [retryKey, setRetryKey] = useState(0);
	const lastMediaKeyRef = useRef('');
	const loadGenerationRef = useRef(0);
	const searchValues = useMemo<SearchValues>(
		() => ({
			legacyRoomId:
				searchParams.get('room')?.trim() ||
				searchParams.get('channel_id')?.trim() ||
				undefined,
			legacyMediaId: searchParams.get('mediaId')?.trim() || undefined,
			redirectQuery: getRedirectQuery(searchParams)
		}),
		[searchParams]
	);
	const redirectSuffix = useMemo(
		() => (searchValues.redirectQuery ? `?${searchValues.redirectQuery}` : ''),
		[searchValues.redirectQuery]
	);

	const loadRoom = useCallback(
		async (generation: number) => {
			setState({ status: 'loading' });
			const config = await loadRuntimeConfig();
			if (loadGenerationRef.current !== generation) {
				return;
			}
			let effectiveRoomId = route.roomId;
			let routeMediaId = route.view === 'media' ? route.mediaId : searchValues.legacyMediaId;

			if (searchValues.legacyRoomId && searchValues.legacyRoomId !== route.roomId) {
				const legacy = await fetchRoomRecord(config.backendBaseUrl, searchValues.legacyRoomId);
				if (loadGenerationRef.current !== generation) {
					return;
				}
				if (!legacy) {
					await createRoomRecord(
						config.backendBaseUrl,
						routeMediaId || route.roomId,
						searchValues.legacyRoomId
					);
					if (loadGenerationRef.current !== generation) {
						return;
					}
				}
				effectiveRoomId = searchValues.legacyRoomId;
				routeMediaId = routeMediaId || route.roomId;
				router.replace(buildMediaPath(effectiveRoomId, routeMediaId, redirectSuffix));
				return;
			}

			const room = await fetchRoomRecord(config.backendBaseUrl, effectiveRoomId);
			if (loadGenerationRef.current !== generation) {
				return;
			}
			if (!room) {
				router.replace('/');
				return;
			}

			if (!routeMediaId) {
				lastMediaKeyRef.current = '';
				setState({ status: 'library', config, roomId: effectiveRoomId });
				return;
			}

			if (route.view !== 'media') {
				router.replace(buildMediaPath(effectiveRoomId, routeMediaId, redirectSuffix));
				return;
			}

			let mediaUpdated = room.mediaUpdated;
			if (room.mediaId !== routeMediaId) {
				const updated = await updateRoomRecord(config.backendBaseUrl, effectiveRoomId, routeMediaId);
				if (loadGenerationRef.current !== generation) {
					return;
				}
				mediaUpdated = updated.mediaUpdated;
			}

			const mediaKey = `${effectiveRoomId}:${routeMediaId}:${mediaUpdated ?? 0}`;
			const data = await fetchMediaData(routeMediaId, effectiveRoomId, config);
			if (loadGenerationRef.current !== generation) {
				return;
			}
			lastMediaKeyRef.current = mediaKey;
			setState({ status: 'player', data });
		},
		[
			redirectSuffix,
			route,
			router,
			searchValues.legacyMediaId,
			searchValues.legacyRoomId
		]
	);

	useEffect(() => {
		let disposed = false;
		const generation = loadGenerationRef.current + 1;
		loadGenerationRef.current = generation;
		void loadRoom(generation).catch((caught) => {
			if (!disposed && loadGenerationRef.current === generation) {
				setState({
					status: 'error',
					message: caught instanceof Error ? caught.message : 'Unknown error'
				});
			}
		});
		return () => {
			disposed = true;
		};
	}, [loadRoom, retryKey]);

	useEffect(() => {
		if (state.status === 'player') {
			document.title = state.data.displayTitle;
			setThemeColor(state.data.dominantColor);
			return;
		}
		document.title = "It's anime time!";
		setThemeColor('#f0f0f0');
	}, [state]);

	const handleRoomMediaChanged = useCallback(
		async (mediaId: string, mediaUpdated?: number) => {
			const currentRoomId = state.status === 'player' ? state.data.roomId : route.roomId;
			const nextPath = buildMediaPath(currentRoomId, mediaId, redirectSuffix);
			const currentPath = `${window.location.pathname}${window.location.search}`;
			if (currentPath !== nextPath) {
				router.push(nextPath);
				return;
			}
			if (state.status !== 'player') {
				return;
			}
			const config = {
				backendBaseUrl: state.data.backendBaseUrl,
				staticBaseUrl: state.data.staticBaseUrl
			};
			const mediaKey = `${currentRoomId}:${mediaId}:${mediaUpdated ?? 0}`;
			if (lastMediaKeyRef.current === mediaKey) {
				return;
			}
			try {
				const generation = loadGenerationRef.current + 1;
				loadGenerationRef.current = generation;
				const data = await fetchMediaData(mediaId, currentRoomId, config);
				if (loadGenerationRef.current !== generation) {
					return;
				}
				lastMediaKeyRef.current = mediaKey;
				setState({ status: 'player', data });
			} catch (caught) {
				setState({
					status: 'error',
					message: caught instanceof Error ? caught.message : 'Unknown error'
				});
			}
		},
		[redirectSuffix, route.roomId, router, state]
	);

	if (state.status === 'loading') {
		return <LoadingView />;
	}
	if (state.status === 'error') {
		return (
			<ErrorView
				message={state.message}
				onRetry={() => {
					resetClientDataCache();
					setRetryKey((value) => value + 1);
				}}
			/>
		);
	}
	if (state.status === 'library') {
		return (
			<LibraryHome
				staticBaseUrl={state.config.staticBaseUrl}
				backendBaseUrl={state.config.backendBaseUrl}
				roomId={state.roomId}
			/>
		);
	}
	return <Player data={state.data} onRoomMediaChanged={handleRoomMediaChanged} />;
}
