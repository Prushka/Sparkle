import { preprocessJobs, type Job } from '@/lib/player/t';
import { getBackendBaseUrl } from '@/lib/server/env';

type SparkleServerState = {
	jobs?: Job[];
	jobsLastFetched?: number;
	roomMapping?: Record<string, string>;
};

const globalState = globalThis as typeof globalThis & SparkleServerState;

export const roomMapping: Record<string, string> =
	globalState.roomMapping ?? (globalState.roomMapping = {});

export async function getJobs(
	fetchFn: typeof fetch,
	target: string | null = null,
	host?: string
): Promise<Job[]> {
	if (
		Date.now() - (globalState.jobsLastFetched ?? 0) > 1000 * 10 ||
		(target !== null && !(globalState.jobs ?? []).find((job) => job.Id === target))
	) {
		console.log(new Date(), 'Fetching jobs');
		const jobsResponse = await fetchFn(`${getBackendBaseUrl(host)}/all`);
		globalState.jobs = preprocessJobs(await jobsResponse.json());
		globalState.jobsLastFetched = Date.now();
	}
	return globalState.jobs ?? [];
}
