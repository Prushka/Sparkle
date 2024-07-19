<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button';
	import TitlePoster from '$lib/player/TitlePoster.svelte';
	import { type Job, type Player } from '$lib/player/t';
	import { goto } from '$app/navigation';
	import Pfp from '$lib/player/Pfp.svelte';
	export let historicalPlayers: { [key: string]: Player };
	export let seconds:number;
	export let firedBy: Player;
	export let job: Job | undefined;
	let closed = false;

	onMount(() => {
		const interval = setInterval(() => {
			seconds--;
			if (seconds === 0) {
				clearInterval(interval);
				if(job?.Id){
					goto(`/${job?.Id}`)
				}
			}
		}, 1000);
		return () => clearInterval(interval);
	});
</script>


{#if !closed}
	<Card.Root class="w-full">
		<Card.Header>
			<Card.Title class="flex items-center">
				{#if firedBy?.id}
					<Pfp id={firedBy?.id} class="avatar mr-2"
							 discordUser={historicalPlayers[firedBy?.id]?.discordUser}/>
				{/if}
				{#if seconds > 0}
				<span>Moving in {seconds} second{seconds > 1 ? "s" : ""}</span>
			{:else}
				<span>Moving...</span>
			{/if}
			</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex gap-1 items-center w-full text-sm font-normal">
				{#if job?.Title}
					<TitlePoster title={job.Title}/>
				{/if}
				To: {job?.Input}</div>
		</Card.Content>
		<Card.Footer class="flex justify-between">
			<Button variant="outline">
				By: {firedBy?.name}
				</Button>
			<Button variant="default"
			on:click={() => closed = true}
			>Close</Button>
		</Card.Footer>
	</Card.Root>
{/if}
