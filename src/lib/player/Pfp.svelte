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


<img src={(pfpLast[id] === undefined) ? `${PUBLIC_HOST}/static/pfp/${id}.png?${pageLoaded}` : pfpLast[id]}
		 on:error={() => {
			 $pfpLastFetched = { ...pfpLast, [id]: '/icons/uwu.png' }
						 }}
		 alt="pfp" class="avatar rounded-full object-cover" />

<style>

    .avatar {
        width: 1.5rem;
        height: 1.5rem;
    }

    @media (max-width: 1000px) {
        .avatar {
            width: 1rem;
            height: 1rem;
        }
    }
</style>
