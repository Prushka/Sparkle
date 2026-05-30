import { NextResponse } from 'next/server';
import { getJobs } from '@/lib/server/jobs';
import { getRoomRecord } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> | { id: string } }
) {
	const resolvedParams = await Promise.resolve(params);
	const url = new URL(request.url);
	const legacyRoom = url.searchParams.get('room') || url.searchParams.get('channel_id');
	const roomId = legacyRoom || resolvedParams.id;
	const room = await getRoomRecord(fetch, roomId);
	const mediaId = room?.mediaId ?? resolvedParams.id;
	const to = `${url.protocol}//${url.host}/${room?.roomId ?? roomId}`;
	const jobs = await getJobs(fetch, mediaId);
	const job = jobs.find((candidate) => candidate.Id === mediaId);
	if (job) {
		let showType = 'a movie';
		const res: Record<string, string> = {
			provider_url: to
		};
		if (job.Title.episode) {
			showType = 'anime';
			res.author_name = job.Title.title;
			res.author_url = to;
		}
		res.provider_name = `It's time to watch ${showType} together!`;
		return NextResponse.json(res);
	}
	return NextResponse.json({
		author_name: `It's time to watch anime together!`,
		author_url: to,
		provider_url: to,
		provider_name: `Let's watch anime!`
	});
}
