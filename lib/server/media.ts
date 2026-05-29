import * as cheerio from 'cheerio';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getJobs, roomMapping } from '@/lib/server/jobs';
import {
	getBackendBaseUrl,
	getBrowserBackendBaseUrl,
	getBrowserStaticBaseUrl
} from '@/lib/server/env';
import type { Job, ServerData } from '@/lib/player/t';

type SearchParams = Record<string, string | string[] | undefined>;

function getSearchValue(searchParams: SearchParams, key: string) {
	const value = searchParams[key];
	return Array.isArray(value) ? value[0] : value;
}

export const loadHomePageData = cache(
	async (searchParams: SearchParams, fetchFn: typeof fetch, host?: string) => {
		const room = getSearchValue(searchParams, 'room') || getSearchValue(searchParams, 'channel_id');
		if (room && roomMapping[room]) {
			redirect(`/${roomMapping[room]}?room=${room}`);
		}
		const jobs = await getJobs(fetchFn);
		return {
			jobs,
			staticBaseUrl: getBrowserStaticBaseUrl(host),
			backendBaseUrl: getBrowserBackendBaseUrl(host)
		};
	}
);

export const loadMediaPageData = cache(
	async (
		id: string,
		searchParams: SearchParams,
		fetchFn: typeof fetch,
		host: string
	): Promise<ServerData> => {
		let job: Job | undefined;
		let codec = 'h264';
		const browserStaticBaseUrl = getBrowserStaticBaseUrl(host);
		let base = `${browserStaticBaseUrl}/${id}`;
		let plot = '';
		let rating = -1;
		let jobs: Job[] = [];
		let titleStr: string;
		const room = getSearchValue(searchParams, 'room') || getSearchValue(searchParams, 'channel_id');
		if (room) {
			roomMapping[room] = id;
		}
		try {
			jobs = await getJobs(fetchFn, id);
		} catch (error) {
			console.log({ id }, error);
			redirect('/');
		}

		job = jobs.find((candidate) => candidate.Id === id);
		if (!job && id.length >= 4) {
			const prefixJobs = jobs.filter((candidate) => candidate.Id.startsWith(id));
			if (prefixJobs.length === 1) {
				job = prefixJobs[0];
			}
		}
		if (!job) {
			redirect('/');
		}

		id = job.Id;
		base = `${browserStaticBaseUrl}/${id}`;

		try {
			if (!job?.EncodedCodecs?.includes('h264')) {
				if (job?.EncodedCodecs?.includes('av1')) {
					codec = 'av1';
				} else {
					codec = 'hevc';
				}
			}
			const infoResponse = await fetchFn(`${getBackendBaseUrl()}/static/${id}/info.nfo`);
			const info = await infoResponse.text();
			const $ = cheerio.load(info, { xml: true });
			rating = parseFloat($('rating').text());
			plot = $('plot').text();
		} catch (error) {
			console.log({ id }, error);
			redirect('/');
		}

		let displayTitle: string;
		const title = job!.Title;
		if (title.episode) {
			const se = title.episode;
			titleStr = `${title.title} - ${se.se} - ${se.title}`;
			displayTitle = `${se.se} - ${se.title}`;
		} else {
			titleStr = title.title;
			displayTitle = title.title;
		}

		return {
			jobs,
			job,
			video: `${base}/${codec}.mp4`,
			preview: `${base}/poster.jpg`,
			icon: `${base}/poster.jpg`,
			rating,
			title: titleStr,
			displayTitle,
			plot,
			staticBaseUrl: browserStaticBaseUrl,
			oembedJson: room
				? `https://${host}/json/${job?.Id}?room=${room}`
				: `https://${host}/json/${job?.Id}`,
			dominantColor: job?.DominantColors?.[0] ? job.DominantColors[0] : '#EC275F',
			backendBaseUrl: getBrowserBackendBaseUrl(host)
		};
	}
);
