'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
	IconBadgeHd,
	IconCalendar,
	IconChevronDown,
	IconClock,
	IconDeviceTv,
	IconFilter,
	IconLayoutGrid,
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
import {
	BroadcastTypes,
	randomString,
	SyncTypes,
	type Job,
	type TitleEpisode
} from '@/lib/player/t';

type LibraryKind = 'all' | 'movies' | 'shows';
type SortMode = 'recent' | 'title' | 'duration';

type Option<T extends string> = {
	value: T;
	label: string;
};

type IconComponent = ComponentType<{ className?: string; size?: number; stroke?: number }>;

type MovieEntry = {
	kind: 'movie';
	job: Job;
	title: string;
	sortTitle: string;
	modTime: number;
	duration: number;
};

type EpisodeEntry = {
	job: Job;
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
	rep: Job;
	sortTitle: string;
	modTime: number;
	duration: number;
};

type LibraryEntry = MovieEntry | ShowEntry;

function joinBackendPath(base: string, path: string) {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function getBackendWebSocketUrl(base: string, path: string) {
	const fullPath = joinBackendPath(base, path);
	if (/^https?:\/\//i.test(fullPath)) {
		const url = new URL(fullPath);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		return url.toString();
	}
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${wsProtocol}//${window.location.host}${fullPath}`;
}

function getLibraryRoomPlayerId() {
	const storedPlayerId = window.sessionStorage.getItem('playerId');
	if (storedPlayerId) {
		return storedPlayerId;
	}
	const playerId = randomString(14);
	window.sessionStorage.setItem('playerId', playerId);
	return playerId;
}

function getLibraryProfileId() {
	const storedProfileId = window.localStorage.getItem('id');
	if (storedProfileId) {
		return storedProfileId;
	}
	const profileId = randomString(14);
	window.localStorage.setItem('id', profileId);
	return profileId;
}

function LibraryRoomSync({ backendBaseUrl, roomId }: { backendBaseUrl?: string; roomId?: string }) {
	const router = useRouter();
	const routerRef = useRef(router);

	useEffect(() => {
		routerRef.current = router;
	}, [router]);

	useEffect(() => {
		if (!backendBaseUrl || !roomId || typeof window === 'undefined') {
			return;
		}

		let disposed = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;
		let roomMediaCheck: Promise<void> | null = null;
		const playerId = getLibraryRoomPlayerId();
		const socketUrl = getBackendWebSocketUrl(
			backendBaseUrl,
			`/sync/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`
		);

		const refreshIfRoomHasMedia = () => {
			if (roomMediaCheck) {
				return roomMediaCheck;
			}
			roomMediaCheck = fetch(
				joinBackendPath(backendBaseUrl, `/rooms/${encodeURIComponent(roomId)}`),
				{
					cache: 'no-store'
				}
			)
				.then((response) => (response.ok ? response.json() : null))
				.then((record: { mediaId?: string } | null) => {
					if (!disposed && record?.mediaId) {
						routerRef.current.refresh();
					}
				})
				.catch((error) => {
					console.warn('Unable to refresh empty room media', error);
				})
				.finally(() => {
					roomMediaCheck = null;
				});
			return roomMediaCheck;
		};

		const clearReconnectTimer = () => {
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const connect = () => {
			if (
				disposed ||
				socket?.readyState === WebSocket.CONNECTING ||
				socket?.readyState === WebSocket.OPEN
			) {
				return;
			}
			clearReconnectTimer();
			socket = new WebSocket(socketUrl);

			socket.onopen = () => {
				if (!socket || disposed) {
					return;
				}
				reconnectAttempt = 0;
				void refreshIfRoomHasMedia();
				const name = window.localStorage.getItem('name') || '';
				const profileId = getLibraryProfileId();
				if (name && profileId) {
					socket.send(
						JSON.stringify({
							type: SyncTypes.ProfileSync,
							name,
							profileId
						})
					);
				}
				socket.send(JSON.stringify({ type: SyncTypes.NewPlayer }));
			};

			socket.onmessage = (event) => {
				const payload = JSON.parse(event.data);
				if (
					payload?.type === SyncTypes.BroadcastSync &&
					payload.broadcast?.type === BroadcastTypes.MoveTo &&
					payload.broadcast.moveTo
				) {
					routerRef.current.refresh();
				}
			};

			socket.onerror = () => {
				socket?.close();
			};

			socket.onclose = () => {
				socket = null;
				if (disposed) {
					return;
				}
				const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
				reconnectAttempt += 1;
				reconnectTimer = window.setTimeout(() => {
					reconnectTimer = null;
					connect();
				}, delay);
			};
		};

		void refreshIfRoomHasMedia();
		connect();
		const refreshInterval = window.setInterval(refreshIfRoomHasMedia, 10000);
		const refreshOnFocus = () => {
			void refreshIfRoomHasMedia();
		};
		window.addEventListener('focus', refreshOnFocus);
		document.addEventListener('visibilitychange', refreshOnFocus);

		return () => {
			disposed = true;
			clearReconnectTimer();
			window.clearInterval(refreshInterval);
			window.removeEventListener('focus', refreshOnFocus);
			document.removeEventListener('visibilitychange', refreshOnFocus);
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
			}
		};
	}, [backendBaseUrl, roomId]);

	return null;
}

const kindOptions = [
	{ value: 'all', label: 'All' },
	{ value: 'movies', label: 'Movies' },
	{ value: 'shows', label: 'Shows' }
] satisfies Option<LibraryKind>[];

const sortOptions = [
	{ value: 'recent', label: 'Recently added' },
	{ value: 'title', label: 'Title' },
	{ value: 'duration', label: 'Runtime' }
] satisfies Option<SortMode>[];

const numberFormatter = new Intl.NumberFormat('en-US');
const dateFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric'
});

