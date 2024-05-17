<script lang="ts">
	import { onMount } from 'svelte';

	let vidstack: any;

	onMount(async () => {
		vidstack = (await import('$lib/player/Player.svelte')).default;
	});
</script>

<svelte:component this={vidstack} />
