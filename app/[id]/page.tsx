import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { LibraryHome } from '@/components/library-home';
import { Player } from '@/components/player/Player';
import { loadRoomPageData } from '@/lib/server/media';
import { getRequestOrigin, toAbsoluteUrl } from '@/lib/server/request';
import type { ServerData } from '@/lib/player/t';

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

function isMediaData(data: Awaited<ReturnType<typeof getMediaData>>): data is ServerData {
	return 'job' in data;
}

export async function generateMetadata(props: MediaPageProps): Promise<Metadata> {
	const data = await getMediaData(props);
	const requestHeaders = await headers();
	const origin = getRequestOrigin(requestHeaders);
	const pageUrl = toAbsoluteUrl(`/${data.roomId ?? ''}`, origin);

	if (!isMediaData(data)) {
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
					'application/json+oembed': toAbsoluteUrl(`/json/${data.roomId}`, origin)
				}
			}
		};
	}

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
		themeColor: isMediaData(data) ? data.dominantColor : '#f0f0f0'
	};
}

export default async function MediaPage(props: MediaPageProps) {
	await connection();
	const data = await getMediaData(props);

	if (isMediaData(data)) {
		return <Player data={data} />;
	}

	return (
		<LibraryHome
			jobs={data.jobs}
			staticBaseUrl={data.staticBaseUrl}
			backendBaseUrl={data.backendBaseUrl}
			roomId={data.roomId}
		/>
	);
}
