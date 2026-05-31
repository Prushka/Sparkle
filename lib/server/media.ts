import * as cheerio from 'cheerio';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getJobs } from '@/lib/server/jobs';
import {
	getBrowserBackendBaseUrl,
	getBrowserStaticBaseUrl,
	getStaticBaseUrl
} from '@/lib/server/env';
import { createRoomRecord, getRoomRecord } from '@/lib/server/rooms';
import type { Job, ServerData } from '@/lib/player/t';

type SearchParams = Record<string, string | string[] | undefined>;
export type HomePageData = {
	jobs: Job[];
	staticBaseUrl: string;
	backendBaseUrl: string;
	roomId?: string;
};
export type RoomPageData = ServerData | HomePageData;

function getSearchValue(searchParams: SearchParams, key: string) {
	const value = searchParams[key];
	return Array.isArray(value) ? value[0] : value;
}

function getRedirectQuery(searchParams: SearchParams) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(searchParams)) {
		if (key === 'room' || key === 'mediaId') {
			continue;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				params.append(key, item);
			}
		} else if (value !== undefined) {
			params.set(key, value);
		}
	}
	const query = params.toString();
	return query ? `?${query}` : '';
}

export const loadHomePageData = cache(
	async (
		_searchParams: SearchParams,
		fetchFn: typeof fetch,
		roomID?: string
	): Promise<HomePageData> => {
		const jobs = await getJobs(fetchFn);
		return {
			jobs,
			staticBaseUrl: getBrowserStaticBaseUrl(),
			backendBaseUrl: getBrowserBackendBaseUrl(),
			...(roomID ? { roomId: roomID } : {})
		};
	}
);

async function resolveRoomMediaID(
	roomID: string,
	searchParams: SearchParams,
	fetchFn: typeof fetch
) {
	const legacyRoomID =
		getSearchValue(searchParams, 'room') || getSearchValue(searchParams, 'channel_id');
	if (legacyRoomID && legacyRoomID !== roomID) {
		const existing = await getRoomRecord(fetchFn, legacyRoomID);
		if (!existing) {
			await createRoomRecord(fetchFn, roomID, legacyRoomID);
		}
		redirect(`/${legacyRoomID}${getRedirectQuery(searchParams)}`);
	}

	const room = await getRoomRecord(fetchFn, roomID);
	if (!room) {
		redirect('/');
	}
	return room.mediaId || null;
}

export const loadRoomPageData = cache(
	async (
		roomID: string,
		searchParams: SearchParams,
		fetchFn: typeof fetch,
		origin: string
	): Promise<RoomPageData> => {
		const mediaID = await resolveRoomMediaID(roomID, searchParams, fetchFn);
		if (!mediaID) {
			return loadHomePageData(searchParams, fetchFn, roomID);
		}
		return loadMediaPageData(mediaID, searchParams, fetchFn, origin, roomID);
	}
);

export const loadMediaPageData = cache(
	async (
		id: string,
		_searchParams: SearchParams,
		fetchFn: typeof fetch,
		origin: string,
		roomID?: string
	): Promise<ServerData> => {
		let job: Job | undefined;
		let codec = 'h264';
		const browserStaticBaseUrl = getBrowserStaticBaseUrl();
		let base = `${browserStaticBaseUrl}/${id}`;
		let plot = '';
		let rating = -1;
		let jobs: Job[] = [];
		let titleStr: string;
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
			const infoResponse = await fetchFn(`${getStaticBaseUrl()}/${id}/info.nfo`);
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
			oembedJson: roomID ? `${origin}/json/${roomID}` : `${origin}/json/${job?.Id}`,
			dominantColor: job?.DominantColors?.[0] ? job.DominantColors[0] : '#EC275F',
			backendBaseUrl: getBrowserBackendBaseUrl(),
			roomId: roomID ?? job.Id
		};
	}
);
