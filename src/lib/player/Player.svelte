<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		type TextTrackInit
	} from 'vidstack';
	import { formatSeconds, type Job, type Message, type PlayerState, randomString } from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		IconPlayerPause,
		IconPlayerPlay,
		IconPlugConnected,
		IconPlugConnectedX,
		IconUser
	} from '@tabler/icons-svelte';

	let player: MediaPlayerElement;

	let socket: WebSocket;
	let name = '';
	let pfp: File | null = null;
	let pfpInput: HTMLInputElement | null = null;
	let roomStates: PlayerState[] = [];
	let roomMessages: Message[] = [];
	let jobs: Job[] = [];
	let roomId: string = '';
	let textTracks: TextTrackInit[] = [];
	let lastTicked = 0;
	let videoSrc = '';
	let socketConnected = false;
	$: syncState = socketConnected && Math.ceil((Date.now() - lastTicked) / 1000) < 5 ? 'SYNCED' : 'NOT SYNCED';
	let messagesToDisplay: Message[] = [];
	let id: string | null = localStorage.getItem('id') || null;
	let title = "";

	function idChanges() {
		console.log('called');
		connect();

		for (const job of jobs) {
			if (job.Id === roomId) {
				for (const sub of job.Subtitles) {
					textTracks.push({
						src: `${PUBLIC_HOST}/static/${roomId}/${sub}`,
						label: sub,
						kind: 'subtitles',
						default: sub.includes('eng')
					});
				}
				title = job.FileRawName;
				break;
			}
		}
		for (const track of textTracks) player.textTracks.add(track);
		videoSrc = `${PUBLIC_HOST}/static/${roomId}/out.mp4`;
		$page.url.searchParams.set('id', roomId);
		goto($page.url);
	}

	$ : if (roomId !== '') {
		idChanges();
	}

	function connect() {
		if (socketConnected) {
			socket.close();
		}
		if (id === null) {
			id = randomString(36);
			localStorage.setItem('id', id);
		}
		socket = new WebSocket(`${PUBLIC_WS}/sync/${roomId}/${id}`);
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
					if (state[0].message) {
						roomMessages = state;
					} else {
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
			socketConnected = false;
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
				roomId = $page.url.searchParams.get('id') || '';
			});
		name = localStorage.getItem('name') || '';
		setInterval(() => {
			send({
				time: player?.currentTime
			});
			if (!document.getElementById('chat-input')) {
				console.log('mounting chat');
				for (const node of document.querySelectorAll('media-chapter-title')) {
					const input = document.createElement('input');
					input.id = 'chat-input';
					input.classList.add('input', 'input-sm', 'input-sm', 'mx-8', 'text-black');
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
						input.placeholder = 'Sent!';
						setTimeout(() => {
							input.placeholder = 'Chat';
						}, 2000);
					});
					// add after the node
					node.parentNode?.insertBefore(form, node.nextSibling);
				}
			}
			messagesToDisplay = roomMessages.filter((message) => {
				return (Date.now() / 1000 - message.timestamp) < 200;
			});
		}, 1000);
		return () => {
			socket.close();
		};
	});

</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<main id="main-page" class="flex flex-col items-center w-full h-full overflow-auto gap-3 pb-4">

	<media-player
		class="media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4"
		title={title}
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
				<div class="flex flex-col gap-0.5 ml-auto mt-8 mr-8 drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] items-end">
					{#each messagesToDisplay as message}
						<div class="flex gap-0.5 justify-end items-center chat-line py-1 px-2 text-center">
							{message.message}
							[{new Date(message.timestamp * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}, {formatSeconds(message.mediaSec)}]: {message.username}
							<img src="{PUBLIC_HOST}/static/pfp/{id}.png"
									 on:error={(e) => {
							 			e.target.src = '/icons/uwu.png';
						 }}
									 alt="pfp" class="w-6 h-6 rounded-full object-cover" />
						</div>
					{/each}
				</div>
			</div>
		</media-video-layout>

	</media-player>

	<div class="w-full flex gap-2 items-start px-4">
		<label class="custom-file-upload">
			<img src="{pfp? URL.createObjectURL(pfp): `${PUBLIC_HOST}/static/pfp/${id}.png`}"
						 on:error={(e) => {
							 e.target.src = '/icons/uwu.png';
						 }}
						 alt="pfp" class="w-12 h-12 rounded-full object-cover" />
			<input accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
						 bind:this={pfpInput}
						 on:change={() => {
							 const ppfp = pfpInput?.files;
							 if (ppfp && ppfp[0]) {
								 if(ppfp[0].size > 10000000) {
									 warning_modal.showModal();
									 pfpInput.value = '';
									 return;
								 }
								 pfp = ppfp[0];
								 const reader = new FileReader();
								 reader.onload = function(e) {
									 const res = e.target?.result;
									 if(res && typeof res === 'string') {
										 // send POST request with form data to /pfp/{id}
										 const formData = new FormData();
										 formData.append('pfp', pfp);
										 fetch(`${PUBLIC_HOST}/pfp/${id}`, {
											 method: 'POST',
											 body: formData
										 }).then(data => {
												 console.log(data);
											});
									 }
								 };
								 reader.readAsDataURL(pfp);
							 }
						 }}
						 type="file" />
		</label>
		<label class="input input flex items-center gap-2 w-48">
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
		<select bind:value={roomId}
						class="select media-select">
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
			<button
				class="btn btn-sm font-bold {socketConnected ? 'text-green-600' : 'text-red-600' }">
				{#if socketConnected}
					<IconPlugConnected size={24} stroke={2} />
				{:else}
					<IconPlugConnectedX size={24} stroke={2} />
				{/if}
			</button>
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
