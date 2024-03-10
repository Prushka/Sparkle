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
<dialog id="warning_modal" class="modal">
	<div class="modal-box">
		<h3 class="font-bold text-lg">Image is too large</h3>
		<p class="py-4">Size limit: 10 MB</p>
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">Close</button>
			</form>
		</div>
	</div>
</dialog>
