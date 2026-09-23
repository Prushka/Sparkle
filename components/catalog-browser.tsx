'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
	IconArrowLeft,
	IconChevronRight,
	IconDeviceTv,
	IconMovie,
	IconPlayerPlayFilled,
	IconRefresh,
	IconSearch,
	IconX
} from '@tabler/icons-react';
import { libraryArtwork, libraryPage, type LibraryItem, type LibrarySource } from '@/lib/library';
import { joinBackendPath } from '@/lib/player/data';
import { Button } from '@/components/ui/button';

function itemDescription(item: LibraryItem) {
	const kind = {
		movie: 'Movie',
		show: 'TV Show',
		season: 'Season',
		episode: item.index ? `Episode ${item.index}` : 'Episode'
	}[item.kind];
	const count = item.children
		? `${item.children} ${item.kind === 'show' && item.source === 'plex' ? (item.children === 1 ? 'season' : 'seasons') : item.children === 1 ? 'episode' : 'episodes'}`
		: '';
	const duration =
		item.duration > 0 && item.kind !== 'show' && item.kind !== 'season'
			? `${Math.round(item.duration / 60)} min`
			: '';
	return [item.year || kind, count || duration].filter(Boolean).join(' · ');
}

export function CatalogBrowser({
	backendBaseUrl,
	staticBaseUrl,
	hrefFor,
	onSelect,
	compact = false
}: {
	backendBaseUrl: string;
	staticBaseUrl: string;
	hrefFor?: (id: string) => string;
	onSelect?: (id: string) => void;
	compact?: boolean;
}) {
	const [sources, setSources] = useState<LibrarySource[]>([]);
	const [source, setSource] = useState('all'),
		[library, setLibrary] = useState(''),
		[kind, setKind] = useState('all');
	const [sort, setSort] = useState('recent-desc'),
		[search, setSearch] = useState(''),
		[query, setQuery] = useState('');
	const [trail, setTrail] = useState<LibraryItem[]>([]),
		[items, setItems] = useState<LibraryItem[]>([]);
	const [total, setTotal] = useState(0),
		[cursor, setCursor] = useState<string>();
	const [error, setError] = useState(''),
		[warnings, setWarnings] = useState<string[]>([]);
	const [loading, setLoading] = useState(true),
		[revision, setRevision] = useState(0),
		[width, setWidth] = useState(960);
	const scrollRef = useRef<HTMLDivElement>(null),
		requestRef = useRef<AbortController | null>(null),
		busyRef = useRef(false);
	const current = trail.at(-1),
		parent = current?.id;
	const episodes = current?.kind === 'season';
	const gap = compact ? 12 : 20;
	const columns = Math.max(
		episodes ? 1 : 2,
		Math.floor((width + gap) / ((episodes ? 285 : compact ? 145 : 180) + gap))
	);
	const cardWidth = (width - gap * (columns - 1)) / columns;
	const posterHeight = episodes ? (cardWidth * 9) / 16 : cardWidth * 1.5;
	const rowHeight = Math.ceil(posterHeight + (episodes ? 108 : 82));
	useEffect(() => {
		const controller = new AbortController();
		fetch(joinBackendPath(backendBaseUrl, '/library/sources'), { signal: controller.signal })
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((v) => setSources(v.sources))
			.catch(() => {});
		return () => controller.abort();
	}, [backendBaseUrl]);
	useEffect(() => {
		const timer = setTimeout(() => setQuery(search.trim()), 300);
		return () => clearTimeout(timer);
	}, [search]);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setWidth(Math.max(1, el.clientWidth - 12)));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	const load = useCallback(
		async (next?: string) => {
			if (next && busyRef.current) return;
			requestRef.current?.abort();
			const controller = new AbortController();
			requestRef.current = controller;
			busyRef.current = true;
			setLoading(true);
			setError('');
			try {
				const params = new URLSearchParams({
					source,
					libraryId: library,
					kind,
					sort,
					query,
					limit: '48'
				});
				if (next) params.set('cursor', next);
				const page = await libraryPage(backendBaseUrl, params, parent, controller.signal);
				if (controller.signal.aborted) return;
				setItems((old) => {
					if (!next) return page.items;
					const ids = new Set(old.map((i) => i.id));
					return [...old, ...page.items.filter((i) => !ids.has(i.id))];
				});
				setTotal(page.total);
				setCursor(page.nextCursor);
				setWarnings(page.warnings ?? []);
			} catch (e) {
				if (!controller.signal.aborted)
					setError(e instanceof Error ? e.message : 'Unable to load library');
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false);
					busyRef.current = false;
				}
			}
		},
		[backendBaseUrl, source, library, kind, sort, query, parent]
	);
	useEffect(() => {
		setItems([]);
		setCursor(undefined);
		setTotal(0);
		setWarnings([]);
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
		void load();
		return () => requestRef.current?.abort();
	}, [load, revision]);
	const virtualizer = useVirtualizer({
		count: Math.ceil(items.length / columns),
		getScrollElement: () => scrollRef.current,
		estimateSize: () => rowHeight,
		overscan: 2
	});
	useEffect(() => {
		virtualizer.measure();
	}, [virtualizer, rowHeight]);
	const rows = virtualizer.getVirtualItems(),
		lastRow = rows.at(-1)?.index ?? -1;
	useEffect(() => {
		if (cursor && !loading && !error && (lastRow + 2) * columns >= items.length) void load(cursor);
	}, [cursor, loading, error, lastRow, columns, items.length, load]);
	const reset = () => {
		setSearch('');
		setQuery('');
		setSource('all');
		setLibrary('');
		setKind('all');
		setTrail([]);
	};
	const selectClass =
		'h-10 min-w-0 rounded-lg border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary';
	const title =
		current?.title ??
		(query
			? `Results for “${query}”`
			: (sources.find((s) => s.id === library)?.title ?? 'Your library'));
	return (
		<section
			className={`flex min-h-0 flex-col gap-3 sm:gap-5 ${compact ? '' : 'flex-1 overflow-hidden'}`}
			aria-label="Media library"
		>
			<div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-muted/25 p-3">
				<div className="relative min-w-44 flex-1 basis-full sm:basis-0">
					<IconSearch
						size={18}
						className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
					/>
					<input
						type="search"
						aria-label="Search library"
						placeholder="Search movies, shows, and more"
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setTrail([]);
						}}
						className={`${selectClass} w-full border-transparent bg-background/75 pr-9 pl-10`}
					/>
					{search && (
						<button
							aria-label="Clear search"
							className="absolute top-2.5 right-2 rounded text-muted-foreground hover:text-foreground"
							onClick={() => setSearch('')}
						>
							<IconX size={20} />
						</button>
					)}
				</div>
				<select
					aria-label="Source"
					value={source}
					onChange={(e) => {
						setSource(e.target.value);
						setLibrary('');
						setTrail([]);
					}}
					className={selectClass}
				>
					<option value="all">Both sources</option>
					<option value="processed">Processed</option>
					<option value="plex">Plex · Raw</option>
				</select>
				{source !== 'processed' && (
					<select
						aria-label="Plex library"
						value={library}
						onChange={(e) => {
							setLibrary(e.target.value);
							if (e.target.value) setSource('plex');
							setTrail([]);
						}}
						className={`${selectClass} max-w-48`}
					>
						<option value="">All libraries</option>
						{sources
							.filter((s) => s.source === 'plex')
							.map((s) => (
								<option key={s.id} value={s.id}>
									{s.title}
								</option>
							))}
					</select>
				)}
				<button
					aria-label="Refresh library"
					title="Refresh library"
					className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
					onClick={() => setRevision((r) => r + 1)}
				>
					<IconRefresh size={19} className={loading ? 'animate-spin' : ''} />
				</button>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
				<div className="flex gap-1" role="group" aria-label="Media type">
					{[
						['all', 'All titles'],
						['movies', 'Movies'],
						['shows', 'TV Shows']
					].map(([value, label]) => (
						<button
							key={value}
							aria-pressed={kind === value}
							onClick={() => {
								setKind(value);
								setTrail([]);
							}}
							className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary ${kind === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
						>
							{label}
						</button>
					))}
				</div>
				<select
					aria-label="Sort library"
					value={sort}
					onChange={(e) => setSort(e.target.value)}
					className={`${selectClass} border-transparent`}
				>
					<option value="recent-desc">Recently added</option>
					<option value="recent-asc">Oldest first</option>
					<option value="title-asc">Title A–Z</option>
					<option value="title-desc">Title Z–A</option>
					<option value="duration-desc">Longest first</option>
					<option value="duration-asc">Shortest first</option>
				</select>
			</div>
			<nav className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Library hierarchy">
				{trail.length > 0 && (
					<button
						aria-label="Back to parent"
						className="mr-1 rounded-full p-1.5 hover:bg-muted"
						onClick={() => setTrail((t) => t.slice(0, -1))}
					>
						<IconArrowLeft size={17} />
					</button>
				)}
				<button
					className="rounded px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
					onClick={() => setTrail([])}
				>
					Library
				</button>
				{trail.map((item, i) => (
					<span key={item.id} className="flex min-w-0 items-center gap-1.5">
						<IconChevronRight size={14} className="shrink-0 text-muted-foreground" />
						<button
							aria-current={i === trail.length - 1 ? 'page' : undefined}
							className="max-w-60 truncate rounded px-1 py-1 hover:text-primary"
							onClick={() => setTrail((t) => t.slice(0, i + 1))}
						>
							{item.title}
						</button>
					</span>
				))}
				<span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
					{loading && !items.length
						? 'Loading…'
						: `${total.toLocaleString()} ${episodes ? (total === 1 ? 'episode' : 'episodes') : total === 1 ? 'item' : 'items'}`}
				</span>
			</nav>
			<div className="-mt-2 flex items-end gap-4">
				<div className="min-w-0">
					<h2
						className={`${compact ? 'text-xl' : 'text-2xl sm:text-3xl'} font-semibold tracking-tight`}
					>
						{title}
					</h2>
					{current?.summary && (
						<p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
							{current.summary}
						</p>
					)}
				</div>
			</div>
			{warnings.map((w) => (
				<p
					key={w}
					role="status"
					className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300"
				>
					{w}
				</p>
			))}
			{error && (
				<p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
					{error}{' '}
					<button className="ml-2 underline" onClick={() => setRevision((r) => r + 1)}>
						Try again
					</button>
				</p>
			)}
			<div
				ref={scrollRef}
				aria-label="Library titles"
				aria-busy={loading}
				className="overflow-auto overscroll-contain pb-2"
				style={{
					height: compact ? 'min(52vh, 560px)' : undefined,
					flex: compact ? undefined : '1 1 0%',
					minHeight: compact ? 250 : 120,
					scrollbarGutter: 'stable'
				}}
			>
				{loading && !items.length ? (
					<div
						className="grid animate-pulse gap-5 pr-3"
						style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
					>
						{Array.from({ length: columns * 2 }, (_, i) => (
							<div key={i}>
								<div className="rounded-xl bg-muted" style={{ height: posterHeight }} />
								<div className="mt-3 h-3 w-3/4 rounded bg-muted" />
								<div className="mt-2 h-3 w-1/2 rounded bg-muted" />
							</div>
						))}
					</div>
				) : null}
				<div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
					{rows.map((row) => (
						<div
							key={row.key}
							className="absolute left-0 top-0 grid pr-3"
							style={{
								width: '100%',
								gap,
								transform: `translateY(${row.start}px)`,
								height: rowHeight,
								gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
							}}
						>
							{items.slice(row.index * columns, (row.index + 1) * columns).map((item) => {
								const children = item.kind === 'show' || item.kind === 'season';
								const body = (
									<>
										<div
											className="relative overflow-hidden rounded-xl bg-muted shadow-sm ring-1 ring-black/5 transition-shadow group-hover:shadow-lg group-hover:ring-2 group-hover:ring-primary/70 group-focus-visible:ring-2 group-focus-visible:ring-primary"
											style={{ height: posterHeight }}
										>
											<div
												aria-hidden="true"
												className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-muted to-muted-foreground/10 px-5 text-center text-muted-foreground"
											>
												<IconMovie size={32} stroke={1.2} />
												<span className="line-clamp-3 text-sm font-medium">{item.title}</span>
											</div>
											{item.poster && (
												<img
													alt=""
													src={libraryArtwork(backendBaseUrl, staticBaseUrl, item.poster)}
													loading="lazy"
													decoding="async"
													className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
													onError={(e) => {
														e.currentTarget.style.visibility = 'hidden';
													}}
												/>
											)}
											{item.source === 'plex' && (
												<span className="absolute top-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white backdrop-blur-md">
													Raw
												</span>
											)}
											<div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
												<span className="rounded-full bg-white/95 p-3 text-black shadow-lg">
													{children ? (
														<IconDeviceTv size={23} />
													) : (
														<IconPlayerPlayFilled size={23} />
													)}
												</span>
											</div>
										</div>
										<p className="mt-3 truncate text-sm font-semibold leading-5" title={item.title}>
											{episodes && item.index ? `${item.index}. ` : ''}
											{item.title}
										</p>
										<p className="mt-0.5 truncate text-xs text-muted-foreground">
											{itemDescription(item)}
										</p>
										{episodes && item.summary && (
											<p className="mt-2 line-clamp-2 text-xs leading-4 text-muted-foreground">
												{item.summary}
											</p>
										)}
									</>
								);
								const className =
									'group block min-w-0 self-start rounded-xl text-left outline-none';
								return children || onSelect ? (
									<button
										key={item.id}
										className={className}
										onClick={() => (children ? setTrail((t) => [...t, item]) : onSelect?.(item.id))}
									>
										{body}
									</button>
								) : (
									<Link
										key={item.id}
										prefetch={false}
										className={className}
										href={hrefFor?.(item.id) ?? `/?mediaId=${encodeURIComponent(item.id)}`}
									>
										{body}
									</Link>
								);
							})}
						</div>
					))}
				</div>
				{!loading && !error && !items.length && (
					<div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
						<IconSearch size={36} stroke={1.3} className="text-muted-foreground" />
						<h3 className="text-lg font-semibold">No matching titles</h3>
						<p className="text-sm text-muted-foreground">
							Try another search or choose a different library.
						</p>
						<Button variant="outline" onClick={reset}>
							Clear filters
						</Button>
					</div>
				)}
			</div>
			{cursor && (
				<Button
					disabled={loading}
					variant="ghost"
					className="mx-auto"
					onClick={() => void load(cursor)}
				>
					{loading ? 'Loading…' : 'Load more'}
				</Button>
			)}
		</section>
	);
}
