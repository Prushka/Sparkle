<script lang="ts">
	import { smilies } from '$lib/player/emoji';
	import { browser } from '$app/environment';
</script>

{#if browser}
	<div class="flex flex-wrap gap-1">
		{#each smilies as emoji}
			<img src={emoji.download_url} alt={emoji.name.slice(-3)} width="20" height="20" />
		{/each}
	</div>
{/if}
