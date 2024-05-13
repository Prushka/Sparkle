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
		IconBrightnessHalf,
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
	let selectedCodec = localStorage.getItem('codec') || '';
	let pauseSend = false;
	let pausedBeforeCodecChange = false;
	let timeBeforeCodecChange = 0;
	let interactedWithPlayer = false;
	$: videoSrc = `${PUBLIC_HOST}/static/` + roomId + '/' + selectedCodec + '.' + videoExt;

	function onChange(event: any) {
		pauseSend = true;
		if (player) {
			pausedBeforeCodecChange = player.paused;
			timeBeforeCodecChange = player.currentTime;
		}
		selectedCodec = event.currentTarget.value;
	}

	function idChanges(codecs: string[]): string[] {
		console.log('Room ID changed!');
		player.textTracks.clear();
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
		const lsCodec = localStorage.getItem('codec') || '';
		if (codecs.length > 0 && !codecs.includes(lsCodec)) {
			console.log('setting codec - no matching codec', lsCodec, codecs);
			selectedCodec = codecs[0];
		}
	}
	$:{
		if (selectedCodec !== '') {
			console.log('setting codec to localstorage', selectedCodec);
			localStorage.setItem('codec', selectedCodec);
		}
	}

	function connect() {
		if (!interactedWithPlayer) {
			return;
		}
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
		if (player && socketConnected && !pauseSend && interactedWithPlayer) {
			console.log('sending: ' + JSON.stringify(data));
			socket.send(JSON.stringify(data));
		}
	}

	onMount(() => {
		fetch(`${PUBLIC_HOST}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = data;
				jobs.sort((a, b) => {
					return a.FileRawName.localeCompare(b.FileRawName);
				});
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
				const node = document.querySelector('media-title');
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
		if (name === '') {
			document.getElementById('name_modal')?.showModal();
		}
		const chatOverlay = document.getElementById('chat-overlay');
		const thePlayer = document.getElementById('the-player');
		thePlayer!.appendChild(chatOverlay!);
		return () => {
			socket.close();
			clearInterval(i);
		};
	});
	onMount(() => {
		return player.subscribe(({ controlsVisible, canPlay, canLoad }) => {
			controlsShowing = controlsVisible;
			if (canLoad && canPlay && pauseSend) {
				// video loaded, send was paused bcz of codec change
				player.currentTime = timeBeforeCodecChange;
				if (!pausedBeforeCodecChange) {
					player.play();
				}
				pauseSend = false;
			}
		});
	});


</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<main id="main-page" class="overflow-hidden flex flex-col items-center w-full h-full gap-3 pb-4">

	<dialog id="name_modal" class="modal">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Name is required for syncing</h3>
			<label class="input input-bordered flex items-center gap-2 name-input mt-5 mb-2">
				Name
				<input
					on:focusout={() => {
					send({
						name: name
					})
				localStorage.setItem("name", name)
			}}
					bind:value={name} type="text" class="grow" placeholder="Name?" />
			</label>
			{#if name !== ''}
				<div class="modal-action">
					<form method="dialog">
						<button class="btn">Done</button>
					</form>
				</div>
			{/if}
		</div>
	</dialog>

	<media-player
		keyShortcuts={{
    // Space-separated list.
    togglePaused: 'k Space',
    toggleMuted: 'm',
    toggleFullscreen: 'f',
    togglePictureInPicture: 'i',
    seekBackward: ['j', 'J', 'ArrowLeft'],
    seekForward: ['l', 'L', 'ArrowRight'],
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    }}
		id="the-player"
		class="media-player-c media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4 relative"
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
				if(interactedWithPlayer) {
					send({ paused: false });
				}else{
					interactedWithPlayer = true;
					connect();
				}
			}}
	>
		<media-provider/>
		<media-video-layout/>
	</media-player>

	<div class="flex gap-1 w-full h-full absolute pointer-events-none" id="chat-overlay">
		<div
			class="{controlsShowing? 'shift-down':''} flex flex-col gap-0.5 ml-auto chat-history drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] items-end">
			{#each messagesToDisplay as message}
				<div class="flex gap-1 justify-end items-center chat-line py-1 px-2 text-center">
					<p class="text-center text-white">{message.message}
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
			<label class="input input-bordered flex items-center gap-2 w-48 name-input">
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
		</div>
		<select bind:value={roomId}
						class="select media-select select-bordered flex-grow mr-4">
			<option disabled selected>Which media?</option>
			{#each jobs as job}
				<option value={job.Id}>{job.FileRawName}</option>
			{/each}
		</select>
		<div class="join self-center">
			{#each codecs as codec}
				<input class="join-item btn" type="radio" name="options"
							 checked={codec === selectedCodec} aria-label={codec}
							 on:change={onChange} value={codec} />
			{/each}
		</div>

	</div>

	<div class="flex gap-2 sync-states">
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
		<div class="tooltip tooltip-bottom" data-tip="Last ticked: {tickedSecsAgo} seconds ago">
			<button
							id="sync-button"
							class="btn btn-sm font-bold {socketConnected ? 'text-green-600' : 'text-red-600' }">
				{#if socketConnected}
					<IconPlugConnected size={24} stroke={2} />
				{:else}
					<IconPlugConnectedX size={24} stroke={2} />
				{/if}
			</button>
		</div>
		<button id="theme-button"  on:click={nextTheme} class="btn btn-sm font-bold">
			<IconBrightnessHalf size={24} stroke={2} />
		</button>
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

    .chat-history {
        margin-top: 2rem;
        margin-right: 2rem;
    }

    .chat-history .avatar {
        width: 1.5rem;
        height: 1.5rem;
    }


    @media (max-width: 1000px) {

        .sync-states {
            flex-direction: column;
        }

        .name-input {
            flex-grow: 1;
        }

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
    }

    .media-player-c {
        max-height: 100vh;
        max-width: 100vw;
    }
</style>
