'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
	IconCalendar,
	IconChevronDown,
	IconClock,
	IconDeviceTv,
	IconMovie,
	IconMovieOff,
	IconPhoto,
	IconPlayerPlay,
	IconSearch,
	IconSortDescending,
	IconStack2,
	IconVideo,
	IconX
} from '@tabler/icons-react';
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ComponentType,
	type ReactNode
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { type LibraryJob, type TitleEpisode } from '@/lib/player/t';
import { fetchJobs } from '@/lib/player/data';

type LibraryKind = 'all' | 'movies' | 'shows';
type SortMode =
	| 'recent-desc'
	| 'recent-asc'
	| 'title-asc'
	| 'title-desc'
	| 'duration-desc'
	| 'duration-asc';
const INITIAL_LIBRARY_ITEMS = 100;
const LIBRARY_ITEMS_BATCH = 100;

type Option<T extends string> = {
	value: T;
	label: string;
};

type IconComponent = ComponentType<{ className?: string; size?: number; stroke?: number }>;

type MovieEntry = {
	kind: 'movie';
	job: LibraryJob;
	title: string;
	sortTitle: string;
	modTime: number;
	duration: number;
};

type EpisodeEntry = {
	job: LibraryJob;
	episode: TitleEpisode;
};

type SeasonEntry = {
	number: number;
	episodes: EpisodeEntry[];
};

type ShowEntry = {
	kind: 'show';
	title: string;
	titleId: string;
	seasons: SeasonEntry[];
	episodes: EpisodeEntry[];
	rep: LibraryJob;
	sortTitle: string;
	modTime: number;
	duration: number;
};

type LibraryEntry = MovieEntry | ShowEntry;

const kindOptions = [
	{ value: 'all', label: 'All' },
	{ value: 'movies', label: 'Movies' },
	{ value: 'shows', label: 'Shows' }
] satisfies Option<LibraryKind>[];

const sortOptions = [
	{ value: 'recent-desc', label: 'Newest first' },
	{ value: 'recent-asc', label: 'Oldest first' },
	{ value: 'title-asc', label: 'Title A-Z' },
	{ value: 'title-desc', label: 'Title Z-A' },
	{ value: 'duration-desc', label: 'Runtime longest' },
	{ value: 'duration-asc', label: 'Runtime shortest' }
] satisfies Option<SortMode>[];

const numberFormatter = new Intl.NumberFormat('en-US');
const dateFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric'
});

