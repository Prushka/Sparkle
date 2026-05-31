import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
	title: "It's anime time!"
};

type SearchParams = Record<string, string | string[] | undefined>;

function getRedirectQuery(searchParams: SearchParams) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(searchParams)) {
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
	redirect(`/rooms/new${getRedirectQuery(resolvedSearchParams)}`);
}
