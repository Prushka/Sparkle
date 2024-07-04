
import { env } from '$env/dynamic/private';
import { type Job, preprocessJobs } from '$lib/player/t';
let cachedJobs: Job[] = [];
let jobsLastFetched = 0;

export async function getJobs(fetch: any): Promise<Job[]> {
	if (Date.now() - jobsLastFetched > 1000 * 60) {
		console.log(new Date(), 'Fetching jobs');
		const jobsResponse = await fetch(`${env.SERVER_BE}/all`);
		cachedJobs = preprocessJobs(await jobsResponse.json());
		jobsLastFetched = Date.now();
	}
	return cachedJobs;
}
