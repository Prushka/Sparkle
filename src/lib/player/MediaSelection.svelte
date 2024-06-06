<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { PUBLIC_BE, PUBLIC_STATIC } from '$env/static/public';
	import CaretSort from 'svelte-radix/CaretSort.svelte';
	import { IconCheck, IconChevronRight } from '@tabler/icons-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import {
		getTitleComponents,
		getTitleComponentsByJobs,
		type Job,
		preprocessJobs, type ServerData
	} from '$lib/player/t';
	import { goto } from '$app/navigation';
	import TitlePoster from '$lib/player/TitlePoster.svelte';

	export let data: ServerData;
	let { jobs, job } = data;

	export let bounceToOverride: ((_id: string) => void) | null = null;
	let selectedTitleId: string | null = job ? getTitleComponents(job).titleId : null;
	let selectedSe: string | null = job && getTitleComponents(job).episodes ? Object.keys(getTitleComponents(job).episodes!)[0] : null;
	let titleSelectionOpen = false;
	let seSelectionOpen = false;
	$: titles = getTitleComponentsByJobs(jobs);
	$: selectedTitle = selectedTitleId ? titles[selectedTitleId] : null;
	$: selectedEpisodes = selectedTitle?.episodes;
	$: selectedEpisode = (selectedTitle?.episodes && selectedSe) ? selectedTitle.episodes[selectedSe!] : null;

	function bounceTo(id: string) {
		if (bounceToOverride) {
			bounceToOverride(id);
		} else {
			goto(`/${id}`);
		}
	}

	export function updateList(onSuccess =
															 (_1: Job[]) => {
															 }) {
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
		return () => {
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
				class="max-md:w-full justify-between font-semibold {!selectedEpisodes?'col-span-3':''}">
			<span class="max-w-[calc(100%-2rem)] text-ellipsis overflow-hidden">
				{selectedTitle?.title ? selectedTitle?.title : "Select media"}
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
									selectedSe = null;
									if(!title.episodes) {
										bounceTo(title.id)
									}else{
										tick().then(() => {
    							  seSelectionOpen = true;
    								});
									}
						}}>
							<TitlePoster title={title} />
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
	{#if selectedEpisodes}
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
					class="max-md:w-full justify-between font-semibold {selectedEpisode ? '' : 'text-red-600 font-bold'}"
				>
										<span class="max-w-[calc(100%-2rem)] text-ellipsis overflow-hidden">{selectedEpisode ?
											`${selectedSe} - ${selectedEpisode.seTitle}` : "Select episode"}</span>
					<CaretSort class="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</Popover.Trigger>
			<Popover.Content align="start" class="p-0 w-auto">
				<Command.Root>
					<Command.Input placeholder="Search episode..." class="h-9" />
					<Command.Empty>No episode found.</Command.Empty>
					<Command.Group class="overflow-y-auto max-h-[37vh]">
						{#each Object.values(selectedEpisodes) as es}
							<Command.Item class="p-1 {selectedSe === es.se ? 'font-bold' : ''}" value={es.se + "-" + es.seTitle}
														onSelect={()=>{
									seSelectionOpen = false;
									bounceTo(es.id)
									selectedSe = es.se;
						}}><img src="{PUBLIC_STATIC}/{es.id}/poster.jpg" alt="{es.seTitle}"
										class="h-8 w-12 object-cover mr-2 rounded-sm" />
								<span class="mr-4">{es.se} - {es.seTitle}</span>
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