export function LibraryHome({
	staticBaseUrl,
	backendBaseUrl,
	roomId
}: {
	staticBaseUrl: string;
	backendBaseUrl?: string;
	roomId?: string;
}) {
	const searchParams = useSearchParams();
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	const [jobs, setJobs] = useState<LibraryJob[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<LibraryKind>('all');
	const [sort, setSort] = useState<SortMode>('recent-desc');
	const [renderLimit, setRenderLimit] = useState(INITIAL_LIBRARY_ITEMS);

	useEffect(() => {
		if (!backendBaseUrl) {
			return;
		}

		let disposed = false;
		Promise.resolve()
			.then(() => {
				if (!disposed) {
					setLoading(true);
					setError('');
				}
				return fetchJobs(backendBaseUrl);
			})
			.then((nextJobs) => {
				if (!disposed) {
					setJobs(nextJobs);
				}
			})
			.catch((caught) => {
				if (!disposed) {
					setError(caught instanceof Error ? caught.message : 'Unable to load media library');
				}
			})
			.finally(() => {
				if (!disposed) {
					setLoading(false);
				}
			});
		return () => {
			disposed = true;
		};
	}, [backendBaseUrl]);

	const filtered = useMemo(
		() => buildLibraryEntries(jobs, { query, kind, sort }),
		[jobs, query, kind, sort]
	);
	const visibleFiltered = useMemo(
		() => limitLibraryEntries(filtered, renderLimit),
		[filtered, renderLimit]
	);
	const movies = visibleFiltered.filter((entry): entry is MovieEntry => entry.kind === 'movie');
	const shows = visibleFiltered.filter((entry): entry is ShowEntry => entry.kind === 'show');
	const stats = useMemo(() => getLibraryStats(jobs), [jobs]);
	const freshJobIds = useMemo(() => getFreshJobIds(jobs), [jobs]);
	const searchString = searchParams.toString();
	const hasFilters = query.trim() !== '' || kind !== 'all' || sort !== 'recent-desc';
	const matchingItems = countLibraryItems(filtered);
	const renderedItems = countLibraryItems(visibleFiltered);
	const hasMoreItems = renderedItems < matchingItems;
	const visibleItems = matchingItems;
	const displayError = backendBaseUrl ? error : 'Missing backend URL';
	const displayLoading = backendBaseUrl ? loading : false;

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel || !hasMoreItems) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setRenderLimit((value) => value + LIBRARY_ITEMS_BATCH);
				}
			},
			{ rootMargin: '900px 0px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMoreItems, renderedItems]);

	function hrefFor(id: string) {
		if (roomId) {
			return `/${encodeURIComponent(roomId)}/media/${encodeURIComponent(id)}`;
		}
		const params = new URLSearchParams(searchString);
		params.set('mediaId', id);
		const query = params.toString();
		return query ? `/?${query}` : `/?mediaId=${encodeURIComponent(id)}`;
	}

	function clearFilters() {
		setRenderLimit(INITIAL_LIBRARY_ITEMS);
		setQuery('');
		setKind('all');
		setSort('recent-desc');
	}

	return (
		<main className="min-h-screen w-full bg-[linear-gradient(180deg,#08090d_0%,#111017_42%,#08090d_100%)] text-zinc-50">
			<div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-5 sm:px-6 md:px-8 lg:px-10">
				<header className="pt-2">
					<div className="flex min-w-0 flex-col gap-2 min-[960px]:flex-row min-[960px]:items-baseline min-[960px]:gap-4">
						<h1 className="truncate text-4xl font-black tracking-normal text-white sm:text-5xl min-[960px]:shrink-0">
							Library
						</h1>
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
							<HeaderStat icon={IconDeviceTv}>
								{numberFormatter.format(stats.shows)} shows
							</HeaderStat>
							<HeaderStat icon={IconVideo}>
								{numberFormatter.format(stats.episodes)} episodes
							</HeaderStat>
							<HeaderStat icon={IconMovie}>
								{numberFormatter.format(stats.movies)} movies
							</HeaderStat>
						</div>
					</div>
				</header>

				<section className="sticky top-0 z-20 rounded-lg border border-white/10 bg-[#0d0f14]/90 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl">
					<div className="grid gap-3 min-[960px]:grid-cols-[minmax(15rem,1fr)_16rem_12rem]">
						<label className="relative order-2 block min-w-0 min-[960px]:order-none">
							<IconSearch
								className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
								stroke={2.3}
							/>
							<Input
								value={query}
								onChange={(event) => {
									setRenderLimit(INITIAL_LIBRARY_ITEMS);
									setQuery(event.target.value);
								}}
								placeholder="Search title, episode, file"
								className="h-11 rounded-lg border-white/10 bg-white/[0.06] pl-9 text-base text-white shadow-none placeholder:text-zinc-500 focus-visible:ring-[#8de8ce]"
							/>
						</label>

						<div className="order-1 flex w-fit max-w-full min-w-0 justify-self-center overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-1 min-[960px]:order-none min-[960px]:justify-self-start">
							{kindOptions.map((option) => (
								<button
									key={option.value}
									type="button"
									aria-pressed={kind === option.value}
									onClick={() => {
										setRenderLimit(INITIAL_LIBRARY_ITEMS);
										setKind(option.value);
									}}
									className={cn(
										'flex h-9 min-w-20 shrink-0 items-center justify-center rounded-md px-3 text-sm font-semibold text-zinc-400 outline-none transition focus-visible:ring-2 focus-visible:ring-[#8de8ce]',
										kind === option.value
											? 'bg-white text-zinc-950 shadow-sm'
											: 'hover:bg-white/10 hover:text-white'
									)}
								>
									{option.label}
								</button>
							))}
						</div>

						<MenuFilter
							icon={IconSortDescending}
							label="Sort"
							value={sort}
							options={sortOptions}
							className="order-3 min-[960px]:order-none"
							onChange={(value) => {
								setRenderLimit(INITIAL_LIBRARY_ITEMS);
								setSort(value);
							}}
						/>
					</div>
					{hasFilters ? (
						<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
							<span className="rounded-full bg-white/[0.06] px-2.5 py-1">
								{numberFormatter.format(visibleItems)} match{visibleItems === 1 ? '' : 'es'}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={clearFilters}
								className="h-7 gap-1.5 rounded-md px-2 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
							>
								<IconX size={14} stroke={2.4} />
								Clear
							</Button>
						</div>
					) : null}
				</section>

				<section className="space-y-10 pb-12">
					{displayLoading ? (
						<div className="flex min-h-[38vh] items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-8 text-sm text-zinc-400">
							Loading library...
						</div>
					) : null}

					{displayError ? (
						<div className="flex min-h-[38vh] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
							<h2 className="text-lg font-semibold text-white">Library unavailable</h2>
							<p className="mt-2 max-w-md text-sm text-zinc-400">{displayError}</p>
						</div>
					) : null}

					{movies.length ? (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
							{movies.map((movie) => (
								<PosterCard
									key={movie.job.Id}
									job={movie.job}
									href={hrefFor(movie.job.Id)}
									staticBaseUrl={staticBaseUrl}
									title={movie.title}
									meta={movieMeta(movie.job)}
									isFresh={freshJobIds.has(movie.job.Id)}
									posterClassName="aspect-[2/3]"
								/>
							))}
						</div>
					) : null}

					{shows.map((show) => (
						<ShowSection
							key={show.titleId}
							show={show}
							hrefFor={hrefFor}
							staticBaseUrl={staticBaseUrl}
							freshJobIds={freshJobIds}
						/>
					))}

					{hasMoreItems ? (
						<div ref={sentinelRef} className="flex justify-center py-4 text-xs text-zinc-500">
							Showing {numberFormatter.format(renderedItems)} of{' '}
							{numberFormatter.format(matchingItems)}
						</div>
					) : null}

					{!displayLoading && !displayError && !movies.length && !shows.length ? (
						<div className="flex min-h-[38vh] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
							<div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-400">
								<IconMovieOff size={26} stroke={1.8} />
							</div>
							<h2 className="text-lg font-semibold text-white">No matches</h2>
							<p className="mt-2 max-w-md text-sm text-zinc-400">
								Try a different search, media type, or sort option.
							</p>
							{hasFilters ? (
								<Button
									variant="secondary"
									onClick={clearFilters}
									className="mt-5 rounded-md bg-white text-zinc-950 hover:bg-zinc-200"
								>
									Clear filters
								</Button>
							) : null}
						</div>
					) : null}
				</section>
			</div>
		</main>
	);
}

