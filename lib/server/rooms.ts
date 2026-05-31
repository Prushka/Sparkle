import { getBackendBaseUrl } from '@/lib/server/env';

type FetchOptions = Parameters<typeof fetch>[1];

export type RoomRecord = {
	roomId: string;
	mediaId: string;
	mediaUpdated?: number;
};

function roomUrl(roomId: string) {
	return `${getBackendBaseUrl()}/rooms/${encodeURIComponent(roomId)}`;
}

function fetchOptions(init?: FetchOptions): FetchOptions {
	const headers = new Headers(init?.headers);
	headers.set('Content-Type', 'application/json');
	return {
		cache: 'no-store',
		...init,
		headers
	};
}

export async function getRoomRecord(
	fetchFn: typeof fetch,
	roomId: string
): Promise<RoomRecord | null> {
	const response = await fetchFn(roomUrl(roomId), fetchOptions());
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Failed to load room ${roomId}: ${response.status}`);
	}
	return response.json();
}

export async function createRoomRecord(
	fetchFn: typeof fetch,
	mediaId?: string,
	roomId?: string | null
): Promise<RoomRecord> {
	const response = await fetchFn(
		`${getBackendBaseUrl()}/rooms`,
		fetchOptions({
			method: 'POST',
			body: JSON.stringify({
				...(mediaId ? { mediaId } : {}),
				...(roomId ? { roomId } : {})
			})
		})
	);
	if (!response.ok) {
		throw new Error(`Failed to create room: ${response.status}`);
	}
	return response.json();
}
