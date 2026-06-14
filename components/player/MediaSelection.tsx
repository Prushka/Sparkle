'use client';

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconCheck, IconChevronRight, IconChevronDown, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Popover from '@/components/ui/popover';
import * as Command from '@/components/ui/command';
import * as Tooltip from '@/components/ui/tooltip';
import { TitlePoster } from '@/components/player/TitlePoster';
import { getTitleComponentsByJobs, type Job, type LibraryJob } from '@/lib/player/t';
import { fetchJobs } from '@/lib/player/data';
import { cn } from '@/lib/utils';

export type MediaSelectionHandle = {
	updateList: (
		_untilId?: string | null,
		_onSuccess?: (_jobs: LibraryJob[]) => void
	) => Promise<LibraryJob[]>;
};

function areJobListsEquivalent(a: LibraryJob[], b: LibraryJob[]) {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i].Id !== b[i].Id || a[i].JobModTime !== b[i].JobModTime) {
			return false;
		}
	}
	return true;
}

export const MediaSelection = forwardRef<
	MediaSelectionHandle,
	{
		data: { jobs: Job[]; job?: Job | undefined };
		bounceToOverride?: ((_id: string) => void) | null;
		staticBaseUrl: string;
		backendBaseUrl: string;
	}
>(function MediaSelection({ data, bounceToOverride = null, staticBaseUrl, backendBaseUrl }, ref) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const searchParamsString = searchParams.toString();
	const [jobs, setJobs] = useState<LibraryJob[]>(data.jobs);
	const jobsRef = useRef<LibraryJob[]>(data.jobs);
	const jobsLoadedRef = useRef(data.jobs.length > 1);
	const [titleSelectionOpen, setTitleSelectionOpen] = useState(false);
	const [seSelectionOpen, setSeSelectionOpen] = useState(false);
	const openEpisodeSelectionAfterTitleCloseRef = useRef(false);
	const [refreshing, setRefreshing] = useState(false);
	const [selectedTitleId, setSelectedTitleId] = useState<string | undefined>(
		data.job?.Title?.titleId
	);
	const [selectedSe, setSelectedSe] = useState<string | undefined>(data.job?.Title?.episode?.se);

	useEffect(() => {
		jobsRef.current = jobs;
	}, [jobs]);

	useEffect(() => {
		setSelectedTitleId(data.job?.Title?.titleId);
		setSelectedSe(data.job?.Title?.episode?.se);
	}, [data.job]);

	useEffect(() => {
		if (titleSelectionOpen || !openEpisodeSelectionAfterTitleCloseRef.current) {
			return;
		}
		openEpisodeSelectionAfterTitleCloseRef.current = false;
		const timer = window.setTimeout(() => setSeSelectionOpen(true), 0);
		return () => window.clearTimeout(timer);
	}, [titleSelectionOpen, selectedTitleId]);

	const titles = useMemo(() => getTitleComponentsByJobs(jobs), [jobs]);
	const selected = selectedTitleId ? titles[selectedTitleId] : null;
	const selectedHasEpisodes = Boolean(selected?.episodes?.length);
	const selectedEpisodes = selected?.episodes ?? [];
	const selectedEpisode = selected?.episodes?.find((episode) => episode.se === selectedSe);
	const newJobs = useMemo(() => getNewJobs(jobs), [jobs]);
	const newJobIds = useMemo(() => new Set(newJobs.map((job) => job.Id)), [newJobs]);
	const newTitleIds = useMemo(() => new Set(newJobs.map((job) => job.Title.titleId)), [newJobs]);

	function getNewJobs(jobs: LibraryJob[]): LibraryJob[] {
		const last7 = jobs
			.slice()
			.sort((a, b) => (a.JobModTime > b.JobModTime ? -1 : 1))
			.slice(0, 7);
		const last3Days = jobs.filter((job) => {
			const diff = Date.now() - job.JobModTime * 1000;
			return diff < 1000 * 60 * 60 * 24 * 7;
		});
		const results: Record<string, LibraryJob> = {};
		for (const next of last3Days) {
			results[next.Id] = next;
		}
		for (const next of last7) {
			results[next.Id] = next;
		}
		return Object.values(results);
	}

	function bounceTo(id: string) {
		if (bounceToOverride) {
			bounceToOverride(id);
		} else {
			const params = new URLSearchParams(searchParamsString);
			params.set('mediaId', id);
			router.push(`/?${params.toString()}`);
		}
	}

	const updateList = useCallback(
		(untilId: string | null = null, onSuccess: (_jobs: LibraryJob[]) => void = () => {}) => {
			const currentJobs = jobsRef.current;
			if (untilId !== null && currentJobs.find((candidate) => candidate.Id === untilId)) {
				onSuccess(currentJobs);
				return Promise.resolve(currentJobs);
			}
			return fetchJobs(backendBaseUrl, true)
				.then((nextJobs) => {
					jobsLoadedRef.current = true;
					setJobs((current) => {
						const next = areJobListsEquivalent(current, nextJobs) ? current : nextJobs;
						jobsRef.current = next;
						return next;
					});
					onSuccess(nextJobs);
					return nextJobs;
				})
				.catch((error) => {
					console.warn('Unable to refresh media list', error);
					return currentJobs;
				});
		},
		[backendBaseUrl]
	);

	useImperativeHandle(ref, () => ({ updateList }), [updateList]);

	const refreshList = useCallback(() => {
		setRefreshing(true);
		updateList().finally(() => setRefreshing(false));
	}, [updateList]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			if (jobsLoadedRef.current) {
				updateList();
			}
		}, 60000);
		return () => window.clearInterval(timer);
	}, [updateList]);

	useEffect(() => {
		if ((!titleSelectionOpen && !seSelectionOpen) || jobsLoadedRef.current) {
			return;
		}
		updateList();
	}, [seSelectionOpen, titleSelectionOpen, updateList]);

	return (
		<div className="flex w-full flex-col items-center justify-center gap-2 md:flex-row">
			<div className="flex w-full min-w-0 items-center gap-2 md:flex-1">
				<Popover.Root open={titleSelectionOpen} onOpenChange={setTitleSelectionOpen}>
					<Popover.Trigger asChild>
						<Button
							variant="outline"
							role="combobox"
							aria-expanded={titleSelectionOpen}
							className="min-w-0 flex-1 justify-between font-semibold"
						>
							<span className="max-w-[calc(100%-2rem)] overflow-hidden text-ellipsis">
								{selected?.title || 'Select media'}
							</span>
							<IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
						</Button>
					</Popover.Trigger>
					<Popover.Content align="start" className="w-auto p-0">
						<Command.Root>
							<Command.Input placeholder="Search title..." className="h-9" />
							<Command.Empty>No title found.</Command.Empty>
							<Command.Group className="max-h-[37vh] overflow-y-auto">
								{Object.values(titles).map((title) => (
									<Command.Item
										key={title.titleId}
										className={`p-1 ${selectedTitleId === title.titleId ? 'font-bold' : ''}`}
										value={title.title}
										onSelect={() => {
											setSelectedTitleId(title.titleId);
											setSelectedSe(undefined);
											if (!title.episodes?.length) {
												setTitleSelectionOpen(false);
												bounceTo(title.id);
											} else {
												openEpisodeSelectionAfterTitleCloseRef.current = true;
												setTitleSelectionOpen(false);
											}
										}}
									>
										<TitlePoster
											title={title.rep ? title.rep : title.episodes ? title.episodes[0] : title}
											staticBaseUrl={staticBaseUrl}
											isNew={newTitleIds.has(title.titleId)}
										/>
										<span className="mr-4">{title.title}</span>
										<IconCheck
											size={18}
											stroke={2}
											className={`ml-auto right-0 ${selectedTitleId === title.titleId ? '' : 'text-transparent'}`}
										/>
									</Command.Item>
								))}
							</Command.Group>
						</Command.Root>
					</Popover.Content>
				</Popover.Root>

				<Tooltip.Provider delayDuration={0}>
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<Button
								type="button"
								variant="outline"
								size="icon"
								aria-label="Refresh media list"
								disabled={refreshing}
								onClick={refreshList}
								className="shrink-0"
							>
								<IconRefresh className={cn(refreshing && 'animate-spin')} size={18} stroke={2} />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<p>{refreshing ? 'Refreshing media list' : 'Refresh media list'}</p>
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			</div>

			{selectedHasEpisodes ? (
				<>
					<IconChevronRight className="max-md:hidden" size={20} stroke={2} />

					<Popover.Root open={seSelectionOpen} onOpenChange={setSeSelectionOpen}>
						<Popover.Trigger asChild>
							<Button
								variant="outline"
								role="combobox"
								aria-expanded={seSelectionOpen}
								className={`min-w-0 justify-between font-semibold max-md:w-full md:flex-1 ${!selectedSe ? 'font-bold text-red-600' : ''}`}
							>
								<span className="max-w-[calc(100%-2rem)] overflow-hidden text-ellipsis">
									{selectedEpisode ? `${selectedSe} - ${selectedEpisode.title}` : 'Select episode'}
								</span>
								<IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
							</Button>
						</Popover.Trigger>
						<Popover.Content align="start" className="w-auto p-0">
							<Command.Root>
								<Command.Input placeholder="Search episode..." className="h-9" />
								<Command.Empty>No episode found.</Command.Empty>
								<Command.Group className="max-h-[37vh] overflow-y-auto">
									{selectedEpisodes.map((episode) => (
										<Command.Item
											key={episode.id}
											className={`p-1 ${selectedSe === episode.se ? 'font-bold' : ''}`}
											value={`${episode.se}-${episode.title}`}
											onSelect={() => {
												setSeSelectionOpen(false);
												bounceTo(episode.id);
												setSelectedSe(episode.se);
											}}
										>
											<TitlePoster
												title={episode}
												staticBaseUrl={staticBaseUrl}
												isNew={newJobIds.has(episode.id)}
											/>
											<span className="mr-4">
												{episode.se} - {episode.title}
											</span>
											<IconCheck
												size={18}
												stroke={2}
												className={`ml-auto right-0 ${selectedSe === episode.se ? '' : 'text-transparent'}`}
											/>
										</Command.Item>
									))}
								</Command.Group>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
				</>
			) : null}
		</div>
	);
});
