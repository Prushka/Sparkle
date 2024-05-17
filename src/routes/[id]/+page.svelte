<script lang="ts">
	import { onMount } from 'svelte';

	let vidstack: any;

	export let data : any;

	onMount(async () => {
		vidstack = (await import('$lib/player/Player.svelte')).default;
	});
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta property="og:title" content={data?.job?.FileRawName || "UwU"}>
	<meta property="og:image" content={data.preview}>
	<meta property="og:video" content={data.video}>
	<meta property="og:image:type" content="image/jpeg">
</svelte:head>
<svelte:component this={vidstack} />
