import { preprocessJob, type Job } from '@/lib/player/t';
import { getBackendBaseUrl } from '@/lib/server/env';

export async function getJob(fetchFn: typeof fetch, target: string): Promise<Job | null> {
	const response = await fetchFn(`${getBackendBaseUrl()}/media/${encodeURIComponent(target)}`, {
		cache: 'no-store'
	});
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Failed to load media ${target}: ${response.status}`);
	}
	return preprocessJob(await response.json());
}
