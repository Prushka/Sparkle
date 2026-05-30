import { NextResponse } from 'next/server';
import { getRoomRecord } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const room = url.searchParams.get('room') || url.searchParams.get('channel_id');
		if (room) {
			const record = await getRoomRecord(fetch, room);
			return NextResponse.json({ jobId: record?.mediaId });
		}
		return NextResponse.json({ error: 'Missing room' }, { status: 400 });
	} catch (error) {
		console.error(error);
		return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
	}
}
