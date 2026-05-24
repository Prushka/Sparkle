'use client';

import type { Title, TitleEpisode } from '@/lib/player/t';
import { New } from '@/components/player/New';

export function TitlePoster({
	title,
	isNew = false,
	staticBaseUrl
}: {
	title: Title | TitleEpisode;
	isNew?: boolean;
	staticBaseUrl: string;
}) {
	return (
		<div className="relative shrink-0 overflow-hidden">
			<img
				src={`${staticBaseUrl}/${title.id}/poster.jpg`}
				alt={title.title}
				className="mr-2 h-8 w-12 rounded-sm object-cover"
			/>
			{isNew ? <New /> : null}
		</div>
	);
}
