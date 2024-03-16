<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		codecsPriority,
		formatSeconds,
		type Job,
		type Message,
		nextTheme,
		type PlayerState,
		randomString
	} from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		IconPlayerPause,
		IconPlayerPlay,
		IconPlugConnected,
		IconPlugConnectedX
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';

	let player: MediaPlayerElement;
	let controlsShowing = false;
	let socket: WebSocket;
	let name = localStorage.getItem('name') || '';
	let pfp: File | null = null;
	let pfpInput: HTMLInputElement | null = null;
	let roomStates: PlayerState[] = [];
	let roomMessages: Message[] = [];
	let jobs: Job[] = [];
	let roomId: string = '';
	let lastTicked = 0;
	let tickedSecsAgo = 0;
	let socketConnected = false;
	let messagesToDisplay: Message[] = [];
	let id: string | null = localStorage.getItem('id') || null;
	let title = '';
	let codecs: string[] = [];
	let videoExt = '';
	let selectedCodec = '';
	let pauseSend = false;
	let videoCanPlay = false;
	let videoCanLoad = false;
	let lastCheckedPlayerCanPlay = -1;
	$: videoSrc = `${PUBLIC_HOST}/static/` + roomId + '/' + selectedCodec + '.' + videoExt;

	function idChanges(codecs: string[]): string[] {
		console.log('Room ID changed!');
		player.textTracks.clear();
		player.controlsDelay = 4000;
		const job = jobs.find((job) => job.Id === roomId);
		if (job) {
			if (job.Subtitles) {
				for (const [, sub] of Object.entries(job.Subtitles)) {
					const enc = sub.Enc;
					if (enc) {
						player.textTracks.add({
							src: `${PUBLIC_HOST}/static/${roomId}/${enc.Location}`,
							label: enc.Location,
							kind: 'subtitles',
							default: enc.Language.includes('eng')
						});
					}
				}
			}
			title = job.FileRawName;
			codecs = job.EncodedCodecs;
			videoExt = job.EncodedExt;
			codecs.sort((a, b) => {
				return codecsPriority.indexOf(a) - codecsPriority.indexOf(b);
			});
		}
		console.debug('textTracks: ' + JSON.stringify(player.textTracks));
		$page.url.searchParams.set('id', roomId);
		goto($page.url);
		if (socketConnected) {
			socket.close();
		}
		return codecs;
	}

	$ : if (roomId !== '') {
		codecs = idChanges(codecs);
	}

	$:{
		console.log('video:' + videoSrc, 'codecs: ' + codecs, 'selectedCodec: ' + selectedCodec);
	}

	$:{
		if (codecs.length > 0) {
			selectedCodec = codecs[0];
		}
	}

	function connect() {
		if (id === null) {
			id = randomString(36);
			localStorage.setItem('id', id);
		}
		socket = new WebSocket(`${PUBLIC_WS}/sync/${roomId}/${id}`);
		console.log(`Connecting to ${roomId}`);
		socket.onopen = () => {
			console.log(`Connected to ${roomId}`);
			socketConnected = true;
			if (name !== '') {
				send({ name: name });
			}
			send({ reason: 'new player' });
		};

		socket.onmessage = (event: MessageEvent) => {
			const state = JSON.parse(event.data);
			if (player) {
				if (Array.isArray(state)) {
					console.debug('received: ' + event.data);
					if (state.length > 0) {
						if (state[0].message) {
							roomMessages = state;
							console.log('received messages: ' + JSON.stringify(roomMessages));
						} else {
							roomStates = state;
							lastTicked = Date.now();
						}
					} else {
						roomMessages = [];
					}
				} else {
					console.log('received: ' + event.data);
					if (state['paused'] === true && player.paused === false) {
						player.pause();
					} else if (state['paused'] === false && player.paused === true) {
						player.play();
					} else if (state['time'] !== undefined) {
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
		if (player && socketConnected && !pauseSend) {
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
				connect();
			});
		const i = setInterval(() => {
			send({
				time: player?.currentTime
			});
			if (!document.getElementById('chat-input')) {
				console.log('mounting chat');
				const node = document.querySelector('media-chapter-title');
				if (node) {
					const container = document.createElement('div');
					container.classList.add('chat-box');
					node.parentNode?.insertBefore(container, node.nextSibling);
					new Chatbox({
						target: container,
						props: {
							send: send,
							classes: 'input-sm mx-6 chat-box',
							id: 'chat-input',
							onFocus: () => {
								player.controls.pause();
							},
							onBlur: () => {
								player.controls.resume();
							}
						}
					});
				}
			}
			messagesToDisplay = roomMessages.filter((message) => {
				return (Date.now() / 1000 - message.timestamp) < 200;
			});
			messagesToDisplay = messagesToDisplay.slice(-10);
			tickedSecsAgo = (Date.now() - lastTicked) / 1000;
		}, 1000);

		const j = setInterval(() => {
			console.debug('canPlay: ', videoCanPlay, 'canLoad: ', videoCanLoad, 'codecs: ', codecs.length, 'selectedCodec: ', selectedCodec);
			if (!videoCanPlay && videoCanLoad && codecs.length > 0) {
				if (lastCheckedPlayerCanPlay < 0) {
					lastCheckedPlayerCanPlay = Date.now();
					return;
				} else if (Date.now() - lastCheckedPlayerCanPlay > 1000) {
					const selectedCodecIndex = codecs.indexOf(selectedCodec);
					if (selectedCodecIndex < codecs.length - 1) {
						selectedCodec = codecs[selectedCodecIndex + 1];
						console.log('Trying next codec: ' + selectedCodec);
					} else {
						console.log('No more codecs to try');
					}
					lastCheckedPlayerCanPlay = -1;
				}
			}
		}, 250);
		return () => {
			socket.close();
			clearInterval(i);
			clearInterval(j);
		};
	});
	onMount(() => {
		return player.subscribe(({ controlsVisible, canLoadPoster, canLoad }) => {
			controlsShowing = controlsVisible;
			videoCanPlay = canLoadPoster;
			videoCanLoad = canLoad;
		});
	});


</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<main id="main-page" class="flex flex-col items-center w-full h-full overflow-auto gap-3 pb-4">

	<media-player
		class="media-player-c media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4"
		title={title}
		src={videoSrc}
		crossorigin
		bind:this={player}
		playsInline
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
				<div
					class="{controlsShowing? 'shift-down':''} flex flex-col gap-0.5 ml-auto chat-history drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] items-end">
					{#each messagesToDisplay as message}
						<div class="flex gap-1 justify-end items-center chat-line py-1 px-2 text-center">
							<p class="text-center">{message.message}
								[{new Date(message.timestamp * 1000).toLocaleTimeString('en-US', {
									hour: '2-digit',
									minute: '2-digit'
								})}, {formatSeconds(message.mediaSec)}] {message.username}</p>
							<img src="{PUBLIC_HOST}/static/pfp/{message.uid}.png"
									 on:error={(e) => {
							 			e.target.src = '/icons/uwu.png';
						 }}
									 alt="pfp" class="avatar rounded-full object-cover" />
						</div>
					{/each}
				</div>
			</div>
		</media-video-layout>

	</media-player>

	<div class="w-full flex items-start px-4 input-container">
		<div class="chat-box-mobile w-full">
			<Chatbox send={send} class="input-bordered input-md" />
		</div>
		<div class="profile-input-container">
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

			<div class="ml-auto tooltip tooltip-left" data-tip="Last ticked: {tickedSecsAgo} seconds ago">
				<button on:click={nextTheme}
								id="sync-button-mobile"
								class="btn font-bold {socketConnected ? 'text-green-600' : 'text-red-600' }">
					{#if socketConnected}
						<IconPlugConnected size={28} stroke={1.5} />
					{:else}
						<IconPlugConnectedX size={28} stroke={1.5} />
					{/if}
				</button>
			</div>
		</div>
		<select bind:value={roomId}
						class="select media-select select-bordered">
			<option disabled selected>Which media?</option>
			{#each jobs as job}
				<option value={job.Id}>{job.FileRawName}</option>
			{/each}
		</select>
		<div class="flex gap-1 ml-auto">
			{#each roomStates as state}
				<button class="btn btn-sm btn-neutral">
					{#if state.paused === false}
						<IconPlayerPlay size={12} stroke={2} />
					{:else}
						<IconPlayerPause size={12} stroke={2} />
					{/if}
					{state.name}: {formatSeconds(state.time)}
				</button>
			{/each}
			<div class="tooltip tooltip-left" data-tip="Last ticked: {tickedSecsAgo} seconds ago">
				<button on:click={nextTheme}
								id="sync-button"
								class="btn btn-sm font-bold {socketConnected ? 'text-green-600' : 'text-red-600' }">
					{#if socketConnected}
						<IconPlugConnected size={24} stroke={2} />
					{:else}
						<IconPlugConnectedX size={24} stroke={2} />
					{/if}
				</button>
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

    #sync-button-mobile {
        display: none;
    }

    #sync-button {
        display: block;
    }

    .chat-history {
        margin-top: 2rem;
        margin-right: 2rem;
    }

    .chat-history .avatar {
        width: 1.5rem;
        height: 1.5rem;
    }


    @media (max-width: 1000px) {

        .shift-down {
            margin-top: 2.5rem !important;
        }

        .chat-history {
            margin-top: 0.5rem;
            margin-right: 0.5rem;
            font-size: 0.64rem;
        }

        .chat-history .avatar {
            width: 1rem;
            height: 1rem;
        }

        .media-select {
            width: 100%;
        }

        #sync-button {
            display: none;
        }

        #sync-button-mobile {
            display: block;
        }
    }

    .media-player-c {
        max-height: 100vh;
        max-width: 100vw;
    }
</style>
