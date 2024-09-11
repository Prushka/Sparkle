import { json } from '@sveltejs/kit';
import { getJobs } from '../../../cache';

export async function GET({url,params,fetch}) {
	const { id } = params;
	const room = url.searchParams.get('room') || url.searchParams.get('channel_id');
	const to = room ? `https://${url.host}/${id}?room=${room}` : `https://${url.host}/${id}`;
	const jobs = await getJobs(fetch, id)
	const job = jobs.find(j => j.Id === id)
	if (job) {
		let showType = 'a movie'
		const res : any = {
			"provider_url": to,
		}
		if (job.Title.episode) {
			showType = 'anime'
			res.author_name = job.Title.title
			res.author_url = to
		}
		res.provider_name = `It's time to watch ${showType} together!`
		return json(res);
	}
	return json({
		author_name: `It's time to watch anime together!`,
		author_url: to,
		provider_url: to,
		provider_name: `Let's watch anime!`
	});
}
