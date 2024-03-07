<script lang="ts">
	// Import styles.
	import './styles.css';
	import { onMount } from 'svelte';

	let vidstack: any;
	onMount(async () => {
		// Load the Vidstack player.
		vidstack = (await import('$lib/player/Player.svelte')).default;
	});
</script>


<svelte:component this={vidstack} />
