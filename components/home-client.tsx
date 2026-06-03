'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createRoomRecord, loadRuntimeConfig, resetClientDataCache } from '@/lib/player/data';

type SearchValues = {
	mediaId?: string;
	requestedRoomId?: string;
	redirectQuery?: string;
};

function getRedirectQuery(searchParams: URLSearchParams) {
	const params = new URLSearchParams(searchParams.toString());
	params.delete('mediaId');
	params.delete('room');
	const query = params.toString();
	return query || undefined;
}

function LoadingView() {
	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-[#08090d] px-4 text-zinc-200">
			<div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm shadow-2xl shadow-black/25">
				Loading room...
			</div>
		</main>
	);
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-[#08090d] px-4 text-zinc-200">
			<div className="max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
				<h1 className="text-base font-semibold text-white">Unable to start room</h1>
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

export function HomeClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [error, setError] = useState('');
	const [retryKey, setRetryKey] = useState(0);
	const searchValues = useMemo<SearchValues>(
		() => ({
			mediaId: searchParams.get('mediaId')?.trim() || undefined,
			requestedRoomId:
				searchParams.get('room')?.trim() || searchParams.get('channel_id')?.trim() || undefined,
			redirectQuery: getRedirectQuery(searchParams)
		}),
		[searchParams]
	);
	const redirectSuffix = useMemo(
		() => (searchValues.redirectQuery ? `?${searchValues.redirectQuery}` : ''),
		[searchValues.redirectQuery]
	);

	useEffect(() => {
		document.title = "It's anime time!";
	}, []);

	useEffect(() => {
		let disposed = false;

		async function boot() {
			setError('');
			try {
				const runtimeConfig = await loadRuntimeConfig();
				if (disposed) {
					return;
				}
				const room = await createRoomRecord(
					runtimeConfig.backendBaseUrl,
					searchValues.mediaId,
					searchValues.requestedRoomId
				);
				if (disposed) {
					return;
				}
				const roomPath = searchValues.mediaId
					? `/${encodeURIComponent(room.roomId)}/media/${encodeURIComponent(searchValues.mediaId)}`
					: `/${encodeURIComponent(room.roomId)}`;
				router.replace(`${roomPath}${redirectSuffix}`);
			} catch (caught) {
				if (!disposed) {
					setError(caught instanceof Error ? caught.message : 'Unknown error');
				}
			}
		}

		void boot();
		return () => {
			disposed = true;
		};
	}, [redirectSuffix, retryKey, router, searchValues.mediaId, searchValues.requestedRoomId]);

	if (error) {
		return (
			<ErrorView
				message={error}
				onRetry={() => {
					resetClientDataCache();
					setRetryKey((value) => value + 1);
				}}
			/>
		);
	}
	return <LoadingView />;
}
