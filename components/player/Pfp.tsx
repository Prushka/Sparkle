"use client";

import { useEffect } from 'react';
import { PUBLIC_STATIC } from '@/lib/env';
import { useAppState } from '@/lib/app-state';
import type { DiscordUser } from '@/lib/player/t';
import { getAvatarUrl } from '@/lib/player/t';

export function Pfp({
	id,
	discordUser = null,
	className = ''
}: {
	id: string;
	discordUser?: DiscordUser | null;
	className?: string;
}) {
	const { pfpLastFetched, updatePfp } = useAppState();

	useEffect(() => {
		if (!pfpLastFetched[id] && !discordUser) {
			updatePfp(id);
		}
	}, [discordUser, id, pfpLastFetched, updatePfp]);

	return (
		<img
			src={discordUser ? getAvatarUrl(discordUser) : `${PUBLIC_STATIC}/pfp/${id}.png?${pfpLastFetched[id] || ''}`}
			alt="pfp"
			className={`rounded-full object-cover ${className}`}
		/>
	);
}
