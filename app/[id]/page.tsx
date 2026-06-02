import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { RoomClient } from '@/components/room-client';
import { getJob } from '@/lib/server/jobs';
import { getBrowserStaticBaseUrl } from '@/lib/server/env';
import { getRequestOrigin, toAbsoluteUrl } from '@/lib/server/request';
import { getRoomRecord } from '@/lib/server/rooms';

type SearchParams = Record<string, string | string[] | undefined>;
type MediaPageProps = {
	params: Promise<{ id: string }> | { id: string };
	searchParams?: Promise<SearchParams> | SearchParams;
};

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
	return params.toString();
}

async function getMetadataJob(props: MediaPageProps) {
	const resolvedParams = await Promise.resolve(props.params);
	const resolvedSearchParams = await Promise.resolve(props.searchParams ?? {});
	const requestHeaders = await headers();
	const origin = getRequestOrigin(requestHeaders);
	const legacyRoomID =
		getSearchValue(resolvedSearchParams, 'room') ||
		getSearchValue(resolvedSearchParams, 'channel_id');
	const roomId = legacyRoomID || resolvedParams.id;
	const room = await getRoomRecord(fetch, roomId);
	const mediaId = room?.mediaId || '';
	if (!mediaId) {
		return { origin, roomId, roomMediaId: '', job: null };
	}
	try {
		return {
			origin,
			roomId,
			roomMediaId: mediaId,
			job: await getJob(fetch, mediaId)
		};
	} catch (error) {
		console.error('Unable to load metadata media', error);
		return { origin, roomId, roomMediaId: mediaId, job: null };
	}
}

export async function generateMetadata(props: MediaPageProps): Promise<Metadata> {
	const { origin, roomId, job } = await getMetadataJob(props);
	const pageUrl = toAbsoluteUrl(`/${roomId}`, origin);

	if (!job) {
		return {
			metadataBase: new URL(origin),
			title: "It's anime time!",
			description: 'Choose something to watch together.',
			openGraph: {
				title: "It's anime time!",
				description: 'Choose something to watch together.',
				url: pageUrl
			},
			alternates: {
				types: {
					'application/json+oembed': toAbsoluteUrl(`/json/${roomId}`, origin)
				}
			}
		};
	}

	const displayTitle = job.Title.episode
		? `${job.Title.episode.se} - ${job.Title.episode.title}`
		: job.Title.title;
	const staticBase = getBrowserStaticBaseUrl();
	const previewUrl = toAbsoluteUrl(`${staticBase}/${job.Id}/poster.jpg`, origin);

	return {
		metadataBase: new URL(origin),
		title: displayTitle,
		description: '',
		openGraph: {
			title: displayTitle,
			description: '',
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
			description: '',
			images: [
				{
					url: previewUrl,
					type: 'image/jpeg'
				}
			]
		},
		alternates: {
			types: {
				'application/json+oembed': toAbsoluteUrl(`/json/${roomId}`, origin)
			}
		}
	};
}

export async function generateViewport(props: MediaPageProps): Promise<Viewport> {
	const { job } = await getMetadataJob(props);

	return {
		themeColor: job?.DominantColors?.[0] ?? '#f0f0f0'
	};
}

export default async function MediaPage({ params, searchParams }: MediaPageProps) {
	const resolvedParams = await Promise.resolve(params);
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});

	return (
		<RoomClient
			roomId={resolvedParams.id}
			searchValues={{
				legacyRoomId:
					getSearchValue(resolvedSearchParams, 'room') ||
					getSearchValue(resolvedSearchParams, 'channel_id') ||
					undefined,
				redirectQuery: getRedirectQuery(resolvedSearchParams) || undefined
			}}
		/>
	);
}
