<script lang="ts">
	import { onMount } from 'svelte';

	let vidstack: any;

	export let data : any;

	onMount(async () => {
		vidstack = (await import('$lib/player/Player.svelte')).default;
	});

	$: title = "Watch anime with Hmph! - " + data.title;
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="theme-color" content="#EC275F">
	<meta property="og:title" content={title}>
	<meta property="og:image" content={data.preview}>
	<meta property="og:video" content={data.video}>
	<meta property="og:video:url" content={data.video}>
	<meta property="og:video:width" content={data.job?.width}>
	<meta property="og:video:height" content={data.job?.height}>
	<meta property="og:video:type" content="video/mp4" />
	<meta property="og:image:type" content="image/jpeg">
	<meta property="og:description" content={data.plot}>
	<meta name="description" content={data.plot} />
</svelte:head>
<svelte:component this={vidstack}
									data={data} />
