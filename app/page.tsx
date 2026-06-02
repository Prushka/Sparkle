import type { Metadata } from 'next';
import { HomeClient } from '@/components/home-client';

export const metadata: Metadata = {
	title: "It's anime time!"
};

type SearchParams = Record<string, string | string[] | undefined>;

function getSearchValue(searchParams: SearchParams, key: string) {
	const value = searchParams[key];
	return Array.isArray(value) ? value[0] : value;
}

function getRedirectQuery(searchParams: SearchParams) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(searchParams)) {
		if (key === 'mediaId' || key === 'room') {
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

export default async function HomePage({
	searchParams
}: {
	searchParams?: SearchParams | Promise<SearchParams>;
}) {
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});

	return (
		<HomeClient
			searchValues={{
				mediaId: getSearchValue(resolvedSearchParams, 'mediaId')?.trim() || undefined,
				requestedRoomId:
					getSearchValue(resolvedSearchParams, 'room')?.trim() ||
					getSearchValue(resolvedSearchParams, 'channel_id')?.trim() ||
					undefined,
				redirectQuery: getRedirectQuery(resolvedSearchParams) || undefined
			}}
		/>
	);
}
