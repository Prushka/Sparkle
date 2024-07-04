import { type Job } from '$lib/player/t';
import { channelMapping, getJobs } from '../cache';
import { redirect } from '@sveltejs/kit';

export async function load({ params, url }) {
	let jobs : Job[] = []
	const channelId = url.searchParams.get('channel_id')
	if (channelId && channelMapping[channelId]) {
		redirect(302, `/${channelMapping[channelId]}`);
	}
	try {
		jobs = await getJobs(fetch)
	}catch (e) {
		console.log(params, e);
	}
	return {
		jobs
	};
}
