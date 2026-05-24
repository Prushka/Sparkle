'use client';

import { useEffect } from 'react';
import { useAppState } from '@/lib/app-state';
import type { DiscordUser } from '@/lib/player/t';
import { getAvatarUrl } from '@/lib/player/t';

const TRANSPARENT_PIXEL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

export function Pfp({
	id,
	discordUser = null,
	className = '',
	staticBaseUrl
}: {
	id: string;
	discordUser?: DiscordUser | null;
	className?: string;
	staticBaseUrl: string;
}) {
	const { pfpLastFetched, updatePfp } = useAppState();

	useEffect(() => {
		if (id && !pfpLastFetched[id] && !discordUser) {
			updatePfp(id);
		}
	}, [discordUser, id, pfpLastFetched, updatePfp]);

	return (
		<img
			src={
				discordUser
					? getAvatarUrl(discordUser)
					: id
						? `${staticBaseUrl}/pfp/${id}.png?${pfpLastFetched[id] || ''}`
						: TRANSPARENT_PIXEL
			}
			alt="pfp"
			className={`rounded-full object-cover ${className}`}
		/>
	);
}
