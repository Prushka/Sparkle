import type { Metadata } from 'next';
import { connection } from 'next/server';
import { LibraryHome } from '@/components/library-home';
import { loadHomePageData } from '@/lib/server/media';

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
	const data = await loadHomePageData(resolvedSearchParams, fetch);

	return <LibraryHome jobs={data.jobs} staticBaseUrl={data.staticBaseUrl} />;
}
