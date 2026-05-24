import { NextResponse } from 'next/server';
import { getJobs } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> | { id: string } }
) {
	const resolvedParams = await Promise.resolve(params);
	const url = new URL(request.url);
	const room = url.searchParams.get('room') || url.searchParams.get('channel_id');
	const to = room
		? `https://${url.host}/${resolvedParams.id}?room=${room}`
		: `https://${url.host}/${resolvedParams.id}`;
	const jobs = await getJobs(fetch, resolvedParams.id);
	const job = jobs.find((candidate) => candidate.Id === resolvedParams.id);
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
