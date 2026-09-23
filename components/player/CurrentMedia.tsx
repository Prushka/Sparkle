'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconMovie } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Job } from '@/lib/player/t';

export function CurrentMedia({
	job,
	poster,
	summary,
	children
}: {
	job: Job;
	poster: string;
	summary: string;
	children: ReactNode;
}) {
	const [failedPoster, setFailedPoster] = useState('');
	const [expanded, setExpanded] = useState(false);
	const [clamped, setClamped] = useState(false);
	const summaryRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		const element = summaryRef.current;
		if (!element || expanded) return;
		const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, [summary, expanded]);
	const episode = job.Title.episode;
	const minutes = Math.max(1, Math.round(job.Duration / 60));
	const duration =
		minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;

	return (
		<section aria-label="Current media" className="flex items-start gap-4 sm:gap-5">
			<div className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60 sm:w-28">
				<div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
					<IconMovie className="size-8" stroke={1.25} aria-hidden="true" />
				</div>
				{poster && failedPoster !== poster && (
					// The artwork URL already points to the controlled proxy or existing static assets.
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={poster}
						alt={`${job.Title.title} cover`}
						className="absolute inset-0 size-full object-cover"
						decoding="async"
						onError={() => setFailedPoster(poster)}
					/>
				)}
			</div>
			<div className="min-w-0 flex-1 space-y-3">
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground">
						<Badge variant="secondary">
							{job.Source === 'plex' || job.Raw ? 'Raw' : 'Encoded'}
						</Badge>
						{job.year ? <span>{job.year}</span> : null}
						{job.Duration > 0 && <span>{duration}</span>}
					</div>
					<h2 className="text-base font-bold leading-snug break-words sm:text-xl">
						{job.Title.title}
					</h2>
					{episode && (
						<p className="text-sm font-medium text-muted-foreground break-words">
							{episode.se}
							{episode.title ? ` · ${episode.title}` : ''}
						</p>
					)}
				</div>
				{summary && (
					<div className="max-w-3xl">
						<p
							ref={summaryRef}
							className={`text-sm font-normal leading-relaxed text-muted-foreground break-words ${expanded ? '' : 'line-clamp-3'}`}
						>
							{summary}
						</p>
						{(clamped || expanded) && (
							<Button
								variant="link"
								size="sm"
								className="h-auto px-0 py-1 text-xs"
								aria-expanded={expanded}
								onClick={() => setExpanded(!expanded)}
							>
								{expanded ? 'Show less' : 'Read more'}
							</Button>
						)}
					</div>
				)}
				{children}
			</div>
		</section>
	);
}
