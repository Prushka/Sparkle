'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LibraryItem } from './library';

export type LibraryTrailItem = LibraryItem & { parentQuery?: string };

export type LibraryNavigation = {
	source: string;
	library: string;
	kind: string;
	sort: string;
	query: string;
	trail: LibraryTrailItem[];
};
const defaults: LibraryNavigation = {
	source: 'all',
	library: '',
	kind: 'all',
	sort: 'recent-desc',
	query: '',
	trail: []
};

function read(params: URLSearchParams): LibraryNavigation {
	let trail: LibraryTrailItem[] = [];
	try {
		const values: unknown = JSON.parse(params.get('libraryPath') || '[]');
		if (Array.isArray(values) && values.length <= 2) {
			trail = values
				.filter(
					(item): item is LibraryTrailItem =>
						item &&
						typeof item.id === 'string' &&
						item.id.length < 200 &&
						typeof item.title === 'string' &&
						item.title.length < 500 &&
						['show', 'season'].includes(item.kind) &&
						['plex', 'processed'].includes(item.source)
				)
				.map((item) => ({
					...item,
					parentQuery: typeof item.parentQuery === 'string' ? item.parentQuery.slice(0, 200) : ''
				}));
		}
	} catch {
		/* Invalid links fall back to the Library root. */
	}
	return {
		source: ['all', 'plex', 'processed'].includes(params.get('source') || '')
			? params.get('source')!
			: 'all',
		library: params.get('libraryId') || '',
		kind: ['all', 'movies', 'shows'].includes(params.get('kind') || '')
			? params.get('kind')!
			: 'all',
		sort: [
			'recent-desc',
			'recent-asc',
			'title-asc',
			'title-desc',
			'duration-asc',
			'duration-desc'
		].includes(params.get('sort') || '')
			? params.get('sort')!
			: 'recent-desc',
		query: (params.get('query') || '').slice(0, 200),
		trail
	};
}

// Native history integrates with Next without replacing the room pathname or
// unrelated query parameters. The in-room picker has its own local navigation.
export function useLibraryNavigation(local: boolean) {
	const params = useSearchParams();
	const serialized = params.toString();
	const fromURL = useMemo(() => read(new URLSearchParams(serialized)), [serialized]);
	const [localState, setLocalState] = useState(defaults);
	const state = local ? localState : fromURL;
	const update = useCallback(
		(patch: Partial<LibraryNavigation>, push = false) => {
			if (local) {
				setLocalState((old) => ({ ...old, ...patch }));
				return;
			}
			const url = new URL(window.location.href);
			const next = { ...read(url.searchParams), ...patch };
			for (const [key, value, fallback] of [
				['source', next.source, 'all'],
				['libraryId', next.library, ''],
				['kind', next.kind, 'all'],
				['sort', next.sort, 'recent-desc'],
				['query', next.query, '']
			]) {
				if (value === fallback) url.searchParams.delete(key);
				else url.searchParams.set(key, value);
			}
			if (next.trail.length)
				url.searchParams.set(
					'libraryPath',
					JSON.stringify(
						next.trail.map(({ id, title, kind, source, parentQuery }) => ({
							id,
							title,
							kind,
							source,
							parentQuery
						}))
					)
				);
			else url.searchParams.delete('libraryPath');
			if (url.href !== window.location.href) {
				// Preserve Sparkle's room-return marker; Next copies its own router
				// fields. Copying Next's internal flags here bypasses its URL updates.
				const state = { __sparkleLibraryReturn: window.history.state?.__sparkleLibraryReturn };
				window.history[push ? 'pushState' : 'replaceState'](state, '', url);
			}
		},
		[local]
	);
	return { state, update };
}
