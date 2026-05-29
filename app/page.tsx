import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { MediaSelection } from '@/components/player/MediaSelection';
import { loadHomePageData } from '@/lib/server/media';
import { getRequestHost } from '@/lib/server/request';

export const metadata: Metadata = {
	title: "It's anime time!"
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HomePage({
	searchParams
}: {
	searchParams?: SearchParams | Promise<SearchParams>;
}) {
	await connection();
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
	const requestHeaders = await headers();
	const host = getRequestHost(requestHeaders);
	const data = await loadHomePageData(resolvedSearchParams, fetch, host);

	return (
		<div className="mt-20 flex w-full flex-col items-center justify-center gap-2 p-10">
			<MediaSelection
				data={{ jobs: data.jobs }}
				staticBaseUrl={data.staticBaseUrl}
				backendBaseUrl={data.backendBaseUrl}
			/>
		</div>
	);
}
