'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { HomeClient } from '@/components/home-client';
import { RoomClient } from '@/components/room-client';

export type AppRoute =
	| { kind: 'home' }
	| { kind: 'room'; roomId: string; view: 'library' }
	| { kind: 'room'; roomId: string; view: 'media'; mediaId: string };

function decodePathSegment(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseAppRoute(pathname: string): AppRoute {
	const segments = pathname.split('/').filter(Boolean).map(decodePathSegment);
	if (segments.length === 0) {
		return { kind: 'home' };
	}
	if (segments[0] === 'rooms' && segments[1] === 'new') {
		return { kind: 'home' };
	}
	if (segments[0] === 'rooms' && segments.length >= 4 && segments[2] === 'media') {
		return {
			kind: 'room',
			roomId: segments[1],
			view: 'media',
			mediaId: segments[3]
		};
	}
	if (segments.length >= 3 && segments[1] === 'media') {
		return {
			kind: 'room',
			roomId: segments[0],
			view: 'media',
			mediaId: segments[2]
		};
	}
	if (segments[1] === 'library') {
		return { kind: 'room', roomId: segments[0], view: 'library' };
	}
	return { kind: 'room', roomId: segments[0], view: 'library' };
}

export function AppClient() {
	const pathname = usePathname();
	const route = useMemo(() => parseAppRoute(pathname), [pathname]);

	return route.kind === 'room' ? <RoomClient route={route} /> : <HomeClient />;
}
