import { redirect } from 'next/navigation';
import { createRoomRecord } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectQuery(url: URL) {
	const params = new URLSearchParams(url.searchParams);
	params.delete('mediaId');
	params.delete('room');
	const query = params.toString();
	return query ? `?${query}` : '';
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const mediaId = url.searchParams.get('mediaId')?.trim() || '';
	const requestedRoomId =
		url.searchParams.get('room')?.trim() || url.searchParams.get('channel_id')?.trim() || '';

	if (!mediaId) {
		redirect('/');
	}

	let roomId: string;
	try {
		const room = await createRoomRecord(fetch, mediaId, requestedRoomId || undefined);
		roomId = room.roomId;
	} catch (error) {
		console.error('Unable to create room', error);
		redirect('/');
	}
	redirect(`/${roomId}${redirectQuery(url)}`);
}
