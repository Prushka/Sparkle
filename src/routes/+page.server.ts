import { type Job } from '$lib/player/t';
import { roomMapping, getJobs } from '../cache';
import { redirect } from '@sveltejs/kit';

export async function load({ params, url }) {
	let jobs : Job[] = []
	const room = url.searchParams.get('room') || url.searchParams.get('channel_id');
	if (room && roomMapping[room]) {
		redirect(302, `/${roomMapping[room]}?room=${room}`);
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
