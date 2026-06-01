import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createRoomRecord } from '@/lib/server/rooms';

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
	const query = params.toString();
	return query ? `?${query}` : '';
}

export default async function HomePage({
	searchParams
}: {
	searchParams?: SearchParams | Promise<SearchParams>;
}) {
	const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
	const mediaId = getSearchValue(resolvedSearchParams, 'mediaId')?.trim() || '';
	const requestedRoomId =
		getSearchValue(resolvedSearchParams, 'room')?.trim() ||
		getSearchValue(resolvedSearchParams, 'channel_id')?.trim() ||
		'';

	let roomId: string;
	try {
		const room = await createRoomRecord(fetch, mediaId || undefined, requestedRoomId || undefined);
		roomId = room.roomId;
	} catch (error) {
		console.error('Unable to create room', error);
		redirect(`/rooms/new${getRedirectQuery(resolvedSearchParams)}`);
	}
	redirect(`/${roomId}${getRedirectQuery(resolvedSearchParams)}`);
}
