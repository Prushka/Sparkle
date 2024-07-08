<script lang="ts">
	import MediaSelection from '$lib/player/MediaSelection.svelte';
	export let data: any;
</script>

<div class="p-10 gap-2 w-full flex items-center flex-col justify-center mt-20">

<MediaSelection data={data}/>

</div>
