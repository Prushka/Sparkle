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
	<meta property="og:title" content={data.title}>
	<meta property="og:image" content={data.preview}>
	<meta property="og:video" content={data.video}>
	<meta property="og:image:type" content="image/jpeg">
	<meta property="og:description" content={data.plot}>
	<meta name="description" content={data.plot} />
</svelte:head>
<svelte:component this={vidstack} />
