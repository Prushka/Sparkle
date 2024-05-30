<script lang="ts">
	import MediaSelection from '$lib/player/MediaSelection.svelte';
	export let data: any;
</script>

<main class="w-full h-screen p-10 flex items-center justify-center">

<MediaSelection data={data}/>

</main>
