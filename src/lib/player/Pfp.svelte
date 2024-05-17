<script lang="ts">
	import { PUBLIC_HOST } from '$env/static/public';
	import { pfpLastFetched } from '../../store';
	import { onDestroy } from 'svelte';

	let pfpLast: any = {};
	export let id: string;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);
</script>


<img
	src={(pfpLast[id] === undefined) ? `${PUBLIC_HOST}/static/pfp/${id}.png?${Date.now()}` : pfpLast[id]}
		 on:error={() => {
			 $pfpLastFetched = { ...pfpLast, [id]: '/icons/uwu.gif' }
						 }}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
