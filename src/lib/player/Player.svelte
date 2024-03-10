<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		type TextTrackInit
	} from 'vidstack';
	import { formatSeconds, type Job, type Message, type PlayerState } from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { IconPlayerPause, IconPlayerPlay, IconPlugConnected, IconPlugConnectedX } from '@tabler/icons-svelte';

	let player: MediaPlayerElement;

	let socket: WebSocket;
	let name = '';
	let roomStates: PlayerState[] = [];
	let roomMessages: Message[] = [];
	let jobs: Job[] = [];
	let id: string = '';
	let textTracks: TextTrackInit[] = [];
	let lastTicked = 0;
	let videoSrc = '';
	let socketConnected = false;
	$: syncState = socketConnected && Math.ceil((Date.now() - lastTicked) / 1000) < 5000 ? 'SYNCED' : 'NOT SYNCED';

	function idChanges() {
		console.log('called');
		connect();

		for (const job of jobs) {
			if (job.Id === id) {
				for (const sub of job.Subtitles) {
					textTracks.push({
						src: `${PUBLIC_HOST}/static/${id}/${sub}`,
						label: sub,
						kind: 'subtitles',
						default: sub.includes('eng')
					});
				}
				break;
			}
		}
		for (const track of textTracks) player.textTracks.add(track);
		videoSrc = `${PUBLIC_HOST}/static/${id}/out.mp4`;
		$page.url.searchParams.set('id', id);
		goto($page.url);
	}

	$ : if (id !== '') {
		idChanges();
	}

	function connect() {
		if (socketConnected) {
			socket.close();
		}
		socket = new WebSocket(`${PUBLIC_WS}/sync/${id}`);
		socket.onopen = () => {
			console.log('Connected to sync server');
			socketConnected = true;
			if (name !== '') {
				send({ name: name });
			}
			send({ reason: 'new player' });
		};

		socket.onmessage = (event: MessageEvent) => {
			console.log('received: ' + event.data);
			const state = JSON.parse(event.data);
			if (player) {
				if (Array.isArray(state) && state.length > 0) {
					if(state[0].message){
						roomMessages = state;
					}else{
						roomStates = state;
						lastTicked = Date.now();
					}
				} else {
					if (state['paused'] === true && player.paused === false) {
						player.pause();
					} else if (state['paused'] === false && player.paused === true) {
						player.play();
					}
					if (state['time'] !== undefined) {
						player.currentTime = state['time'];
					}
				}
			}
		};

		socket.onerror = function() {
			console.error('Socket encountered error');
			socket.close();
		};

		socket.onclose = () => {
			console.log('Socket closed, reconnecting');
			setTimeout(function() {
				connect();
			}, 1000);
		};
	}

	function send(data: any) {
		if (player && socketConnected) {
			console.log('sending: ' + JSON.stringify(data));
			socket.send(JSON.stringify(data));
		}
	}

	onMount(() => {
			fetch(`${PUBLIC_HOST}/all`)
				.then(response => response.json())
				.then(data => {
					jobs = data;
					console.log(jobs);
					id = $page.url.searchParams.get('id') || '';
				});
			name = localStorage.getItem('name') || '';
			setInterval(() => {
				send({
					time: player?.currentTime
				});
				if (!document.getElementById('chat-input')) {
					console.log('mounting chat')
					for (const node of document.querySelectorAll('media-chapter-title')) {
						const input = document.createElement('input');
						input.id = 'chat-input';
						input.classList.add('input', "input-sm", "w-80", "input-sm", "mx-8", "text-black")
						input.placeholder = 'Chat';
						input.autocomplete = 'off';
						const form = document.createElement('form');
						form.appendChild(input);
						form.autocomplete = 'off';
						form.addEventListener('submit', (e) => {
							e.preventDefault();
							const message = input.value;
							input.value = '';
							send({ chat: message });
						});
						// add after the node
						node.parentNode?.insertBefore(form, node.nextSibling);
					}
				}
			}, 1000);
			return () => {
				socket.close();
			};
	});

</script>

<main id="main-page" class="flex flex-col items-center w-full h-full overflow-auto gap-3 pb-4">

	<media-player
		class="media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4"
		title="Sprite Fight"
		src={videoSrc}
		crossorigin
		bind:this={player}
		on:pause={
			() => {
				send({ paused: true });
			}}
		on:play={
			() => {
				send({ paused: false });
			}}
	>
		<media-provider>
			<media-poster
				class="absolute inset-0 block h-full w-full rounded-md opacity-0 transition-opacity data-[visible]:opacity-100 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
			/>
		</media-provider>

		<media-video-layout class="relative">
			<div class="flex gap-1 w-full h-full absolute">
				<div class="flex flex-col ml-auto mt-8 mr-8 drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]">
					{#each roomMessages as message}
					<!--	if message was sent within 3 min -->
						{#if (Date.now()/1000 - message.timestamp) < 180}
							<p class="text-right">
								{message.message}
								[{new Date(message.timestamp * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} @ {formatSeconds(message.mediaSec)}]: {message.username}
							</p>
						{/if}
					{/each}
				</div>
			</div>
		</media-video-layout>

	</media-player>

	<div class="w-full flex gap-2 items-start px-4">
		<label class="input input-bordered flex items-center gap-2 w-48">
			Name
			<input
				on:focusout={() => {
					send({
						name: name
					})
				localStorage.setItem("name", name)
		}}
				bind:value={name} type="text" class="grow" placeholder="Who?" />
		</label>
		<select bind:value={id}
						class="select select-bordered media-select">
			<option disabled selected>Which media?</option>
			{#each jobs as job}
				<option value={job.Id}>{job.FileRawName}</option>
			{/each}
		</select>
		<div class="flex gap-1 ml-auto self-end">
			{#each roomStates as state}
				<div class="btn btn-sm btn-neutral">
					{#if state.paused === false}
						<IconPlayerPlay size={12} stroke={2} />
					{:else}
						<IconPlayerPause size={12} stroke={2} />
					{/if}
					{state.name}: {formatSeconds(state.time)}
				</div>
			{/each}
			<div class="btn btn-sm font-bold {socketConnected ? 'text-green-600' : 'text-red-600' }">
				{#if socketConnected}
					<IconPlugConnected size={24} stroke={2} />
				{:else}
					<IconPlugConnectedX size={24} stroke={2} />
				{/if}
				{syncState}
			</div>
		</div>
	</div>


</main>

<style>
    .media-player {
        border: none !important;
        border-radius: unset !important;
    }

    .media-select {
        width: 30rem;
    }

</style>
