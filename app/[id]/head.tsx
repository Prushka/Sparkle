import { headers } from 'next/headers';
import { connection } from 'next/server';
import { loadMediaPageData } from '@/lib/server/media';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Head({
	params,
	searchParams
}: {
	params: Promise<{ id: string }> | { id: string };
	searchParams?: Promise<SearchParams> | SearchParams;
}) {
	await connection();
	const resolvedParams = await Promise.resolve(params);
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
	const host = (await headers()).get('host') ?? 'localhost:3000';
	const data = await loadMediaPageData(resolvedParams.id, resolvedSearchParams, fetch, host);

	return (
		<>
			<title>{data.displayTitle}</title>
			<meta name="theme-color" content={data.dominantColor} />
			<meta property="og:title" content={data.displayTitle} />
			<meta property="og:image" content={data.preview} />
			<meta property="og:video" content={data.video} />
			<meta property="og:video:url" content={data.video} />
			<meta property="og:video:width" content={`${data.job?.width ?? ''}`} />
			<meta property="og:video:height" content={`${data.job?.height ?? ''}`} />
			<meta property="og:video:type" content="video/mp4" />
			<meta property="og:image:type" content="image/jpeg" />
			<meta property="og:description" content={data.plot} />
			<meta name="description" content={data.plot} />
			<meta property="og:locale" content="en_US" />
			<meta property="og:site_name" content="Let's watch anime!" />
			<meta name="google" content="nositelinkssearchbox" />
			<link type="application/json+oembed" href={data.oembedJson} />
		</>
	);
}
