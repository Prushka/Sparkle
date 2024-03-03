<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import './styles.css'
</script>
{#await import('$lib/player/Player.svelte') then {default: Player}}
	<svelte:component this={Player} />
{/await}
