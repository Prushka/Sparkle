'use client';

import type { Title, TitleEpisode } from '@/lib/player/t';
import { New } from '@/components/player/New';
import { PlexArtworkImage } from '@/components/plex-artwork';
import type { PlexArtworkPaths } from '@/lib/plex-artwork';

export function TitlePoster({
	title,
	isNew = false,
	staticBaseUrl,
	poster,
	artwork
}: {
	title: Title | TitleEpisode;
	isNew?: boolean;
	staticBaseUrl: string;
	poster?: string;
	artwork?: PlexArtworkPaths;
}) {
	return (
		<div className="relative shrink-0 overflow-hidden">
			<PlexArtworkImage
				artwork={artwork}
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