export function LibraryHome({
	jobs,
	staticBaseUrl,
	backendBaseUrl,
	roomId
}: {
	jobs: Job[];
	staticBaseUrl: string;
	backendBaseUrl?: string;
	roomId?: string;
}) {
	const searchParams = useSearchParams();
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<LibraryKind>('all');
	const [codec, setCodec] = useState('all');
	const [sort, setSort] = useState<SortMode>('recent');

	const codecOptions = useMemo(() => buildCodecOptions(jobs), [jobs]);
	const filtered = useMemo(
		() => buildLibraryEntries(jobs, { query, kind, codec, sort }),
		[jobs, query, kind, codec, sort]
	);
	const movies = filtered.filter((entry): entry is MovieEntry => entry.kind === 'movie');
	const shows = filtered.filter((entry): entry is ShowEntry => entry.kind === 'show');
	const stats = useMemo(() => getLibraryStats(jobs), [jobs]);
	const freshJobIds = useMemo(() => getFreshJobIds(jobs), [jobs]);
	const searchString = searchParams.toString();
	const hasFilters = query.trim() !== '' || kind !== 'all' || codec !== 'all' || sort !== 'recent';
	const visibleEpisodes = shows.reduce((count, show) => count + show.episodes.length, 0);
	const visibleItems = movies.length + visibleEpisodes;

	function hrefFor(id: string) {
		const params = new URLSearchParams(searchString);
		params.set('mediaId', id);
		if (roomId) {
			params.set('room', roomId);
		}
		const query = params.toString();
		return query ? `/rooms/new?${query}` : `/rooms/new?mediaId=${encodeURIComponent(id)}`;
	}

	function clearFilters() {
		setQuery('');
		setKind('all');
		setCodec('all');
		setSort('recent');
	}

	return (
		<main className="min-h-screen w-full bg-[linear-gradient(180deg,#08090d_0%,#111017_42%,#08090d_100%)] text-zinc-50">
			<LibraryRoomSync backendBaseUrl={backendBaseUrl} roomId={roomId} />
			<div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-5 sm:px-6 md:px-8 lg:px-10">
				<header className="flex flex-col gap-5 pt-2 md:flex-row md:items-end md:justify-between">
					<div className="min-w-0">
						<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<h1 className="truncate text-4xl font-black tracking-normal text-white sm:text-5xl">
								Library
							</h1>
							<div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-zinc-400">
								<IconFilter className="size-4 text-[#8de8ce]" stroke={2.2} />
								<span>{numberFormatter.format(visibleItems)} visible</span>
								<span className="h-4 w-px bg-white/10" aria-hidden="true" />
								<span>{numberFormatter.format(jobs.length)} total files</span>
							</div>
						</div>
						<div className="mt-4 flex flex-wrap gap-2">
							<StatPill
								icon={IconLayoutGrid}
								label={`${numberFormatter.format(stats.titles)} titles`}
							/>
							<StatPill
								icon={IconDeviceTv}
								label={`${numberFormatter.format(stats.shows)} shows`}
							/>
							<StatPill
								icon={IconVideo}
								label={`${numberFormatter.format(stats.episodes)} episodes`}
							/>
							<StatPill
								icon={IconBadgeHd}
								label={`${numberFormatter.format(stats.codecs)} codecs`}
							/>
						</div>
					</div>
				</header>

				<section className="sticky top-0 z-20 rounded-lg border border-white/10 bg-[#0d0f14]/90 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl">
					<div className="grid gap-3 min-[960px]:grid-cols-[minmax(15rem,1fr)_16rem_11rem_12rem]">
						<label className="relative block min-w-0">
							<IconSearch
								className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
								stroke={2.3}
							/>
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search title, episode, file"
								className="h-11 rounded-lg border-white/10 bg-white/[0.06] pl-9 text-base text-white shadow-none placeholder:text-zinc-500 focus-visible:ring-[#8de8ce]"
							/>
						</label>

						<div className="flex w-fit max-w-full min-w-0 justify-self-start overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-1">
							{kindOptions.map((option) => (
								<button
									key={option.value}
									type="button"
									aria-pressed={kind === option.value}
									onClick={() => setKind(option.value)}
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
							icon={IconBadgeHd}
							label="Codec"
							value={codec}
							options={codecOptions}
							onChange={setCodec}
						/>
						<MenuFilter
							icon={IconSortDescending}
							label="Sort"
							value={sort}
							options={sortOptions}
							onChange={setSort}
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

					{!movies.length && !shows.length ? (
						<div className="flex min-h-[38vh] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
							<div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-400">
								<IconMovieOff size={26} stroke={1.8} />
							</div>
							<h2 className="text-lg font-semibold text-white">No matches</h2>
							<p className="mt-2 max-w-md text-sm text-zinc-400">
								Try a different search, media type, codec, or sort option.
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
	job: Job;
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
	job: Job;
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
	job: Job;
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
	onChange
}: {
	icon: IconComponent;
	label: string;
	value: T;
	options: Option<T>[];
	onChange: (value: T) => void;
}) {
	const current = options.find((option) => option.value === value)?.label ?? label;

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<Button
					variant="outline"
					className="h-11 w-full justify-between gap-3 rounded-lg border-white/10 bg-white/[0.06] px-3 text-zinc-100 shadow-none hover:bg-white/10 hover:text-white"
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

function StatPill({ icon: Icon, label }: { icon: IconComponent; label: string }) {
	return (
		<span className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 text-xs font-semibold text-zinc-300">
			<Icon className="size-4 text-[#8de8ce]" stroke={2.2} />
			{label}
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

function CodecPill({ job, compact = false }: { job: Job; compact?: boolean }) {
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
	jobs: Job[],
	filters: {
		query: string;
		kind: LibraryKind;
		codec: string;
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
		if (!matchesCodec(job, filters.codec) || !matchesQuery(job, query)) {
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
		if (sort === 'title') {
			return a.sortTitle.localeCompare(b.sortTitle);
		}
		if (sort === 'duration') {
			return b.duration - a.duration || a.sortTitle.localeCompare(b.sortTitle);
		}
		return b.modTime - a.modTime || a.sortTitle.localeCompare(b.sortTitle);
	});
}

function matchesQuery(job: Job, query: string) {
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

function matchesCodec(job: Job, codec: string) {
	if (codec === 'all') {
		return true;
	}
	return (job.EncodedCodecs ?? []).some((candidate) => normalizeCodec(candidate) === codec);
}

function buildCodecOptions(jobs: Job[]) {
	const codecs = Array.from(
		new Set(
			jobs
				.flatMap((job) => job.EncodedCodecs ?? [])
				.map(normalizeCodec)
				.filter(Boolean)
		)
	).sort((a, b) => codecLabel(a).localeCompare(codecLabel(b)));

	return [
		{ value: 'all', label: 'All codecs' },
		...codecs.map((value) => ({ value, label: codecLabel(value) }))
	] satisfies Option<string>[];
}

function getLibraryStats(jobs: Job[]) {
	const shows = new Set<string>();
	const movies = new Set<string>();
	const codecs = new Set<string>();
	let episodes = 0;

	for (const job of jobs) {
		for (const codec of job.EncodedCodecs ?? []) {
			codecs.add(normalizeCodec(codec));
		}
		if (job.Title.episode) {
			shows.add(job.Title.titleId);
			episodes += 1;
		} else {
			movies.add(job.Title.titleId);
		}
	}

	return {
		titles: shows.size + movies.size,
		shows: shows.size,
		episodes,
		codecs: codecs.size
	};
}

function getFreshJobIds(jobs: Job[]) {
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

function movieMeta(job: Job) {
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

function getPosterColor(job: Job) {
	const color = job.DominantColors?.find((value) => /^#[0-9a-f]{6}$/i.test(value));
	return color ?? '#ec275f';
}
