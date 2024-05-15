<script lang="ts">
	import { PUBLIC_HOST } from '$env/static/public';
	import { pfpLastFetched } from '../../store';
	import { onDestroy, onMount } from 'svelte';

	let pfpLast: any = {};
	let pageLoaded = 0;
	export let id: string;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);
	onMount(() => {
		pageLoaded = Date.now();
	});
</script>


<img
	src={(pfpLast[id] === undefined) ? `${PUBLIC_HOST}/static/pfp/${id}.png?${pageLoaded}` : pfpLast[id]}
		 on:error={() => {
			 $pfpLastFetched = { ...pfpLast, [id]: '/icons/uwu.gif' }
						 }}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
