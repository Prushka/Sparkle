import { json } from '@sveltejs/kit';
import { getTitleComponents } from '$lib/player/t';
import { getJobs } from '../../../cache';

export async function GET({url,params,fetch}) {
	const { id } = params;
	const to = `https://${url.host}/${id}`;
	const jobs = await getJobs(fetch, id)
	const job = jobs.find(j => j.Id === id)
	if (job) {
		const titleComponents = getTitleComponents(job)
		let showType = 'a movie'
		const res : any = {
			"provider_url": to,
		}
		if (titleComponents.episodes) {
			showType = 'anime'
			res.author_name = titleComponents.title
			res.author_url = to
		}
		res.provider_name = `It's time to watch ${showType} with Hmph!`
		return json(res);
	}
	return json({
		author_name: `It's time to watch anime with Hmph!`,
		author_url: to,
		provider_url: to,
		provider_name: `Let's watch anime!`
	});
}
