'use client';

import { PlexArtworkImage } from '@/components/plex-artwork';

export function LibraryPoster({ src }: { src: string }) {
	return (
		<PlexArtworkImage
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
