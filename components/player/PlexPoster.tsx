'use client';

import { Poster } from '@vidstack/react';
import { PlexArtworkImage } from '@/components/plex-artwork';
import type { PlexArtworkPaths } from '@/lib/plex-artwork';

export function PlexPoster({ src, artwork }: { src: string; artwork?: PlexArtworkPaths }) {
	// Vidstack/media-session/cast retain the public URL; only the image is private.
	return (
		<Poster asChild className="vds-poster" src={src} alt="">
			<PlexArtworkImage src={src} artwork={artwork} alt="" />
		</Poster>
	);
}
