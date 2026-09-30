'use client';

import { PlexArtworkImage } from '@/components/plex-artwork';
import type { PlexArtworkPaths } from '@/lib/plex-artwork';

export function LibraryPoster({ src, artwork }: { src: string; artwork?: PlexArtworkPaths }) {
	return (
		<PlexArtworkImage
			artwork={artwork}
			alt=""
			src={src}
			// The grid already mounts only visible/overscan rows. Native lazy loading
			// on translated virtual rows can defer loads until hover triggers a repaint.
			loading="eager"
			decoding="async"
			className="relative h-full w-full object-cover"
		/>
	);
}
