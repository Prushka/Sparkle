<script lang="ts">
	import { page } from '$app/stores';
	import './fonts.css';
	import './styles.css';
	import { currentlyWatching, pageReloadCounterStore } from '../store';
	import { onDestroy, onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { DiscordSDK } from '@discord/embedded-app-sdk';
	import { PUBLIC_DISCORD_CLIENT_ID } from '$env/static/public';
	import { formatSeconds } from '$lib/player/t';
	import { beforeNavigate, goto } from '$app/navigation';

	let pageReloadCounter: number;
	let discordSdk: undefined | null | DiscordSDK;
	let discordAuthenticated = false;

	const pageReloadCounterUnsubscribe = pageReloadCounterStore.subscribe((value) => pageReloadCounter = value);
	const currentlyWatchingUnsubscribe = currentlyWatching.subscribe((value) => {
		if (discordSdk && value && discordAuthenticated) {
			const remaining = `(${formatSeconds(value.totalDuration - value.duration)} Remaining)`;
			discordSdk.commands.setActivity({
				activity: {
					details: `${value.title}`,
					state: value.se ? `${value.seTitle}` : `${formatSeconds(value.duration)}`,
					type: 3,
					timestamps: {
						start: value.timeEntered,
						end: Date.now() + (value.totalDuration - value.duration) * 1000
					},
					party: {
						size: [value.roomPlayers, 99],
					},
					instance: true,
					assets: {
						large_image: `https://${location.host}${value.thumbnail}`,
						large_text: value.se ? `${value.se}: ${formatSeconds(value.duration)}` : 'It\'s a movie!',
						small_image: value.paused ? `https://${location.host}/icons/coffee.png` :
							`https://${location.host}/icons/broom.png`,
						small_text: value.paused ? `Paused ${remaining}` : `Playing ${remaining}`
					},
				}
			}).then(() => {
				console.debug('Activity set', value);
			}).catch((error: any) => {
				console.error('Error setting activity', error, value);
			});
		}
	});
	let auth: any = null;
	onDestroy(() => {
		pageReloadCounterUnsubscribe();
		currentlyWatchingUnsubscribe();
	});

	async function setupDiscordSdk() {
		discordSdk = new DiscordSDK(PUBLIC_DISCORD_CLIENT_ID);
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
		const prevAuth = auth;
		auth = await discordSdk.commands.authenticate({
			access_token
		});
		if (auth) {
			auth.channelId = discordSdk.channelId;
			sessionStorage.setItem('discord', JSON.stringify(auth));
			if (!prevAuth) {
				$pageReloadCounterStore++;
			}
			discordAuthenticated = true;
			await discordSdk.commands.setConfig({
				use_interactive_pip: true
			});
		}
	}

	beforeNavigate(({ to, cancel }) => {
		if (auth?.channelId && to && !to.url.searchParams.has('channel_id')) {
			cancel();
			goto(to.url.pathname + `?channel_id=${auth.channelId}`);
		}
	});

	onMount(async () => {
		if (sessionStorage.getItem('discord')) {
			auth = JSON.parse(sessionStorage.getItem('discord')!);
		}
		if ($page.url.searchParams.has('frame_id') || auth) {
			console.log('Initializing Discord SDK');
			await setupDiscordSdk();
		}
	});

	onMount(() => {
		const i = setInterval(async () => {
			if(auth?.channelId) {
				const response = await fetch(`/api/cm?channel_id=${auth.channelId}`, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json'
					},
				});
				const res = await response.json();
				if(res?.jobId && (!$currentlyWatching?.id || $currentlyWatching?.id !== res.jobId)) {
					await goto(`/${res.jobId}`)
				}
			}
		}, 3000);
		return () => {
			clearInterval(i);
		}});
</script>

<ModeWatcher defaultMode={"dark"} />
{#key `${$page.url.pathname}${pageReloadCounter}`}
	<Toaster position="top-center" richColors />
	<slot />
{/key}
