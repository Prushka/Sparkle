import { NextResponse } from 'next/server';
import { roomMapping } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const room = url.searchParams.get('room') || url.searchParams.get('channel_id');
		if (room) {
			return NextResponse.json({ jobId: roomMapping[room] });
		}
		return NextResponse.json({ error: 'Missing room' }, { status: 400 });
	} catch (error) {
		console.error(error);
		return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
	}
}
