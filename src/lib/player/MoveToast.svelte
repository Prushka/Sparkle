<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button';
	import TitlePoster from '$lib/player/TitlePoster.svelte';
	import { getTitleComponents, type Job } from '$lib/player/t';

	export let seconds:number;
	export let action: () => void;
	export let by: string;
	export let job: Job | undefined;
	let closed = false;
	$: title = job ? getTitleComponents(job) : null;

	onMount(() => {
		const interval = setInterval(() => {
			seconds--;
			if (seconds === 0) {
				clearInterval(interval);
				action();
			}
		}, 1000);
		return () => clearInterval(interval);
	});
</script>


{#if !closed}
	<Card.Root>
		<Card.Header>
			<Card.Title>{#if seconds > 0}
				<span>Moving in {seconds} second{seconds > 1 ? "s" : ""}</span>
			{:else}
				<span>Moving...</span>
			{/if}</Card.Title>
		</Card.Header>
		<Card.Content>
			<Card.Description class="flex gap-1 justify-center items-center w-full">
				{#if title}
					<TitlePoster title={title}/>
				{/if}
				To: {job?.Input}</Card.Description>
		</Card.Content>
		<Card.Footer class="flex justify-between">
			<Button variant="outline">{by}</Button>
			<Button variant="default"
			on:click={() => closed = true}
			>Close</Button>
		</Card.Footer>
	</Card.Root>
{/if}
