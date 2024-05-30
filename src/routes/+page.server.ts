import { type Job, preprocessJobs } from '$lib/player/t';
import { env } from '$env/dynamic/private';

export async function load({ params }) {
	let jobs : Job[] = []
	try {
		const jobsResponse = await fetch(`${env.SERVER_BE}/all`);
		jobs = await jobsResponse.json();
		jobs = preprocessJobs(jobs)
	}catch (e) {
		console.log(params, e);
	}
	return {
		jobs
	};
}
