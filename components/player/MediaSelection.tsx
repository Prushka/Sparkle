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
import { IconCheck, IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Popover from '@/components/ui/popover';
import * as Command from '@/components/ui/command';
import { TitlePoster } from '@/components/player/TitlePoster';
import { getTitleComponentsByJobs, type Job, preprocessJobs } from '@/lib/player/t';

export type MediaSelectionHandle = {
	updateList: (_untilId?: string | null, _onSuccess?: (_jobs: Job[]) => void) => void;
};

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
	const [jobs, setJobs] = useState<Job[]>(data.jobs);
	const [titleSelectionOpen, setTitleSelectionOpen] = useState(false);
	const [seSelectionOpen, setSeSelectionOpen] = useState(false);
	const openEpisodeSelectionAfterTitleCloseRef = useRef(false);
	const [selectedTitleId, setSelectedTitleId] = useState<string | undefined>(
		data.job?.Title?.titleId
	);
	const [selectedSe, setSelectedSe] = useState<string | undefined>(data.job?.Title?.episode?.se);

	useEffect(() => {
		setJobs(data.jobs);
	}, [data.jobs]);

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

	function getNewJobs(jobs: Job[]): Job[] {
		const last7 = jobs
			.slice()
			.sort((a, b) => (a.JobModTime > b.JobModTime ? -1 : 1))
			.slice(0, 7);
		const last3Days = jobs.filter((job) => {
			const diff = Date.now() - job.JobModTime * 1000;
			return diff < 1000 * 60 * 60 * 24 * 7;
		});
		const results: Record<string, Job> = {};
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
			router.push(searchParamsString ? `/${id}?${searchParamsString}` : `/${id}`);
		}
	}

	const updateList = useCallback(
		(untilId: string | null = null, onSuccess: (_jobs: Job[]) => void = () => {}) => {
			if (untilId !== null && jobs.find((candidate) => candidate.Id === untilId)) {
				onSuccess(jobs);
				return;
			}
			fetch(`${backendBaseUrl}/all`)
				.then((response) => response.json())
				.then((payload) => {
					if (payload?.length > 0) {
						const nextJobs = preprocessJobs(payload);
						setJobs(nextJobs);
						onSuccess(nextJobs);
					}
				});
		},
		[backendBaseUrl, jobs]
	);

	useImperativeHandle(ref, () => ({ updateList }), [updateList]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			updateList();
		}, 60000);
		return () => window.clearInterval(timer);
	}, [updateList]);

	return (
		<div className="md:grid md:grid-cols-[minmax(0,1fr)_min-content_minmax(0,1fr)] max-md:flex max-md:flex-col items-center justify-center gap-2 w-full">
			<Popover.Root open={titleSelectionOpen} onOpenChange={setTitleSelectionOpen}>
				<Popover.Trigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={titleSelectionOpen}
						className={`max-md:w-full justify-between font-semibold ${!selectedHasEpisodes ? 'col-span-3' : ''}`}
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
										isNew={
											newJobs.find((candidate) => candidate.Title.titleId === title.titleId) !==
											undefined
										}
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

			{selectedHasEpisodes ? (
				<>
					<IconChevronRight className="max-md:hidden" size={20} stroke={2} />

					<Popover.Root open={seSelectionOpen} onOpenChange={setSeSelectionOpen}>
						<Popover.Trigger asChild>
							<Button
								variant="outline"
								role="combobox"
								aria-expanded={seSelectionOpen}
								className={`max-md:w-full justify-between font-semibold ${!selectedSe ? 'font-bold text-red-600' : ''}`}
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
												isNew={
													newJobs.find((candidate) => candidate.Id === episode.id) !== undefined
												}
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
