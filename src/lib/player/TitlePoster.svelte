<script lang="ts">
	import { PUBLIC_STATIC } from '$env/static/public';
	import type { TitleComponents } from '$lib/player/t';

	export let title:TitleComponents;
</script>

<img src="{PUBLIC_STATIC}/{!title.episodes ? title.id : Object.values(title.episodes)[0].id}/poster.jpg"
		 alt="{title.title}" class="h-8 w-12 object-cover mr-2 rounded-sm" />
