<script lang="ts">
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onDestroy, onMount } from 'svelte';
	import {
		codecsPriority,
		formatSeconds,
		type Job,
		type Chat,
		type Player,
		randomString, SyncTypes, type SendPayload, defaultTheme, themes
	} from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		IconAt, IconAtOff,
		IconBrightnessHalf, IconEye, IconEyeOff,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconPlugConnected,
		IconPlugConnectedX
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import { chatHiddenStore, pfpLastFetched } from '../../store';

	let player: MediaPlayerElement;
	let controlsShowing = false;
	let socket: WebSocket;
	let name = localStorage.getItem('name') || '';
	let pfp: File | null = null;
	let pfpInput: HTMLInputElement | null = null;
	let roomPlayers: Player[] = [];
	let roomMessages: Chat[] = [];
	let jobs: Job[] = [];
	let roomId: string = '';
	let lastTicked = 0;
	let tickedSecsAgo = 0;
	let socketConnected = false;
	let messagesToDisplay: Chat[] = [];
	let controlsToDisplay: SendPayload[] = [];
	let id: string | null = localStorage.getItem('id') || null;
	let title = '';
	let codecs: string[] = [];
	let videoExt = '';
	let selectedCodec = localStorage.getItem('codec') || '';
	let pauseSend = false;
	let pausedBeforeCodecChange = false;
	let timeBeforeCodecChange = 0;
	let interactedWithPlayer = false;
	let currentTheme = localStorage.getItem('theme') || defaultTheme;
	let chatHidden = false;
	let lastSentTime = -100;
	let chatPfpHidden: boolean = localStorage.getItem('chatPfpHidden') === 'true' || true;
	const unsubscribe = chatHiddenStore.subscribe((value) => chatHidden = value);
	$: videoSrc = `${PUBLIC_HOST}/static/` + roomId + '/' + selectedCodec + '.' + videoExt;
	$: thumbnailVttSrc = `${PUBLIC_HOST}/static/` + roomId + `/storyboard.vtt`;

	onDestroy(unsubscribe);

	function nextTheme() {
		const html = document.querySelector('html');
		const cT = localStorage.getItem('theme') || defaultTheme;
		const nextTheme = themes[(themes.indexOf(cT) + 1) % themes.length];
		html?.setAttribute('data-theme', nextTheme);
		localStorage.setItem('theme', nextTheme);
		currentTheme = nextTheme;
	}

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
				player.remoteControl.showCaptions();
			}
			title = job.FileRawName;
			codecs = job.EncodedCodecs;
			videoExt = job.EncodedExt;
			codecs.sort((a, b) => {
				return codecsPriority.indexOf(a) - codecsPriority.indexOf(b);
			});
			player.controlsDelay = 1600;
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
				send({ name: name, type: SyncTypes.NameSync });
			}
			send({ type: SyncTypes.NewPlayer });
		};

		socket.onmessage = (event: MessageEvent) => {
			const state: SendPayload = JSON.parse(event.data);
			const persistControlState = (state: any) => {
				if (state.firedBy !== undefined) {
					controlsToDisplay.push(state);
					updateMessages();
				}
			}
			if (player) {
				switch (state.type) {
					case SyncTypes.PfpSync:
						console.log('received: ' + JSON.stringify(state));
						if (state.firedBy) {
							$pfpLastFetched = {
								...pfpLastFetched,
								[state.firedBy.id]: `${PUBLIC_HOST}/static/pfp/${state.firedBy.id}.png?${Date.now()}`
							};
						}
						break;
					case SyncTypes.ChatSync:
						roomMessages = state.chats;
						updateMessages();
						break;
					case SyncTypes.PlayersStatusSync:
						roomPlayers = state.players;
						lastTicked = Date.now();
						break;
					case SyncTypes.PauseSync:
						console.log('received: ' + JSON.stringify(state));
						if (state.paused === true && player.paused === false) {
							player.pause();
							persistControlState(state)
						} else if (state.paused === false && player.paused === true) {
							player.play();
							persistControlState(state)
						}
						break;
					case SyncTypes.TimeSync:
						console.log('received: ' + JSON.stringify(state));
						if (state.time !== undefined && Math.abs(player.currentTime - state.time) > 3) {
							player.currentTime! = state.time;
							persistControlState(state);
						}
						break;
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

	function updateList() {
		fetch(`${PUBLIC_HOST}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = data;
				jobs.sort((a, b) => {
					return a.FileRawName.localeCompare(b.FileRawName);
				});
				console.log(jobs);
				roomId = $page.url.searchParams.get('id') || '';
			});
	}

	function updateMessages() {
		messagesToDisplay = roomMessages.filter((message) => {
			return (Date.now() - message.timestamp) < 200000;
		});
		messagesToDisplay = messagesToDisplay.slice(-10);
		for (const control of controlsToDisplay) {
			if (control.firedBy && (Date.now() - control.timestamp) < 8000) {
				const message: Chat = {
					uid: control.firedBy.id,
					username: control.firedBy.name,
					message: control.type === SyncTypes.PauseSync ? (control.paused ? 'paused' : 'resumed') : 'seeked to ' + formatSeconds(control.time),
					timestamp: control.timestamp,
					mediaSec: player.currentTime,
					isStateUpdate: true
				};
				messagesToDisplay.push(message);
			}
		}
		messagesToDisplay.sort((a, b) => {
			return a.timestamp - b.timestamp;
		});
	}

	onMount(() => {
		updateList();
		const ii = setInterval(() => {
			updateList();
		}, 60000);
		const i = setInterval(() => {
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
			updateMessages();
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
			clearInterval(ii);
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

	onMount(() => {
		return player.subscribe(({ currentTime }) => {
			const timeRounded = Math.round(currentTime);
			if (lastSentTime !== timeRounded) {
				send({
					type: SyncTypes.TimeSync,
					time: timeRounded
				});
				lastSentTime = timeRounded;
			}
		});
	})


</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<main id="main-page" class="overflow-hidden flex flex-col items-center w-full h-full gap-4 pb-4">

	<dialog id="name_modal" class="modal">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Name is required for syncing</h3>
			<label class="input input-bordered flex items-center gap-2 name-input mt-5 mb-2">
				Name
				<input
					on:focusout={() => {
					send({
					  type: SyncTypes.NameSync,
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
    toggleFullscreen: null,
    togglePictureInPicture: 'i',
    seekBackward: ['j', 'J', 'ArrowLeft'],
    seekForward: ['l', 'L', 'ArrowRight'],
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    }}
		id="the-player"
		class="media-player-c media-player w-full aspect-video overflow-hidden bg-slate-900 ring-media-focus data-[focus]:ring-4 relative"
		src={videoSrc}
		crossorigin
		bind:this={player}
		playsInline
		on:pause={
			() => {
				send({ paused: true, type: SyncTypes.PauseSync });
			}}
		on:play={
			() => {
				if(interactedWithPlayer) {
					send({ paused: false, type: SyncTypes.PauseSync });
				}else{
					interactedWithPlayer = true;
					connect();
				}
			}}
	>
		<media-provider></media-provider>
		<media-video-layout thumbnails={thumbnailVttSrc}></media-video-layout>
	</media-player>

	<div class="flex gap-1 w-full h-full absolute pointer-events-none" id="chat-overlay"
			 style={chatHidden ? 'display: none' : ''}
	>
		<div
			class="{controlsShowing? 'shift-down':''} flex flex-col gap-0.5 ml-auto chat-history drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] items-end">
			{#each messagesToDisplay as message}
				<div class={`flex gap-1 justify-center items-center chat-line py-1 pl-2.5 pr-2 text-center text-white ${message.isStateUpdate ? 'font-semibold' : ''}`}>
					<p>{message.message}</p>
						<p class="text-sm">[{message.isStateUpdate ? '' : `${formatSeconds(message.mediaSec)}, `}{new Date(message.timestamp).toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit'
				})}]</p>
						 <p>{message.username}</p>
					{#if chatPfpHidden === false}
						<Pfp id={message.uid} class="avatar" />
					{/if}
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
				{#if id}
					<Pfp id={id} class="w-12 h-12 " />
				{/if}
				<input accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
							 bind:this={pfpInput}
							 on:change={() => {
							 const ppfp = pfpInput?.files;
							 if (ppfp && ppfp[0]) {
								 if(ppfp[0].size > 12000000) {
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
					  type: SyncTypes.NameSync,
						name: name
					})
				localStorage.setItem("name", name)
			}}
					bind:value={name} type="text" class="grow" placeholder="Who?" />
			</label>
		</div>
		<select
			on:change={(e) => {
				const roomId = e.currentTarget.value;
				$page.url.searchParams.set('id', roomId);
				window.location.href = $page.url.toString();
			}}
			bind:value={roomId}
			class="select media-select select-bordered flex-grow mr-4">
			<option disabled selected>Which media?</option>
			{#each jobs as job}
				<option value={job.Id}>{job.FileRawName}</option>
			{/each}
		</select>

		<div class="flex gap-2 self-center">
			<div class="tooltip tooltip-left" data-tip="Video Codec">
				<div class="join">
					{#each codecs as codec}
						<input class="join-item btn" type="radio" name="options"
									 checked={codec === selectedCodec} aria-label={codec}
									 on:change={onChange} value={codec} />
					{/each}
				</div>
			</div>
			<div class="tooltip tooltip-left" data-tip="Ticked: {tickedSecsAgo}s ago">
				<button
					id="sync-button"
					class="btn font-bold {socketConnected ? 'text-green-600' : 'text-red-600' }">
					{#if socketConnected}
						<IconPlugConnected size={24} stroke={2} />
					{:else}
						<IconPlugConnectedX size={24} stroke={2} />
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-left" data-tip={chatHidden ? "Show Chat" : "Hide Chat"}>
				<button id="chat-hide-button" on:click={()=>{
					$chatHiddenStore = !chatHidden;
				}} class="btn font-bold">
					{#if chatHidden}
						<IconEye size={24} stroke={2} />
					{:else}
						<IconEyeOff size={24} stroke={2} />
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-left" data-tip={chatPfpHidden ? "Show Pfp" : "Hide Pfp"}>
				<button id="chat-hide-button" on:click={()=>{
					chatPfpHidden = !chatPfpHidden;
					localStorage.setItem('chatPfpHidden', chatPfpHidden.toString());
				}} class="btn font-bold">
					{#if chatPfpHidden}
						<IconAt size={24} stroke={2} />
					{:else}
						<IconAtOff size={24} stroke={2} />
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-left" data-tip={`Theme: ${currentTheme}`}>
				<button id="theme-button" on:click={nextTheme} class="btn font-bold">
					<IconBrightnessHalf size={24} stroke={2} />
				</button>
			</div>
		</div>

	</div>

	<div class="flex gap-4 sync-states">
		{#each roomPlayers as player}
			<button
				class="btn btn-neutral border-none h-auto pr-4 py-0 pl-0 rounded-l-full rounded-r-full shadow-md flex gap-3.5">
				<Pfp class="w-12 h-12 mr-0.5" id={player.id} />
				<div class="flex gap-1 flex-col items-center justify-center">
					<p class="font-semibold">{player.name}</p>
					{formatSeconds(player.time)}
				</div>
				{#if player.paused === false}
					<IconPlayerPlayFilled size={18} stroke={2} />
				{:else}
					<IconPlayerPauseFilled size={18} stroke={2} />
				{/if}
			</button>
		{/each}
	</div>


</main>

<style>
    .media-player {
        border: none !important;
        border-radius: unset !important;
    }

    .media-select {
        width: 20rem;
    }

    .chat-history {
        margin-top: 2rem;
        margin-right: 2rem;
    }

    .chat-line{
        width: fit-content;
        border-radius: 0.5rem;
        background-color: rgba(0,0,0,0.2);
    }

    @media (max-width: 1000px) {

        .sync-states {
            display: grid;
            grid-template-columns: auto auto;
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

        .chat-history .text-sm {
						line-height: unset;
            font-size: 0.64rem;
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
