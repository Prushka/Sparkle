'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/lib/app-state';
import { getPlayerFallbackColor } from '@/lib/player/color';
import type { DiscordUser } from '@/lib/player/t';
import { getAvatarUrl, getName } from '@/lib/player/t';

function getFallbackName(name: string | undefined, discordUser: DiscordUser | null, id: string) {
	return (name || getName(discordUser) || id || 'Unknown').trim() || 'Unknown';
}

function getFallbackInitial(name: string) {
	return Array.from(name.trim())[0]?.toLocaleUpperCase() || '?';
}

export function Pfp({
	id,
	discordUser = null,
	name,
	className = '',
	staticBaseUrl
}: {
	id: string;
	discordUser?: DiscordUser | null;
	name?: string;
	className?: string;
	staticBaseUrl: string;
}) {
	const { pfpLastFetched, updatePfp } = useAppState();
	const pfpRevision = pfpLastFetched[id];
	const [failedImageSrc, setFailedImageSrc] = useState('');
	const fallbackName = useMemo(
		() => getFallbackName(name, discordUser, id),
		[discordUser, id, name]
	);
	const fallbackInitial = useMemo(() => getFallbackInitial(fallbackName), [fallbackName]);
	const fallbackColor = useMemo(() => getPlayerFallbackColor(fallbackName), [fallbackName]);
	const imageSrc = discordUser?.avatar
		? getAvatarUrl(discordUser)
		: !discordUser && id
			? `${staticBaseUrl}/pfp/${id}.png?${pfpRevision || ''}`
			: '';
	const showImage = Boolean(imageSrc && failedImageSrc !== imageSrc);

	useEffect(() => {
		if (id && !pfpRevision && !discordUser) {
			updatePfp(id);
		}
	}, [discordUser, id, pfpRevision, updatePfp]);

	if (showImage) {
		return (
			<img
				key={imageSrc}
				src={imageSrc}
				alt="pfp"
				decoding="async"
				className={`rounded-full object-cover ${className}`}
				onError={() => setFailedImageSrc(imageSrc)}
			/>
		);
	}

	return (
		<span
			role="img"
			aria-label={`${fallbackName} pfp`}
			className={`pfp-fallback inline-flex shrink-0 items-center justify-center rounded-full text-white ${className}`}
			style={{ backgroundColor: fallbackColor }}
		>
			{fallbackInitial}
		</span>
	);
}
