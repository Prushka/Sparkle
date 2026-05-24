import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Player } from '@/components/player/Player';
import { loadMediaPageData } from '@/lib/server/media';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MediaPage({
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

	return <Player data={data} />;
}
