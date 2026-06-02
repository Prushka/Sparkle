import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { getBrowserStaticBaseUrl } from '@/lib/server/env';
import { getJob } from '@/lib/server/jobs';
import { getRequestOrigin, toAbsoluteUrl } from '@/lib/server/request';
import { getRoomRecord } from '@/lib/server/rooms';
import type { Job } from '@/lib/player/t';

export type MediaPageRoute = {
	roomId: string;
	mediaId?: string;
};

type MediaMetadataData = {
	origin: string;
	roomId: string;
	mediaId: string;
	job: Job | null;
};

const fallbackTitle = "It's anime time!";
const fallbackDescription = 'Choose something to watch together.';
const siteName = "Let's watch anime!";

function getDisplayTitle(job: Job) {
	return (
		job.Title.episode ? `${job.Title.episode.se} - ${job.Title.episode.title}` : job.Title.title
	).trim();
}

function getDescription(job: Job) {
	const title = (job.Title.episode ? job.Title.title : job.Title.title).trim();
	return title ? `Watch ${title} together.` : fallbackDescription;
}

function getPageUrl({
	origin,
	roomId,
	mediaId
}: Pick<MediaMetadataData, 'origin' | 'roomId' | 'mediaId'>) {
	const path = mediaId
		? `/${encodeURIComponent(roomId)}/media/${encodeURIComponent(mediaId)}`
		: `/${encodeURIComponent(roomId)}`;
	return toAbsoluteUrl(path, origin);
}

function getOembedUrl({
	origin,
	roomId,
	mediaId
}: Pick<MediaMetadataData, 'origin' | 'roomId' | 'mediaId'>) {
	if (!mediaId) {
		return toAbsoluteUrl(`/json/${encodeURIComponent(roomId)}`, origin);
	}
	const params = new URLSearchParams({ room: roomId });
	return toAbsoluteUrl(`/json/${encodeURIComponent(mediaId)}?${params.toString()}`, origin);
}

async function getMediaMetadataData(route: MediaPageRoute): Promise<MediaMetadataData> {
	const requestHeaders = await headers();
	const origin = getRequestOrigin(requestHeaders);
	let mediaId = route.mediaId || '';

	if (!mediaId) {
		try {
			const room = await getRoomRecord(fetch, route.roomId);
			mediaId = room?.mediaId || '';
		} catch (error) {
			console.error('Unable to load metadata room', error);
		}
	}

	if (!mediaId) {
		return { origin, roomId: route.roomId, mediaId: '', job: null };
	}

	try {
		return {
			origin,
			roomId: route.roomId,
			mediaId,
			job: await getJob(fetch, mediaId)
		};
	} catch (error) {
		console.error('Unable to load metadata media', error);
		return { origin, roomId: route.roomId, mediaId, job: null };
	}
}

export async function generateMediaPageMetadata(route: MediaPageRoute): Promise<Metadata> {
	const data = await getMediaMetadataData(route);
	const pageUrl = getPageUrl(data);
	const oembedUrl = getOembedUrl(data);

	if (!data.job) {
		return {
			metadataBase: new URL(data.origin),
			title: fallbackTitle,
			description: fallbackDescription,
			openGraph: {
				title: fallbackTitle,
				description: fallbackDescription,
				locale: 'en_US',
				type: 'website',
				siteName,
				url: pageUrl
			},
			twitter: {
				card: 'summary_large_image',
				title: fallbackTitle,
				description: fallbackDescription
			},
			alternates: {
				canonical: pageUrl,
				types: {
					'application/json+oembed': oembedUrl
				}
			}
		};
	}

	const displayTitle = getDisplayTitle(data.job);
	const description = getDescription(data.job);
	const previewUrl = toAbsoluteUrl(
		`${getBrowserStaticBaseUrl()}/${data.job.Id}/poster.jpg`,
		data.origin
	);

	return {
		metadataBase: new URL(data.origin),
		title: displayTitle,
		description,
		authors: data.job.Title.episode
			? [{ name: data.job.Title.title.trim(), url: pageUrl }]
			: undefined,
		openGraph: {
			title: displayTitle,
			description,
			locale: 'en_US',
			type: 'website',
			siteName,
			url: pageUrl,
			images: [
				{
					url: previewUrl,
					type: 'image/jpeg'
				}
			]
		},
		twitter: {
			card: 'summary_large_image',
			title: displayTitle,
			description,
			images: [
				{
					url: previewUrl,
					type: 'image/jpeg'
				}
			]
		},
		alternates: {
			canonical: pageUrl,
			types: {
				'application/json+oembed': oembedUrl
			}
		}
	};
}

export async function generateMediaPageViewport(route: MediaPageRoute): Promise<Viewport> {
	const { job } = await getMediaMetadataData(route);

	return {
		themeColor: job?.DominantColors?.[0] ?? '#f0f0f0'
	};
}
