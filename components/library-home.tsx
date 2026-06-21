'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
	IconCalendar,
	IconChevronDown,
	IconClock,
	IconDeviceTv,
	IconLoader2,
	IconMoon,
	IconMovie,
	IconMovieOff,
	IconPhoto,
	IconPlayerPlay,
	IconRefresh,
	IconSearch,
	IconSortDescending,
	IconStack2,
	IconSun,
	IconVideo,
	IconX
} from '@tabler/icons-react';
import {
	useEffect,
	useCallback,
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
import * as Tooltip from '@/components/ui/tooltip';
import { RoomNavigationInput } from '@/components/room-navigation-input';
import { cn } from '@/lib/utils';
import { type LibraryJob, type TitleEpisode } from '@/lib/player/t';
import { fetchJobs } from '@/lib/player/data';
import { useTheme } from '@/lib/theme';

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
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<LibraryKind>('all');
	const [sort, setSort] = useState<SortMode>('recent-desc');
	const [renderLimit, setRenderLimit] = useState(INITIAL_LIBRARY_ITEMS);
	const loadRequestRef = useRef(0);
	const { theme, setTheme } = useTheme();
	const nextTheme = theme === 'dark' ? 'light' : 'dark';
	const themeLabel = `Switch to ${nextTheme} theme`;

	const loadJobs = useCallback(
		(force = false) => {
			if (!backendBaseUrl) {
				return;
			}

			const requestId = loadRequestRef.current + 1;
			loadRequestRef.current = requestId;
			if (!force) {
				setLoading(true);
			}
			setRefreshing(force);
			setError('');
			fetchJobs(backendBaseUrl, force)
				.then((nextJobs) => {
					if (loadRequestRef.current === requestId) {
						setJobs(nextJobs);
					}
				})
				.catch((caught) => {
					if (loadRequestRef.current === requestId) {
						setError(caught instanceof Error ? caught.message : 'Unable to load media library');
					}
				})
				.finally(() => {
					if (loadRequestRef.current === requestId) {
						setLoading(false);
						setRefreshing(false);
					}
				});
		},
		[backendBaseUrl]
	);

	useEffect(() => {
		let disposed = false;
		Promise.resolve().then(() => {
			if (!disposed) {
				loadJobs();
			}
		});
		return () => {
			disposed = true;
			loadRequestRef.current += 1;
		};
	}, [loadJobs]);

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

	function refreshLibrary() {
		loadJobs(true);
	}

	return (
		<main className="min-h-screen w-full bg-background text-foreground">
			<div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-5 sm:px-6 md:px-8 lg:px-10">
				<header className="pt-2">
					<div className="flex min-w-0 flex-col gap-4 min-[960px]:flex-row min-[960px]:items-end min-[960px]:justify-between">
						<div className="flex min-w-0 flex-col gap-2 min-[960px]:flex-row min-[960px]:items-baseline min-[960px]:gap-4">
							<h1 className="truncate text-4xl font-black tracking-normal text-foreground sm:text-5xl min-[960px]:shrink-0">
								Library
							</h1>
							<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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
						<div className="flex w-full min-w-0 items-center gap-2 min-[960px]:w-[min(35rem,46vw)]">
							<RoomNavigationInput
								inputId="library-room-navigation-input"
								className="min-w-0 flex-1 border-border/70 bg-background/70 shadow-sm"
								inputClassName="text-foreground placeholder:text-muted-foreground"
								buttonClassName="border-border/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							/>
							<Tooltip.Provider delayDuration={0}>
								<Tooltip.Root>
									<Tooltip.Trigger asChild>
										<Button
											type="button"
											variant="outline"
											aria-label={themeLabel}
											className="h-10 w-10 shrink-0 p-0"
											onClick={() => setTheme(nextTheme)}
										>
											{theme === 'dark' ? (
												<IconMoon size={18} stroke={2} />
											) : (
												<IconSun size={18} stroke={2} />
											)}
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										<p>{themeLabel}</p>
									</Tooltip.Content>
								</Tooltip.Root>
							</Tooltip.Provider>
						</div>
					</div>
				</header>

				<section className="sticky top-0 z-20 rounded-lg border border-border bg-card/90 p-3 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-card/80">
					<div className="grid gap-3 min-[960px]:grid-cols-[minmax(15rem,1fr)_16rem_12rem_8.5rem]">
						<label className="relative order-2 block min-w-0 min-[960px]:order-none">
							<IconSearch
								className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								stroke={2.3}
							/>
							<Input
								value={query}
								onChange={(event) => {
									setRenderLimit(INITIAL_LIBRARY_ITEMS);
									setQuery(event.target.value);
								}}
								placeholder="Search title, episode, file"
								className="h-11 rounded-lg border-input bg-background/70 pl-9 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-ring"
							/>
						</label>

						<div className="order-1 flex w-fit max-w-full min-w-0 justify-self-center overflow-x-auto rounded-lg border border-border bg-muted/60 p-1 min-[960px]:order-none min-[960px]:justify-self-start">
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
										'flex h-9 min-w-20 shrink-0 items-center justify-center rounded-md px-3 text-sm font-semibold text-muted-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring',
										kind === option.value
											? 'bg-primary text-primary-foreground shadow-sm'
											: 'hover:bg-accent hover:text-accent-foreground'
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

						<Button
							type="button"
							variant="outline"
							disabled={!backendBaseUrl || refreshing}
							onClick={refreshLibrary}
							aria-busy={refreshing}
							className="order-4 h-11 w-full gap-2 rounded-lg border-input bg-background/70 px-3 text-foreground shadow-none hover:bg-accent hover:text-accent-foreground min-[960px]:order-none"
						>
							{refreshing ? (
								<IconLoader2 className="size-4 shrink-0 animate-spin text-primary" stroke={2.2} />
							) : (
								<IconRefresh className="size-4 shrink-0 text-primary" stroke={2.2} />
							)}
							<span className="inline-block min-w-[4.75rem] text-left">
								{refreshing ? 'Refreshing' : 'Refresh'}
							</span>
						</Button>
					</div>
					{hasFilters ? (
						<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span className="rounded-full bg-muted px-2.5 py-1">
								{numberFormatter.format(visibleItems)} match{visibleItems === 1 ? '' : 'es'}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={clearFilters}
								className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							>
								<IconX size={14} stroke={2.4} />
								Clear
							</Button>
						</div>
					) : null}
				</section>

				<section className="space-y-10 pb-12">
					{displayLoading ? (
						<div className="flex min-h-[38vh] items-center justify-center rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground">
							Loading library...
						</div>
					) : null}

					{displayError ? (
						<div className="flex min-h-[38vh] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
							<h2 className="text-lg font-semibold text-foreground">Library unavailable</h2>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">{displayError}</p>
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
						<div
							ref={sentinelRef}
							className="flex justify-center py-4 text-xs text-muted-foreground"
						>
							Showing {numberFormatter.format(renderedItems)} of{' '}
							{numberFormatter.format(matchingItems)}
						</div>
					) : null}

					{!displayLoading && !displayError && !movies.length && !shows.length ? (
						<div className="flex min-h-[38vh] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
							<div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
								<IconMovieOff size={26} stroke={1.8} />
							</div>
							<h2 className="text-lg font-semibold text-foreground">No matches</h2>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Try a different search, media type, or sort option.
							</p>
							{hasFilters ? (
								<Button variant="secondary" onClick={clearFilters} className="mt-5 rounded-md">
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
				className="group flex w-full flex-col gap-2.5 border-b border-border pb-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<div className="flex min-w-0 items-start gap-2.5">
					<span className="mt-5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/45 text-muted-foreground transition group-hover:bg-accent group-hover:text-accent-foreground">
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
						<div className="mb-1 flex flex-wrap items-center gap-2 text-[0.7rem] font-semibold text-primary">
							<IconDeviceTv className="size-3.5" stroke={2.2} />
							Show
							<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
								{numberFormatter.format(show.seasons.length)} season
								{show.seasons.length === 1 ? '' : 's'}
							</span>
						</div>
						<h2 className="line-clamp-2 text-lg font-black tracking-normal text-foreground md:text-xl">
							{show.title}
						</h2>
						<div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
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
								className="flex w-fit max-w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-left outline-none transition hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
							>
								<IconChevronDown
									className={cn(
										'size-3.5 shrink-0 text-muted-foreground transition-transform',
										collapsed && '-rotate-90'
									)}
									stroke={2.2}
								/>
								<div className="flex min-w-0 items-center gap-1.5">
									<IconStack2 className="size-3.5 shrink-0 text-primary" stroke={2.2} />
									<h3 className="truncate text-sm font-extrabold text-foreground">
										Season {season.number || 1}
									</h3>
								</div>
								<span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.68rem] font-semibold text-muted-foreground">
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
				className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<div className="relative overflow-hidden rounded-lg border border-border bg-card shadow-sm transition duration-200 group-hover:-translate-y-1 group-hover:border-primary/35">
					<PosterArt
						job={job}
						staticBaseUrl={staticBaseUrl}
						title={title}
						className={posterClassName}
					/>
					<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
						<span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
							<IconPlayerPlay size={18} stroke={2.6} />
						</span>
						<CodecPill job={job} />
					</div>
					{isFresh ? <FreshBadge /> : null}
				</div>
				<div className="mt-3 min-w-0">
					<h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-extrabold leading-5 text-foreground">
						{title}
					</h3>
					<p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
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
		<article className="group min-w-0 rounded-md border border-border bg-card p-1.5 transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-accent">
			<Link
				href={href}
				prefetch={false}
				className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
					<span className="absolute bottom-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition group-hover:opacity-100">
						<IconPlayerPlay size={15} stroke={2.6} />
					</span>
					{isFresh ? <FreshBadge /> : null}
				</div>
				<div className="min-w-0 px-0.5 pb-0.5 pt-2">
					<h4 className="line-clamp-2 min-h-8 text-[0.8125rem] font-extrabold leading-4 text-card-foreground">
						{episode.title}
					</h4>
					<div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[0.7rem] text-muted-foreground">
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
				'relative flex overflow-hidden bg-[linear-gradient(135deg,var(--poster-color),hsl(var(--muted))_72%)]',
				className
			)}
			style={fallbackStyle}
		>
			{failed ? (
				<div className="flex h-full w-full items-center justify-center text-muted-foreground">
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
						'h-11 w-full justify-between gap-3 rounded-lg border-input bg-background/70 px-3 text-foreground shadow-none hover:bg-accent hover:text-accent-foreground',
						className
					)}
				>
					<span className="flex min-w-0 items-center gap-2">
						<Icon className="size-4 shrink-0 text-primary" stroke={2.2} />
						<span className="truncate">{current}</span>
					</span>
					<IconChevronDown className="size-4 shrink-0 text-muted-foreground" stroke={2.2} />
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				align="end"
				className="min-w-[13rem] border-border bg-popover text-popover-foreground shadow-md"
			>
				<DropdownMenu.Label className="text-xs text-muted-foreground">{label}</DropdownMenu.Label>
				<DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
					{options.map((option) => (
						<DropdownMenu.RadioItem
							key={option.value}
							value={option.value}
							className="rounded-md text-sm"
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
			{Icon ? <Icon className="size-3.5 text-primary" stroke={2.2} /> : null}
			{children}
		</span>
	);
}

function InfoChip({ icon: Icon, children }: { icon: IconComponent; children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/45 px-2.5 py-1">
			<Icon className="size-3.5 text-muted-foreground" stroke={2.2} />
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
		<span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-1 text-[0.625rem] font-black uppercase tracking-normal text-primary-foreground shadow-lg">
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

		result.push(entry);
		remaining -= entry.episodes.length;
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
	return color ?? 'hsl(var(--primary))';
}
