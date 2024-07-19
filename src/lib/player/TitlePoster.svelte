<script lang="ts">
	import { PUBLIC_STATIC } from '$env/static/public';
	import type { Title, TitleEpisode } from '$lib/player/t';
	import New from '$lib/player/New.svelte';

	export let title:Title | TitleEpisode;
	export let isNew : boolean | undefined = false;
</script>
<div class="relative overflow-hidden shrink-0">
<img src="{PUBLIC_STATIC}/{title.id}/poster.jpg"
		 alt="{title.title}" class="h-8 w-12 object-cover mr-2 rounded-sm" />
{#if isNew}
	<New/>
{/if}
</div>
