<script lang="ts">
	import MediaSelection from '$lib/player/MediaSelection.svelte';
	export let data: any;
</script>

<main class="w-full h-full p-10 flex items-center justify-center mt-24">

<MediaSelection data={data}/>

</main>
