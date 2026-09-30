'use client';

import type { Title, TitleEpisode } from '@/lib/player/t';
import { New } from '@/components/player/New';
import { PlexArtworkImage } from '@/components/plex-artwork';

export function TitlePoster({
	title,
	isNew = false,
	staticBaseUrl,
	poster
}: {
	title: Title | TitleEpisode;
	isNew?: boolean;
	staticBaseUrl: string;
	poster?: string;
}) {
	return (
		<div className="relative shrink-0 overflow-hidden">
			<PlexArtworkImage
				src={poster ?? `${staticBaseUrl}/${title.id}/poster.jpg`}
				alt={title.title}
				loading="lazy"
				decoding="async"
				width={48}
				height={32}
				className="mr-2 h-8 w-12 rounded-sm object-cover"
			/>
			{isNew ? <New /> : null}
		</div>
	);
}
