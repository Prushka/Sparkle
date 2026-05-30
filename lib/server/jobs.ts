import { preprocessJobs, type Job } from '@/lib/player/t';
import { getBackendBaseUrl } from '@/lib/server/env';

type SparkleServerState = {
	jobs?: Job[];
	jobsLastFetched?: number;
};

const globalState = globalThis as typeof globalThis & SparkleServerState;
const JOBS_CACHE_MS = 60_000;

export async function getJobs(fetchFn: typeof fetch, target: string | null = null): Promise<Job[]> {
	if (
		Date.now() - (globalState.jobsLastFetched ?? 0) > JOBS_CACHE_MS ||
		(target !== null && !(globalState.jobs ?? []).find((job) => job.Id === target))
	) {
		console.log(new Date(), 'Fetching jobs');
		const jobsResponse = await fetchFn(`${getBackendBaseUrl()}/all`);
		globalState.jobs = preprocessJobs(await jobsResponse.json());
		globalState.jobsLastFetched = Date.now();
	}
	return globalState.jobs ?? [];
}
