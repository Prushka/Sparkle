import { json } from '@sveltejs/kit';
import { getTitleComponents, preprocessJob } from '$lib/player/t';
import { env } from '$env/dynamic/private';

export async function GET({url,params,fetch}) {
	const { id } = params;
	const to = `https://${url.host}/${id}`;
	const jobResponse = await fetch(`${env.SERVER_BE}/job/${id}`);
	let job = await jobResponse.json();
	job = preprocessJob(job)
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
