'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LibraryHome } from '@/components/library-home';
import { Player } from '@/components/player/Player';
import {
	createRoomRecord,
	fetchMediaData,
	fetchRoomRecord,
	loadRuntimeConfig,
	resetClientDataCache,
	type RuntimeConfig
} from '@/lib/player/data';
import type { ServerData } from '@/lib/player/t';

type SearchValues = {
	legacyRoomId?: string;
	redirectQuery?: string;
};

type LoadState =
	| { status: 'loading' }
	| { status: 'library'; config: RuntimeConfig; roomId: string }
	| { status: 'player'; data: ServerData }
	| { status: 'error'; message: string };

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
	roomId,
	searchValues
}: {
	roomId: string;
	searchValues: SearchValues;
}) {
	const [state, setState] = useState<LoadState>({ status: 'loading' });
	const [retryKey, setRetryKey] = useState(0);
	const lastMediaKeyRef = useRef('');
	const loadGenerationRef = useRef(0);
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
			let effectiveRoomId = roomId;

			if (searchValues.legacyRoomId && searchValues.legacyRoomId !== roomId) {
				const legacy = await fetchRoomRecord(config.backendBaseUrl, searchValues.legacyRoomId);
				if (loadGenerationRef.current !== generation) {
					return;
				}
				if (!legacy) {
					await createRoomRecord(config.backendBaseUrl, roomId, searchValues.legacyRoomId);
					if (loadGenerationRef.current !== generation) {
						return;
					}
				}
				effectiveRoomId = searchValues.legacyRoomId;
				window.history.replaceState(
					null,
					'',
					`/${encodeURIComponent(effectiveRoomId)}${redirectSuffix}`
				);
			}

			const room = await fetchRoomRecord(config.backendBaseUrl, effectiveRoomId);
			if (loadGenerationRef.current !== generation) {
				return;
			}
			if (!room) {
				window.location.replace('/');
				return;
			}
			if (!room.mediaId) {
				lastMediaKeyRef.current = '';
				setState({ status: 'library', config, roomId: effectiveRoomId });
				return;
			}

			const mediaKey = `${effectiveRoomId}:${room.mediaId}:${room.mediaUpdated ?? 0}`;
			const data = await fetchMediaData(room.mediaId, effectiveRoomId, config);
			if (loadGenerationRef.current !== generation) {
				return;
			}
			lastMediaKeyRef.current = mediaKey;
			setState({ status: 'player', data });
		},
		[redirectSuffix, roomId, searchValues.legacyRoomId]
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

	const handleRoomMediaChanged = useCallback(
		async (mediaId: string, mediaUpdated?: number) => {
			if (state.status !== 'player' && state.status !== 'library') {
				return;
			}
			const currentRoomId = state.status === 'player' ? state.data.roomId : state.roomId;
			const config =
				state.status === 'player'
					? {
							backendBaseUrl: state.data.backendBaseUrl,
							staticBaseUrl: state.data.staticBaseUrl
						}
					: state.config;
			const mediaKey = `${currentRoomId}:${mediaId}:${mediaUpdated ?? 0}`;
			if (lastMediaKeyRef.current === mediaKey) {
				return;
			}
			try {
				const generation = loadGenerationRef.current + 1;
				loadGenerationRef.current = generation;
				if (state.status === 'library') {
					setState({ status: 'loading' });
				}
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
		[state]
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
				onRoomMediaChanged={handleRoomMediaChanged}
			/>
		);
	}
	return <Player data={state.data} onRoomMediaChanged={handleRoomMediaChanged} />;
}
