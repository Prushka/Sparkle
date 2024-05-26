
<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { defaultTheme } from '$lib/player/t';
	import { page } from '$app/stores';
	import './styles.css';
	import { pageReloadCounterStore } from '../store';
	import { onDestroy } from 'svelte';
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


{#key `${$page.url.pathname}${pageReloadCounter}`}
	<slot/>
{/key}
