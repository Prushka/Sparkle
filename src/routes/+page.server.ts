import { type Job } from '$lib/player/t';
import { getJobs } from '../cache';

export async function load({ params }) {
	let jobs : Job[] = []
	try {
		jobs = await getJobs(fetch)
	}catch (e) {
		console.log(params, e);
	}
	return {
		jobs
	};
}
