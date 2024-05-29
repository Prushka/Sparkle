<script lang="ts">
	import { pfpLastFetched } from '../../store';
	import { onDestroy } from 'svelte';
	import { PUBLIC_STATIC } from '$env/static/public';

	let pfpLast: any = {};
	export let id: string;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);


	function testPfp(id : string) {
		const img = new Image();
		const now = Date.now();
		img.onload = () => {
			$pfpLastFetched = {
				...pfpLastFetched,
				[id]: {
					success: true,
					tried: true,
					lastSuccess: now,
				}
			};
		};
		img.onerror = () => {
			$pfpLastFetched = {
				...pfpLastFetched,
				[id]: {
					success: false,
					tried: true,
					lastSuccess: now,
				}
			};
		};
		img.src = `${PUBLIC_STATIC}/pfp/${id}.png?${now}`
	}

	$: {
		if(!pfpLast[id]?.tried) {
			console.log('Retrying pfp fetch')
			testPfp(id);
		}
	}

</script>


<img
	src={pfpLast[id]?.success ? `${PUBLIC_STATIC}/pfp/${id}.png?${pfpLast[id]?.lastSuccess}`:`/icons/uwu.gif`}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
