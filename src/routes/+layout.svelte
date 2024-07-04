<script lang="ts">
	import { page } from '$app/stores';
	import './styles.css';
	import { isExpired, pageReloadCounterStore } from '../store';
	import { onDestroy, onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { DiscordSDK } from '@discord/embedded-app-sdk';
	import { PUBLIC_DISCORD_CLIENT_ID } from '$env/static/public';

	let pageReloadCounter: number;
	const pageReloadCounterUnsubscribe = pageReloadCounterStore.subscribe((value) => pageReloadCounter = value);

	let auth : any = null;
	onDestroy(() => {
		pageReloadCounterUnsubscribe();
	});

	async function setupDiscordSdk() {
		const discordSdk = new DiscordSDK(PUBLIC_DISCORD_CLIENT_ID);
		await discordSdk.ready();
		console.log('Discord SDK is ready');
		const { code } = await discordSdk.commands.authorize({
			client_id: PUBLIC_DISCORD_CLIENT_ID,
			response_type: 'code',
			state: '',
			prompt: 'none',
			scope: [
				'identify'
			]
		});
		const response = await fetch('/api/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				code
			})
		});
		const { access_token } = await response.json();
		auth = await discordSdk.commands.authenticate({
			access_token
		});
		sessionStorage.setItem('discord', JSON.stringify(auth));
	}

	onMount(async () => {
		if (sessionStorage.getItem('discord')) {
			auth = JSON.parse(sessionStorage.getItem('discord')!);
		}
		if ($page.url.searchParams.has("frame_id") &&
			(auth === null || isExpired(auth.expires))) {
			console.log("Initializing Discord SDK")
			await setupDiscordSdk();
		}
	});
</script>

<ModeWatcher defaultMode={"dark"} />
{#key `${$page.url.pathname}${pageReloadCounter}`}
	<!--frame_id-->
	<h1>{JSON.stringify(auth)}</h1>
	<h1>test6</h1>
	<Toaster position="top-center" richColors />
	<slot />
{/key}
