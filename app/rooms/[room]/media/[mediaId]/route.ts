import { redirect } from 'next/navigation';
import { updateRoomRecord } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
	_request: Request,
	{
		params
	}: { params: Promise<{ room: string; mediaId: string }> | { room: string; mediaId: string } }
) {
	const { room, mediaId } = await Promise.resolve(params);
	const roomId = room.trim();
	const nextMediaId = mediaId.trim();

	if (roomId && nextMediaId) {
		try {
			await updateRoomRecord(fetch, roomId, nextMediaId);
		} catch (error) {
			console.error('Unable to update room media', error);
		}
	}

	redirect(`/${encodeURIComponent(roomId)}`);
}
