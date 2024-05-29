
<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { defaultTheme } from '$lib/player/t';
	import { page } from '$app/stores';
	import './styles.css';
	import { pageReloadCounterStore } from '../store';
	import { onDestroy } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	let pageReloadCounter: number;
	const pageReloadCounterUnsubscribe = pageReloadCounterStore.subscribe((value) => pageReloadCounter = value);
	afterNavigate(() => {
		console.log('navigated');
		const theme = localStorage.getItem('theme');
		if (theme) {
			const html = document.querySelector('html');
			html?.setAttribute('data-theme', theme || defaultTheme);
		}
	});
	onDestroy(() => {
		pageReloadCounterUnsubscribe();
	});
</script>

<ModeWatcher defaultMode={"dark"} />
<Toaster />
{#key `${$page.url.pathname}${pageReloadCounter}`}

	<slot/>
{/key}