function ShowSection({
	show,
	hrefFor,
	staticBaseUrl,
	freshJobIds
}: {
	show: ShowEntry;
	hrefFor: (id: string) => string;
	staticBaseUrl: string;
	freshJobIds: Set<string>;
}) {
	const [showCollapsed, setShowCollapsed] = useState(false);
	const [collapsedSeasons, setCollapsedSeasons] = useState<Set<string>>(() => new Set());
	const showBodyId = `${show.titleId}-show-body`;

	function toggleSeason(key: string) {
		setCollapsedSeasons((current) => {
			const next = new Set(current);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}

	return (
		<section className="space-y-3">
			<button
				type="button"
				aria-expanded={!showCollapsed}
				aria-controls={showBodyId}
				onClick={() => setShowCollapsed((collapsed) => !collapsed)}
				className="group flex w-full flex-col gap-2.5 border-b border-white/10 pb-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#8de8ce]"
			>
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="mt-5 flex size-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.035] text-zinc-400 transition group-hover:bg-white/[0.07]">
						<IconChevronDown
							className={cn('size-3.5 transition-transform', showCollapsed && '-rotate-90')}
							stroke={2.2}
						/>
					</span>
					<PosterArt
						job={show.rep}
						staticBaseUrl={staticBaseUrl}
						title={show.title}
						className="hidden aspect-[2/3] w-12 rounded-md md:block"
					/>
					<div className="min-w-0">
						<div className="mb-1 flex flex-wrap items-center gap-2 text-[0.7rem] font-semibold text-[#8de8ce]">
							<IconDeviceTv className="size-3.5" stroke={2.2} />
							Show
							<span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-300">
								{numberFormatter.format(show.seasons.length)} season
								{show.seasons.length === 1 ? '' : 's'}
							</span>
						</div>
						<h2 className="line-clamp-2 text-lg font-black tracking-normal text-white md:text-xl">
							{show.title}
						</h2>
						<div className="mt-1.5 flex flex-wrap gap-2 text-xs text-zinc-400">
							<InfoChip icon={IconVideo}>
								{numberFormatter.format(show.episodes.length)} episode
								{show.episodes.length === 1 ? '' : 's'}
							</InfoChip>
							<InfoChip icon={IconClock}>{formatDuration(show.duration)}</InfoChip>
							<InfoChip icon={IconCalendar}>{formatDate(show.modTime)}</InfoChip>
						</div>
					</div>
				</div>
			</button>

			<div id={showBodyId} hidden={showCollapsed} className="space-y-5">
				{show.seasons.map((season) => {
					const seasonKey = `${show.titleId}-${season.number}`;
					const collapsed = collapsedSeasons.has(seasonKey);
					const episodeGridId = `${seasonKey}-episodes`;

					return (
						<section key={seasonKey} className="space-y-2">
							<button
								type="button"
								aria-expanded={!collapsed}
								aria-controls={episodeGridId}
								onClick={() => toggleSeason(seasonKey)}
								className="flex w-fit max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-left outline-none transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[#8de8ce]"
							>
								<IconChevronDown
									className={cn(
										'size-3.5 shrink-0 text-zinc-400 transition-transform',
										collapsed && '-rotate-90'
									)}
									stroke={2.2}
								/>
								<div className="flex min-w-0 items-center gap-1.5">
									<IconStack2 className="size-3.5 shrink-0 text-[#ffcf67]" stroke={2.2} />
									<h3 className="truncate text-sm font-extrabold text-white">
										Season {season.number || 1}
									</h3>
								</div>
								<span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[0.68rem] font-semibold text-zinc-300">
									{numberFormatter.format(season.episodes.length)} episode
									{season.episodes.length === 1 ? '' : 's'}
								</span>
							</button>
							<div
								id={episodeGridId}
								hidden={collapsed}
								className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3"
							>
								{season.episodes.map(({ job, episode }) => (
									<EpisodeCard
										key={job.Id}
										job={job}
										episode={episode}
										href={hrefFor(job.Id)}
										staticBaseUrl={staticBaseUrl}
										isFresh={freshJobIds.has(job.Id)}
									/>
								))}
							</div>
						</section>
					);
				})}
			</div>
		</section>
	);
}

function PosterCard({
	job,
	href,
	staticBaseUrl,
	title,
	meta,
	isFresh,
	posterClassName
}: {
	job: LibraryJob;
	href: string;
	staticBaseUrl: string;
	title: string;
	meta: string;
	isFresh: boolean;
	posterClassName: string;
}) {
	return (
		<article className="group min-w-0">
			<Link
				href={href}
				prefetch={false}
				className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8de8ce]"
			>
				<div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/25 transition duration-200 group-hover:-translate-y-1 group-hover:border-white/25 group-hover:shadow-[#ec275f]/15">
					<PosterArt
						job={job}
						staticBaseUrl={staticBaseUrl}
						title={title}
						className={posterClassName}
					/>
					<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
						<span className="flex size-9 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg">
							<IconPlayerPlay size={18} stroke={2.6} />
						</span>
						<CodecPill job={job} />
					</div>
					{isFresh ? <FreshBadge /> : null}
				</div>
				<div className="mt-3 min-w-0">
					<h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-extrabold leading-5 text-white">
						{title}
					</h3>
					<p className="mt-1 truncate text-xs text-zinc-500">{meta}</p>
				</div>
			</Link>
		</article>
	);
}

function EpisodeCard({
	job,
	episode,
	href,
	staticBaseUrl,
	isFresh
}: {
	job: LibraryJob;
	episode: TitleEpisode;
	href: string;
	staticBaseUrl: string;
	isFresh: boolean;
}) {
	return (
		<article className="group min-w-0 rounded-md border border-white/10 bg-white/[0.04] p-1.5 transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07]">
			<Link
				href={href}
				prefetch={false}
				className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8de8ce]"
			>
				<div className="relative overflow-hidden rounded-md">
					<PosterArt
						job={job}
						staticBaseUrl={staticBaseUrl}
						title={episode.title}
						className="aspect-video rounded-md"
					/>
					<div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />
					<span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[0.68rem] font-black text-white ring-1 ring-white/10">
						{episode.se}
					</span>
					<span className="absolute bottom-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-white text-zinc-950 opacity-0 shadow-lg transition group-hover:opacity-100">
						<IconPlayerPlay size={15} stroke={2.6} />
					</span>
					{isFresh ? <FreshBadge /> : null}
				</div>
				<div className="min-w-0 px-0.5 pb-0.5 pt-2">
					<h4 className="line-clamp-2 min-h-8 text-[0.8125rem] font-extrabold leading-4 text-white">
						{episode.title}
					</h4>
					<div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[0.7rem] text-zinc-500">
						<span className="truncate">{formatDuration(job.Duration)}</span>
						<CodecPill job={job} compact />
					</div>
				</div>
			</Link>
		</article>
	);
}

function PosterArt({
	job,
	staticBaseUrl,
	title,
	className
}: {
	job: LibraryJob;
	staticBaseUrl: string;
	title: string;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const color = getPosterColor(job);
	const fallbackStyle = { '--poster-color': color } as CSSProperties;

	return (
		<div
			className={cn(
				'relative flex overflow-hidden bg-[linear-gradient(135deg,var(--poster-color),#111827_72%)]',
				className
			)}
			style={fallbackStyle}
		>
			{failed ? (
				<div className="flex h-full w-full items-center justify-center text-white/55">
					<IconPhoto size={30} stroke={1.8} />
				</div>
			) : (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={`${staticBaseUrl}/${job.Id}/poster.jpg`}
					alt={title}
					loading="lazy"
					decoding="async"
					onError={() => setFailed(true)}
					className="h-full w-full object-cover"
				/>
			)}
		</div>
	);
}

function MenuFilter<T extends string>({
	icon: Icon,
	label,
	value,
	options,
	className,
	onChange
}: {
	icon: IconComponent;
	label: string;
	value: T;
	options: Option<T>[];
	className?: string;
	onChange: (value: T) => void;
}) {
	const current = options.find((option) => option.value === value)?.label ?? label;

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<Button
					variant="outline"
					className={cn(
						'h-11 w-full justify-between gap-3 rounded-lg border-white/10 bg-white/[0.06] px-3 text-zinc-100 shadow-none hover:bg-white/10 hover:text-white',
						className
					)}
				>
					<span className="flex min-w-0 items-center gap-2">
						<Icon className="size-4 shrink-0 text-[#8de8ce]" stroke={2.2} />
						<span className="truncate">{current}</span>
					</span>
					<IconChevronDown className="size-4 shrink-0 text-zinc-500" stroke={2.2} />
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				align="end"
				className="min-w-[13rem] border-white/10 bg-[#111318] text-zinc-100 shadow-2xl shadow-black/40"
			>
				<DropdownMenu.Label className="text-xs text-zinc-500">{label}</DropdownMenu.Label>
				<DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
					{options.map((option) => (
						<DropdownMenu.RadioItem
							key={option.value}
							value={option.value}
							className="rounded-md text-sm focus:bg-white/10 data-[highlighted]:bg-white/10"
						>
							{option.label}
						</DropdownMenu.RadioItem>
					))}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	);
}

function HeaderStat({ icon: Icon, children }: { icon?: IconComponent; children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
			{Icon ? <Icon className="size-3.5 text-[#8de8ce]" stroke={2.2} /> : null}
			{children}
		</span>
	);
}

function InfoChip({ icon: Icon, children }: { icon: IconComponent; children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
			<Icon className="size-3.5 text-zinc-500" stroke={2.2} />
			{children}
		</span>
	);
}

function CodecPill({ job, compact = false }: { job: LibraryJob; compact?: boolean }) {
	const codecs = job.EncodedCodecs?.map(codecLabel).filter(Boolean) ?? [];
	const label = codecs[0] ?? job.ExtractedQuality ?? 'Video';

	return (
		<span
			className={cn(
				'inline-flex shrink-0 items-center rounded-md bg-black/55 font-black uppercase tracking-normal text-white ring-1 ring-white/10',
				compact ? 'px-1.5 py-0.5 text-[0.625rem]' : 'px-2 py-1 text-[0.68rem]'
			)}
		>
			{label}
		</span>
	);
}

function FreshBadge() {
	return (
		<span className="absolute right-2 top-2 rounded-full bg-[#ec275f] px-2 py-1 text-[0.625rem] font-black uppercase tracking-normal text-white shadow-lg">
			New
		</span>
	);
}

function buildLibraryEntries(
	jobs: LibraryJob[],
	filters: {
		query: string;
		kind: LibraryKind;
		sort: SortMode;
	}
) {
	const query = filters.query.trim().toLowerCase();
	const includeMovies = filters.kind === 'all' || filters.kind === 'movies';
	const includeShows = filters.kind === 'all' || filters.kind === 'shows';
	const movies: MovieEntry[] = [];
	const showsById = new Map<string, EpisodeEntry[]>();
	const showTitles = new Map<string, string>();

	for (const job of jobs) {
		if (!matchesQuery(job, query)) {
			continue;
		}
		if (job.Title.episode) {
			if (!includeShows) {
				continue;
			}
			const key = job.Title.titleId;
			if (!showsById.has(key)) {
				showsById.set(key, []);
				showTitles.set(key, job.Title.title);
			}
			showsById.get(key)?.push({ job, episode: job.Title.episode });
		} else if (includeMovies) {
			movies.push({
				kind: 'movie',
				job,
				title: job.Title.title,
				sortTitle: normalizeSortTitle(job.Title.title),
				modTime: job.JobModTime,
				duration: job.Duration ?? 0
			});
		}
	}

	const shows = Array.from(showsById.entries()).map(([titleId, episodes]) =>
		buildShowEntry(titleId, showTitles.get(titleId) ?? 'Untitled Show', episodes)
	);
	const entries: LibraryEntry[] = [...movies, ...shows];

	return sortEntries(entries, filters.sort);
}

function countLibraryItems(entries: LibraryEntry[]) {
	return entries.reduce(
		(count, entry) => count + (entry.kind === 'show' ? entry.episodes.length : 1),
		0
	);
}

function limitLibraryEntries(entries: LibraryEntry[], limit: number) {
	let remaining = limit;
	const result: LibraryEntry[] = [];

	for (const entry of entries) {
		if (remaining <= 0) {
			break;
		}
		if (entry.kind === 'movie') {
			result.push(entry);
			remaining -= 1;
			continue;
		}

		const episodes = entry.episodes.slice(0, remaining);
		if (!episodes.length) {
			break;
		}
		result.push(buildShowEntry(entry.titleId, entry.title, episodes));
		remaining -= episodes.length;
	}

	return result;
}

function buildShowEntry(titleId: string, title: string, episodes: EpisodeEntry[]): ShowEntry {
	const sortedEpisodes = episodes
		.slice()
		.sort(
			(a, b) =>
				a.episode.season - b.episode.season ||
				a.episode.episode - b.episode.episode ||
				a.episode.title.localeCompare(b.episode.title)
		);
	const seasonsByNumber = new Map<number, EpisodeEntry[]>();
	for (const entry of sortedEpisodes) {
		const season = entry.episode.season || 1;
		if (!seasonsByNumber.has(season)) {
			seasonsByNumber.set(season, []);
		}
		seasonsByNumber.get(season)?.push(entry);
	}

	const rep =
		sortedEpisodes
			.slice()
			.sort((a, b) => b.job.JobModTime - a.job.JobModTime)
			.find(({ job }) => Boolean(job.Files?.['poster.jpg']))?.job ?? sortedEpisodes[0].job;

	return {
		kind: 'show',
		title,
		titleId,
		episodes: sortedEpisodes,
		seasons: Array.from(seasonsByNumber.entries())
			.sort(([a], [b]) => a - b)
			.map(([number, seasonEpisodes]) => ({
				number,
				episodes: seasonEpisodes
			})),
		rep,
		sortTitle: normalizeSortTitle(title),
		modTime: Math.max(...sortedEpisodes.map(({ job }) => job.JobModTime)),
		duration: sortedEpisodes.reduce((total, { job }) => total + (job.Duration ?? 0), 0)
	};
}

function sortEntries(entries: LibraryEntry[], sort: SortMode) {
	return entries.slice().sort((a, b) => {
		if (sort === 'title-asc') {
			return a.sortTitle.localeCompare(b.sortTitle) || b.modTime - a.modTime;
		}
		if (sort === 'title-desc') {
			return b.sortTitle.localeCompare(a.sortTitle) || b.modTime - a.modTime;
		}
		if (sort === 'duration-desc') {
			return b.duration - a.duration || a.sortTitle.localeCompare(b.sortTitle);
		}
		if (sort === 'duration-asc') {
			return a.duration - b.duration || a.sortTitle.localeCompare(b.sortTitle);
		}
		if (sort === 'recent-asc') {
			return a.modTime - b.modTime || a.sortTitle.localeCompare(b.sortTitle);
		}
		return b.modTime - a.modTime || a.sortTitle.localeCompare(b.sortTitle);
	});
}

function matchesQuery(job: LibraryJob, query: string) {
	if (!query) {
		return true;
	}
	const episode = job.Title.episode;
	const haystack = [
		job.Title.title,
		episode?.title,
		episode?.se,
		job.Input,
		job.Id,
		job.ExtractedQuality
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return query
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

function getLibraryStats(jobs: LibraryJob[]) {
	const shows = new Set<string>();
	const movies = new Set<string>();
	let episodes = 0;

	for (const job of jobs) {
		if (job.Title.episode) {
			shows.add(job.Title.titleId);
			episodes += 1;
		} else {
			movies.add(job.Title.titleId);
		}
	}

	return {
		shows: shows.size,
		episodes,
		movies: movies.size
	};
}

function getFreshJobIds(jobs: LibraryJob[]) {
	const ids = new Set<string>();
	const recentCutoff = Date.now() / 1000 - 7 * 24 * 60 * 60;
	for (const job of jobs) {
		if (job.JobModTime >= recentCutoff) {
			ids.add(job.Id);
		}
	}
	for (const job of jobs
		.slice()
		.sort((a, b) => b.JobModTime - a.JobModTime)
		.slice(0, 7)) {
		ids.add(job.Id);
	}
	return ids;
}

function normalizeCodec(codec: string) {
	return codec.toLowerCase().replace(/-8bit|-10bit/g, '');
}

function codecLabel(codec: string) {
	const normalized = normalizeCodec(codec);
	if (normalized === 'av1') {
		return 'AV1';
	}
	if (normalized === 'hevc') {
		return 'HEVC';
	}
	if (normalized === 'h264') {
		return 'H.264';
	}
	return codec.toUpperCase();
}

function normalizeSortTitle(title: string) {
	return title.replace(/^(the|a|an)\s+/i, '').toLowerCase();
}

function movieMeta(job: LibraryJob) {
	return [job.ExtractedQuality, formatDuration(job.Duration), formatDate(job.JobModTime)]
		.filter(Boolean)
		.join(' / ');
}

function formatDuration(seconds: number | undefined) {
	if (!seconds) {
		return 'Unknown runtime';
	}
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.round((seconds % 3600) / 60);
	if (hours <= 0) {
		return `${minutes}m`;
	}
	if (minutes === 0) {
		return `${hours}h`;
	}
	return `${hours}h ${minutes}m`;
}

function formatDate(seconds: number | undefined) {
	if (!seconds) {
		return 'Unknown date';
	}
	return dateFormatter.format(new Date(seconds * 1000));
}

function getPosterColor(job: LibraryJob) {
	const color = job.DominantColors?.find((value) => /^#[0-9a-f]{6}$/i.test(value));
	return color ?? '#ec275f';
}
