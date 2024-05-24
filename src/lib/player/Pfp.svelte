<script lang="ts">
	import { pfpLastFetched } from '../../store';
	import { onDestroy } from 'svelte';
	import { PUBLIC_STATIC } from '$env/static/public';

	let pfpLast: any = {};
	export let id: string;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);
</script>


<img
	src={(pfpLast[id] === undefined) ? `${PUBLIC_STATIC}/pfp/${id}.png?${Date.now()}` : pfpLast[id]}
		 on:error={() => {
			 $pfpLastFetched = { ...pfpLast, [id]: '/icons/uwu.gif' }
						 }}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
