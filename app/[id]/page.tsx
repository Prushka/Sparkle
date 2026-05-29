import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Player } from '@/components/player/Player';
import { loadMediaPageData } from '@/lib/server/media';
import { getRequestHost } from '@/lib/server/request';

type SearchParams = Record<string, string | string[] | undefined>;
type MediaPageProps = {
	params: Promise<{ id: string }> | { id: string };
	searchParams?: Promise<SearchParams> | SearchParams;
};

async function getMediaData({ params, searchParams }: MediaPageProps) {
	const resolvedParams = await Promise.resolve(params);
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
	const requestHeaders = await headers();
	const host = getRequestHost(requestHeaders);

	return loadMediaPageData(resolvedParams.id, resolvedSearchParams, fetch, host);
}

export async function generateMetadata(props: MediaPageProps): Promise<Metadata> {
	const data = await getMediaData(props);

	return {
		title: data.displayTitle,
		description: data.plot,
		openGraph: {
			title: data.displayTitle,
			description: data.plot,
			images: [
				{
					url: data.preview,
					type: 'image/jpeg'
				}
			],
			videos: [
				{
					url: data.video,
					secureUrl: data.video,
					type: 'video/mp4',
					width: data.job?.width,
					height: data.job?.height
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
