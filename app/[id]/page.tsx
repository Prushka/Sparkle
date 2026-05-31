import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Player } from '@/components/player/Player';
import { loadRoomPageData } from '@/lib/server/media';
import { getRequestOrigin, toAbsoluteUrl } from '@/lib/server/request';

type SearchParams = Record<string, string | string[] | undefined>;
type MediaPageProps = {
	params: Promise<{ id: string }> | { id: string };
	searchParams?: Promise<SearchParams> | SearchParams;
};

async function getMediaData({ params, searchParams }: MediaPageProps) {
	const resolvedParams = await Promise.resolve(params);
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
	const requestHeaders = await headers();
	const origin = getRequestOrigin(requestHeaders);

	return loadRoomPageData(resolvedParams.id, resolvedSearchParams, fetch, origin);
}

export async function generateMetadata(props: MediaPageProps): Promise<Metadata> {
	const data = await getMediaData(props);
	const requestHeaders = await headers();
	const origin = getRequestOrigin(requestHeaders);
	const pageUrl = toAbsoluteUrl(`/${data.roomId}`, origin);
	const previewUrl = toAbsoluteUrl(data.preview, origin);
	const videoUrl = toAbsoluteUrl(data.video, origin);

	return {
		metadataBase: new URL(origin),
		title: data.displayTitle,
		description: data.plot,
		openGraph: {
			title: data.displayTitle,
			description: data.plot,
			url: pageUrl,
			images: [
				{
					url: previewUrl,
					type: 'image/jpeg'
				}
			],
			videos: [
				{
					url: videoUrl,
					secureUrl: videoUrl,
					type: 'video/mp4',
					width: data.job?.width,
					height: data.job?.height
				}
			]
		},
		twitter: {
			card: 'summary_large_image',
			title: data.displayTitle,
			description: data.plot,
			images: [
				{
					url: previewUrl,
					type: 'image/jpeg'
				}
			]
		},
		alternates: {
			types: {
				'application/json+oembed': data.oembedJson
			}
		}
	};
}

export async function generateViewport(props: MediaPageProps): Promise<Viewport> {
	const data = await getMediaData(props);

	return {
		themeColor: data.dominantColor
	};
}

export default async function MediaPage(props: MediaPageProps) {
	await connection();
	const data = await getMediaData(props);

	return <Player data={data} />;
}
