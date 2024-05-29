<script lang="ts">
	import { pfpLastFetched, testPfp } from '../../store';
	import { onDestroy, onMount } from 'svelte';
	import { PUBLIC_STATIC } from '$env/static/public';

	let pfpLast: any = {};
	export let id: string;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);

	onMount(() => {
		if (!pfpLast[id]?.success) {
			testPfp(id);
		}
	});

</script>


<img
	src={pfpLast[id]?.success ? `${PUBLIC_STATIC}/pfp/${id}.png?${pfpLast[id]?.lastSuccess}`:`/icons/uwu.gif`}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
