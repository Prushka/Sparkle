import { backendFetch } from '@/lib/plex-access';
import { joinBackendPath } from '@/lib/player/data';
export interface LibraryItem {
	id: string;
	source: 'processed' | 'plex';
	libraryId?: string;
	kind: 'movie' | 'show' | 'season' | 'episode';
	title: string;
	poster?: string;
	summary?: string;
	year?: number;
	duration: number;
	children?: number;
	index?: number;
}
export interface LibraryPage {
	items: LibraryItem[];
	nextCursor?: string;
	total: number;
	warnings?: string[];
}
export interface MediaDetails extends LibraryItem {
	artwork: { poster?: string; backdrop?: string };
	versions: { id: string; label: string; codecs?: string[] }[];
	parts: import('@/lib/player/raw-types').RawPart[];
	tracks: unknown[];
	chapters: unknown[];
}
export interface LibrarySource {
	id: string;
	title: string;
	source: 'plex' | 'processed';
}
export async function libraryPage(
	base: string,
	params: URLSearchParams,
	parent?: string,
	signal?: AbortSignal
): Promise<LibraryPage> {
	const path = parent ? `/library/items/${encodeURIComponent(parent)}/children` : '/library/items';
	const response = await backendFetch(joinBackendPath(base, `${path}?${params}`), {
		signal,
		cache: 'no-store'
	});
	if (!response.ok) {
		const detail = await response.json().catch(() => ({}));
		throw new Error(detail.error || 'Unable to load this page');
	}
	return response.json();
}
export function libraryArtwork(base: string, staticBase: string, path?: string) {
	if (!path) return undefined;
	return path.startsWith('/static/')
		? joinBackendPath(staticBase, path.slice(8))
		: joinBackendPath(base, path);
}
