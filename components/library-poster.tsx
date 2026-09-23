'use client';

import { useState } from 'react';

export function LibraryPoster({ src }: { src: string }) {
	const [failed, setFailed] = useState(false);
	return failed ? null : (
		<img
			alt=""
			src={src}
			// The grid already mounts only visible/overscan rows. Native lazy loading
			// on translated virtual rows can defer loads until hover triggers a repaint.
			loading="eager"
			decoding="async"
			className="relative h-full w-full object-cover"
			onError={() => setFailed(true)}
		/>
	);
}
