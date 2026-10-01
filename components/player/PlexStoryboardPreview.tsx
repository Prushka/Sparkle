'use client';

/* eslint-disable @next/next/no-img-element -- Local, revocable JPEG blob URLs. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMediaState, useSliderState } from '@vidstack/react';
import type { RawMedia } from '@/lib/player/raw-types';
import { PlexPreviewCache, plexPreviewURL, PREVIEW_DWELL_MS } from '@/lib/player/plex-preview';

export function PlexStoryboardPreview({ raw, base }: { raw: RawMedia; base: string }) {
	const cache = useRef<PlexPreviewCache | null>(null);
	const [image, setImage] = useState<{ key: string; url: string } | null>(null);
	const [failed, setFailed] = useState(false);
	const duration = useMediaState('duration');
	const clipStart = useMediaState('clipStartTime');
	const rate = useSliderState('pointerRate');
	const pointing = useSliderState('pointing');
	const dragging = useSliderState('dragging');
	const visible = pointing || dragging;
	const key = plexPreviewURL(base, raw.parts, clipStart + rate * duration, duration);

	useEffect(() => {
		const current = new PlexPreviewCache();
		cache.current = current;
		return () => {
			current.dispose();
			cache.current = null;
		};
	}, [raw, base]);

	useEffect(() => {
		const current = cache.current;
		if (!visible || !key || !current) return;
		const cached = current.get(key);
		setFailed(false);
		if (cached) {
			setImage({ key, url: cached });
			return;
		}
		setImage(null);
		const controller = new AbortController();
		// Fast sweeps never queue decoding work. Leaving the bar or replacing the
		// source cancels both the dwell timer and the authenticated image request.
		const timer = setTimeout(() => {
			void current.load(key, controller.signal).then((url) => {
				if (controller.signal.aborted) return;
				if (url) setImage({ key, url });
				else setFailed(true);
			});
		}, PREVIEW_DWELL_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [key, visible, raw, base]);

	if (!visible || !key) return null;
	return (
		<div
			className="vds-slider-thumbnail vds-thumbnail sparkle-storyboard-thumbnail sparkle-plex-preview"
			aria-label="Video preview (SDR)"
			data-preview-state={image?.key === key ? 'ready' : failed ? 'unavailable' : 'loading'}
			style={{ '--thumbnail-width': '134px', '--thumbnail-height': '75px' } as CSSProperties}
		>
			{image?.key === key ? (
				<img src={image.url} alt="" draggable={false} />
			) : (
				<span>{failed ? 'Preview unavailable' : 'Loading preview…'}</span>
			)}
		</div>
	);
}
