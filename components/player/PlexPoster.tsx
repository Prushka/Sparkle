'use client';

import { Poster } from '@vidstack/react';
import { PlexArtworkImage } from '@/components/plex-artwork';

export function PlexPoster({ src }: { src: string }) {
	// Vidstack/media-session/cast retain the public URL; only the image is private.
	return (
		<Poster asChild className="vds-poster" src={src} alt="">
			<PlexArtworkImage src={src} alt="" />
		</Poster>
	);
}
