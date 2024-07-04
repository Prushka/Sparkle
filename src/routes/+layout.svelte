<script lang="ts">
	import { page } from '$app/stores';
	import './styles.css';
	import { currentlyWatching, pageReloadCounterStore } from '../store';
	import { onDestroy, onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { DiscordSDK } from '@discord/embedded-app-sdk';
	import { PUBLIC_DISCORD_CLIENT_ID } from '$env/static/public';
	import { formatSeconds } from '$lib/player/t';

	let pageReloadCounter: number;
	let discordSdk : undefined | null | DiscordSDK;

	const pageReloadCounterUnsubscribe = pageReloadCounterStore.subscribe((value) => pageReloadCounter = value);
	const currentlyWatchingUnsubscribe = currentlyWatching.subscribe((value) => {
		if (discordSdk && value) {
			discordSdk.commands.setActivity({
				activity: {
					details: `${value.title}`,
					state: value.se ? `${value.seTitle}` : `${formatSeconds(value.duration)}`,
					type: 3,
					timestamps: {
						start: value.timeEntered,
						end: Date.now() + (value.totalDuration - value.duration)
					},
					party: {
						size: [value.roomPlayers, 99]
					},
					instance: true,
					assets: {
						large_image: `https://${location.host}${value.thumbnail}`,
						large_text: value.se ? `${value.se}: ${formatSeconds(value.duration)}` : "It's a movie!",
						small_image: value.paused ? `https://${location.host}/icons/pause.png` :
							`https://${location.host}/icons/play.png`,
						small_text: value.paused ? 'Paused' : 'Playing'
					}
				},
			}).then(() => {
				console.log('Activity set', value);
			}).catch((error : any) => {
				console.error('Error setting activity', error, value);
			});
		}
	});
	let auth : any = null;
	onDestroy(() => {
		pageReloadCounterUnsubscribe();
		currentlyWatchingUnsubscribe();
	});

	async function setupDiscordSdk() {
		discordSdk = new DiscordSDK(PUBLIC_DISCORD_CLIENT_ID)
		await discordSdk.ready();
		console.log('Discord SDK is ready');
		const { code } = await discordSdk.commands.authorize({
			client_id: PUBLIC_DISCORD_CLIENT_ID,
			response_type: 'code',
			state: '',
			prompt: 'none',
			scope: [
				'identify',
				'rpc.activities.write'
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
		if ($page.url.searchParams.has("frame_id") || auth) {
			console.log("Initializing Discord SDK")
			await setupDiscordSdk();
		}
	});
</script>

<ModeWatcher defaultMode={"dark"} />
{#key `${$page.url.pathname}${pageReloadCounter}`}
	<Toaster position="top-center" richColors />
	<slot />
{/key}
