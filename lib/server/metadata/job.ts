import type { Job } from '@/lib/player/t';
import { getStaticBaseUrl } from '@/lib/server/env';
import * as cheerio from 'cheerio';

export const fallbackDescription = 'Choose something to watch together.';

function getFallbackJobDescription(job: Job) {
	const title = job.Title.title.trim();
	if (job.Title.episode) {
		const episodeTitle = [job.Title.episode.se, job.Title.episode.title.trim()]
			.filter(Boolean)
			.join(' - ');
		const fullTitle = [title, episodeTitle].filter(Boolean).join(': ');
		return fullTitle ? `Watch ${fullTitle} together.` : fallbackDescription;
	}
	return title ? `Watch ${title} together.` : fallbackDescription;
}

export async function getJobDescription(fetchFn: typeof fetch, job: Job) {
	try {
		const response = await fetchFn(`${getStaticBaseUrl()}/${encodeURIComponent(job.Id)}/info.nfo`, {
			cache: 'no-store'
		});
		if (response.ok) {
			const $ = cheerio.load(await response.text(), { xml: true });
			const plot = $('plot').text().trim();
			if (plot) {
				return plot;
			}
		}
	} catch (error) {
		console.error('Unable to load metadata description', error);
	}
	return getFallbackJobDescription(job);
}
