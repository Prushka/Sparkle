import { NextResponse } from 'next/server';
import { getJobs } from '@/lib/server/jobs';
import { getRoomRecord } from '@/lib/server/rooms';
import { getBrowserStaticBaseUrl } from '@/lib/server/env';
import { getRequestOrigin, toAbsoluteUrl } from '@/lib/server/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> | { id: string } }
) {
	const resolvedParams = await Promise.resolve(params);
	const url = new URL(request.url);
	const origin = getRequestOrigin(request.headers);
	const legacyRoom = url.searchParams.get('room') || url.searchParams.get('channel_id');
	const roomId = legacyRoom || resolvedParams.id;
	const room = await getRoomRecord(fetch, roomId);
	const mediaId = room?.mediaId ?? resolvedParams.id;
	const to = toAbsoluteUrl(`/${room?.roomId ?? roomId}`, origin);
	const jobs = await getJobs(fetch, mediaId);
	const job = jobs.find((candidate) => candidate.Id === mediaId);
	if (job) {
		let showType = 'a movie';
		const displayTitle = job.Title.episode
			? `${job.Title.episode.se} - ${job.Title.episode.title}`
			: job.Title.title;
		const thumbnailUrl = toAbsoluteUrl(`${getBrowserStaticBaseUrl()}/${job.Id}/poster.jpg`, origin);
		const res: Record<string, string | number> = {
			version: '1.0',
			type: 'link',
			title: displayTitle,
			thumbnail_url: thumbnailUrl,
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
		version: '1.0',
		type: 'link',
		author_name: `It's time to watch anime together!`,
		author_url: to,
		provider_url: to,
		provider_name: `Let's watch anime!`
	});
}
