import { getBackendBaseUrl } from '@/lib/server/env';

export type RoomRecord = {
	roomId: string;
	mediaId: string;
	mediaUpdated?: number;
};

export async function getRoomPreviewRecord(
	fetchFn: typeof fetch,
	roomId: string
): Promise<RoomRecord | null> {
	const response = await fetchFn(
		`${getBackendBaseUrl()}/share/rooms/${encodeURIComponent(roomId)}`,
		{ cache: 'no-store' }
	);
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`Failed to load room preview ${roomId}: ${response.status}`);
	}
	return response.json();
}
