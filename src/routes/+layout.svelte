
<script lang="ts">
	import { page } from '$app/stores';
	import './styles.css';
	import { pageReloadCounterStore } from '../store';
	import { onDestroy } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	let pageReloadCounter: number;
	const pageReloadCounterUnsubscribe = pageReloadCounterStore.subscribe((value) => pageReloadCounter = value);
	onDestroy(() => {
		pageReloadCounterUnsubscribe();
	});
</script>

{#key `${$page.url.pathname}${pageReloadCounter}`}
	<Toaster />
	<ModeWatcher defaultMode={"dark"} />
	<slot/>
{/key}
