<script lang="ts">
	import { pfpLastFetched } from '../../store';
	import { onDestroy } from 'svelte';
	import { PUBLIC_STATIC } from '$env/static/public';

	let pfpLast: any = {};
	export let id: string;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);


	function testPfp(id : string) {
		const now = Date.now();
		const prev = pfpLast[id];
		if (prev?.trying) return;
		console.log('Retrying pfp fetch')
		$pfpLastFetched = {
			...pfpLastFetched,
			[id]: {
				trying: true,
			}
		};
		const img = new Image();
		img.onload = () => {
			$pfpLastFetched = {
				...pfpLastFetched,
				[id]: {
					success: true,
					tried: true,
					lastSuccess: now,
					trying: false,
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
					trying: false,
				}
			};
		};
		img.src = `${PUBLIC_STATIC}/pfp/${id}.png?${now}`
	}

	$: {
		if(!pfpLast[id]?.tried) {
			testPfp(id);
		}
	}

</script>


<img
	src={pfpLast[id]?.success ? `${PUBLIC_STATIC}/pfp/${id}.png?${pfpLast[id]?.lastSuccess}`:`/icons/uwu.gif`}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
