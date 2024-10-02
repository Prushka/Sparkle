<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { PUBLIC_BE } from '$env/static/public';
	import CaretSort from 'svelte-radix/CaretSort.svelte';
	import { IconCheck, IconChevronRight } from '@tabler/icons-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import {
		getTitleComponentsByJobs,
		type Job,
		preprocessJobs
	} from '$lib/player/t';
	import { goto } from '$app/navigation';
	import TitlePoster from '$lib/player/TitlePoster.svelte';
	import { page } from '$app/stores';

	export let data: { jobs: Job[], job: Job | undefined };
	let { jobs, job } = data;

	export let bounceToOverride: ((_id: string) => void) | null = null;
	let titleSelectionOpen = false;
	let seSelectionOpen = false;
	let selectedTitleId: string | undefined = job?.Title?.titleId;
	let selectedSe: string | undefined = job?.Title?.episode?.se;
	$: titles = getTitleComponentsByJobs(jobs);
	$: selected = selectedTitleId ? titles[selectedTitleId] : null;
	$: selectedEpisode = selected?.episodes?.find((ep) => ep.se === selectedSe);
	$: newJobs = getNewJobs(jobs);

	function getNewJobs(jobs: Job[]): Job[] {
		const last6 = jobs.sort((a, b) => {
			return a.JobModTime > b.JobModTime ? -1 : 1;
		}).slice(0, 7);
		const last3Days = jobs.filter((job) => {
			const diff = Date.now() - job.JobModTime * 1000;
			return diff < 1000 * 60 * 60 * 24 * 7;
		});
		const results: { [key: string]: Job } = {};
		for (const job of last3Days) {
			results[job.Id] = job;
		}
		for (const job of last6) {
			results[job.Id] = job;
		}
		return Object.values(results);
	}

	function bounceTo(id: string) {
		if (bounceToOverride) {
			bounceToOverride(id);
		} else {
			goto(`/${id}`);
		}
	}

	export function updateList(untilId: string | null = null, onSuccess =
		(_1: Job[]) => {
		}) {
		if (untilId !== null && jobs.find((job) => job.Id === untilId)) {
			onSuccess(jobs);
			return;
		}
		fetch(`${PUBLIC_BE}/all`)
			.then(response => response.json())
			.then(data => {
				if (data?.length > 0) {
					jobs = preprocessJobs(data);
					console.log('updated jobs', jobs);
					onSuccess(jobs);
				}
			});
	}

	onMount(() => {
		const ii = setInterval(() => {
			updateList();
		}, 60000);
		// const i = setInterval(async () => {
		// 	const room = $page.url.searchParams.get('room') || $page.url.searchParams.get('channel_id');
		// 	if (room) {
		// 		const response = await fetch(`/api/cm?room=${room}`, {
		// 			method: 'GET',
		// 			headers: {
		// 				'Content-Type': 'application/json'
		// 			}
		// 		});
		// 		const res = await response.json();
		// 		if (res?.jobId && (!job || job.Id !== res.jobId)) {
		// 			await goto(`/${res.jobId}?room=${room}`);
		// 		}
		// 	}
		// }, 4000);
		return () => {
			// clearInterval(i);
			clearInterval(ii);
		};
	});
</script>
<div
	class="md:grid md:grid-cols-[minmax(0,1fr)_min-content_minmax(0,1fr)] max-md:flex gap-2 items-center justify-center max-md:flex-col w-full">
	<Popover.Root bind:open={titleSelectionOpen}>
		<Popover.Trigger asChild let:builder>
			<Button
				builders={[builder]}
				variant="outline"
				role="combobox"
				aria-expanded={titleSelectionOpen}
				class="max-md:w-full justify-between font-semibold {!selected?.episodes ? 'col-span-3' : ''}">
			<span class="max-w-[calc(100%-2rem)] text-ellipsis overflow-hidden">
				{selected?.title || "Select media"}
			</span>
				<CaretSort class="ml-2 h-4 w-4 shrink-0 opacity-50" />
			</Button>
		</Popover.Trigger>
		<Popover.Content align="start" class="p-0 w-auto">
			<Command.Root>
				<Command.Input placeholder="Search title..." class="h-9" />
				<Command.Empty>No title found.</Command.Empty>
				<Command.Group class="overflow-y-auto max-h-[37vh]">
					{#each Object.values(titles) as title}
						<Command.Item class="p-1 {selectedTitleId === title.titleId ? 'font-bold' : ''}" value={title.title}
													onSelect={()=>{
											titleSelectionOpen = false;
									selectedTitleId = title.titleId;
									selectedSe = undefined;
									if(!title.episodes) {
										bounceTo(title.id)
									}else{
										tick().then(() => {
    							  seSelectionOpen = true;
    								});
									}
						}}>
							<TitlePoster title={title.rep ? title.rep :
							title.episodes ? title.episodes[0] : title
							} isNew={
							newJobs.find((job) => job.Title.titleId === title.titleId) !== undefined
							}/>
							<span class="mr-4">{title.title}</span>
							<IconCheck size={18} stroke={2}
												 class='ml-auto right-0 {selectedTitleId === title.titleId ? "" : "text-transparent"}'
							/>
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
	{#if selected?.episodes}
		<IconChevronRight
			class="max-md:hidden"
			size={20} stroke={2} />

		<Popover.Root bind:open={seSelectionOpen}>
			<Popover.Trigger asChild let:builder>
				<Button
					builders={[builder]}
					variant="outline"
					role="combobox"
					aria-expanded={titleSelectionOpen}
					class="max-md:w-full justify-between font-semibold {!selectedSe ? 'text-red-600 font-bold' : ''}"
				>
										<span class="max-w-[calc(100%-2rem)] text-ellipsis overflow-hidden">{selectedEpisode ?
											`${selectedSe} - ${selectedEpisode.title}` : "Select episode"}</span>
					<CaretSort class="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</Popover.Trigger>
			<Popover.Content align="start" class="p-0 w-auto">
				<Command.Root>
					<Command.Input placeholder="Search episode..." class="h-9" />
					<Command.Empty>No episode found.</Command.Empty>
					<Command.Group class="overflow-y-auto max-h-[37vh]">
						{#each selected.episodes as es}
							<Command.Item class="p-1 {selectedSe === es.se ? 'font-bold' : ''}" value={es.se + "-" + es.title}
														onSelect={()=>{
									seSelectionOpen = false;
									bounceTo(es.id)
									selectedSe = es.se;
						}}>
									<TitlePoster title={es} isNew={newJobs.find((job) => job.Id === es.id) !== undefined} />
								<span class="mr-4">{es.se} - {es.title}</span>
								<IconCheck size={18} stroke={2}
													 class='ml-auto right-0 {selectedSe === es.se ? "" : "text-transparent"}'
								/>
							</Command.Item>
						{/each}
					</Command.Group>
				</Command.Root>
			</Popover.Content>
		</Popover.Root>
	{/if}
</div>
