<script lang="ts">
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onDestroy, onMount } from 'svelte';
	import {
		formatSeconds,
		type Job,
		type Chat,
		type Player,
		SyncTypes,
		type SendPayload,
		defaultTheme,
		themes,
		setGetPlayerId,
		formatMbps,
		languageMap,
		languageSrcMap,
		codecMap,
		getSupportedCodecs
	} from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import {
		IconAt, IconAtOff,
		IconBrightnessHalf, IconEye, IconEyeOff,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconPlugConnected,
		IconPlugConnectedX, IconTableExport
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import { chatFocusedStore, chatHiddenStore, metadataStore, pfpLastFetched } from '../../store';

	let controlsShowing = false;
	let player: MediaPlayerElement;
	let socket: WebSocket;
	let name = localStorage.getItem('name') || '';
	let playerId: string = setGetPlayerId();
	let pfp: File;
	let pfpInput: HTMLInputElement;
	let roomPlayers: Player[] = [];
	let roomMessages: Chat[] = [];
	let jobs: Job[] = [];
	let job: Job | undefined;
	let roomId = $page.params.id || '';
	let lastTicked = 0;
	let tickedSecsAgo = 0;
	let tickedSecsAgoStr = '0';
	let socketConnected = false;
	let messagesToDisplay: Chat[] = [];
	let controlsToDisplay: SendPayload[] = [];
	let selectedCodec = localStorage.getItem('sCodec') || 'auto';
	let pauseSend = false;
	let supportedCodecs: string[] = [];
	let stateBeforeCodecChange = {
		paused: false,
		time: 0,
		volume: 1,
		muted: false
	};
	let interactedWithPlayer = false;
	let currentTheme = localStorage.getItem('theme') || defaultTheme;
	let chatHidden = false;
	let lastSentTime = -100;
	let chatFocused = false;
	let chatPfpHidden: boolean = localStorage.getItem('chatPfpHidden') ? localStorage.getItem('chatPfpHidden') === 'true' : true;
	let metadata: any;
	let videoSrc: any = []
	const unsubscribeMetadata = metadataStore.subscribe((value) => {
		metadata = value;
		job = metadata.job;
	});
	const unsubscribeChatHidden = chatHiddenStore.subscribe((value) => chatHidden = value);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	$: thumbnailVttSrc = `${PUBLIC_HOST}/static/${roomId}/storyboard.vtt`;
	$: socketCommunicating = socketConnected && (tickedSecsAgo >= 0 && tickedSecsAgo < 5);

	$: {
		console.log(metadata);
		console.log("srcList:", videoSrc)
	}

	onDestroy(() => {
		unsubscribeChatHidden();
		unsubscribeChatFocused();
		unsubscribeMetadata();
	});

	function setVideoSrc() {
		if(job){
			const prevCodec = videoSrc?.sCodec
			const change = () => {
				pauseSend = true;
				if (player) {
					stateBeforeCodecChange = {
						paused: player.paused,
						time: player.currentTime,
						volume: player.volume,
						muted: player.muted
					};
				}
			}
			const autoCodec = supportedCodecs.length > 0 ? supportedCodecs[0] : job?.EncodedCodecs[0];
			if(selectedCodec === "auto" && prevCodec !== autoCodec) {
				videoSrc = {
					src: `${PUBLIC_HOST}/static/${roomId}/${autoCodec}.mp4`,
					type: 'video/mp4',
					codec: codecMap[autoCodec],
					sCodec: autoCodec
				};
				console.log("auto codec", autoCodec, codecMap[autoCodec])
				change()
			}else if (selectedCodec !== "auto" && prevCodec !== selectedCodec) {
				videoSrc = {
					src: `${PUBLIC_HOST}/static/${roomId}/${selectedCodec}.mp4`,
					type: 'video/mp4',
					codec: codecMap[selectedCodec],
					sCodec: selectedCodec
				};
				console.log("selected codec", selectedCodec, codecMap[selectedCodec])
				change()
			}
		}
	}

	function nextTheme() {
		const html = document.querySelector('html');
		const cT = localStorage.getItem('theme') || defaultTheme;
		const nextTheme = themes[(themes.indexOf(cT) + 1) % themes.length];
		html?.setAttribute('data-theme', nextTheme);
		localStorage.setItem('theme', nextTheme);
		currentTheme = nextTheme;
	}

	function onCodecChange(selected: string) {
		selectedCodec = selected;
		localStorage.setItem('sCodec', selectedCodec);
		window.location.reload()
	}

	$:{
		if (selectedCodec !== "auto" && job?.EncodedCodecs && job?.EncodedCodecs.length > 0 && !job?.EncodedCodecs.includes(selectedCodec)) {
			console.log('setting codec - no matching codec', selectedCodec, job?.EncodedCodecs);
			onCodecChange("auto");
		}
	}

	function connect() {
		if (!interactedWithPlayer) {
			return;
		}
		socket = new WebSocket(`${PUBLIC_WS}/sync/${roomId}/${playerId}`);
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
			};
			if (player) {
				console.debug('received: ' + JSON.stringify(state));
				switch (state.type) {
					case SyncTypes.PfpSync:
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
						if (state.paused === true && player.paused === false) {
							player.pause();
							persistControlState(state);
						} else if (state.paused === false && player.paused === true) {
							player.play();
							persistControlState(state);
						}
						break;
					case SyncTypes.TimeSync:
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

	function updateList(onSuccess: any = () => {
	}) {
		fetch(`${PUBLIC_HOST}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = data;
				jobs.sort((a, b) => {
					return a.FileRawName.localeCompare(b.FileRawName);
				});
				console.log(jobs);
				onSuccess();
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

	function reloadPlayer() {
		if (job) {
			player.textTracks.clear()
			player.remoteControl.disableCaptions();
			if (job.Subtitles) {
				for (const [, sub] of Object.entries(job.Subtitles)) {
					const enc = sub.Enc;
					if (enc) {
						player.textTracks.add({
							src: `${PUBLIC_HOST}/static/${roomId}/${enc.Location}`,
							label: languageMap[enc.Language] || enc.Language,
							kind: 'subtitles',
							type: 'vtt',
							language: languageSrcMap[enc.Language] || enc.Language,
							default: enc.Language.includes('eng')
						});
					}
				}
				player.remoteControl.showCaptions();
			}
			player.controlsDelay = 1600;
		}
		console.debug('textTracks: ' + JSON.stringify(player.textTracks));
	}

	onMount(() => {
		updateList();
		supportedCodecs = getSupportedCodecs();
		setVideoSrc()
		reloadPlayer();
		const ii = setInterval(() => {
			updateList();
		}, 60000);
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) {
				send({ state: 'bg', type: SyncTypes.StateSync });
			} else {
				send({ state: 'fg', type: SyncTypes.StateSync });
			}
		});
		const playerUnsubscribe = player.subscribe(({ controlsVisible, canPlay, canLoad }) => {
			controlsShowing = controlsVisible;
			if (canLoad && canPlay && pauseSend) {
				// video loaded, send was paused bcz of codec change
				player.currentTime = stateBeforeCodecChange.time;
				if (!stateBeforeCodecChange.paused) {
					player.play();
				}
				player.volume = stateBeforeCodecChange.volume;
				player.muted = stateBeforeCodecChange.muted;
				reloadPlayer();
				pauseSend = false;
			}
		});
		const i = setInterval(() => {
			updateTime();
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
							chatFocused: chatFocused,
							classes: 'input-sm mx-6 chat-box',
							id: 'chat-input',
							onFocus: () => {
								player.controls.pause();
								$chatFocusedStore = true;
							},
							onBlur: () => {
								player.controls.resume();
								$chatFocusedStore = false;
							}
						}
					});
				}
			}
			updateMessages();
			tickedSecsAgo = (socketConnected && roomPlayers.length > 0) ? (Date.now() - lastTicked) / 1000 : -1;
			tickedSecsAgoStr = (Math.round(tickedSecsAgo * 100) / 100).toFixed(2);
		}, 1000);
		if (name === '') {
			document.getElementById('name_modal')?.showModal();
		}
		const chatOverlay = document.getElementById('chat-overlay');
		const thePlayer = document.getElementById('the-player');
		thePlayer!.appendChild(chatOverlay!);
		return () => {
			socket?.close();
			clearInterval(i);
			clearInterval(ii);
			playerUnsubscribe();
		};
	});

	function updateTime() {
		const timeRounded = Math.ceil(player.currentTime);
		if (lastSentTime !== timeRounded) {
			send({
				type: SyncTypes.TimeSync,
				time: timeRounded
			});
			lastSentTime = timeRounded;
		}
	}
</script>

<main id="main-page" class="overflow-hidden flex flex-col items-center w-full h-full">
	<dialog id="warning_modal" class="modal">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Image is too large</h3>
			<p class="py-4">Size limit: 10 MB</p>
			<div class="modal-action">
				<form method="dialog">
					<button class="btn">Close</button>
				</form>
			</div>
		</div>
	</dialog>
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
		class="media-player w-full bg-slate-900 aspect-video relative"
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
			class="{controlsShowing ? 'shift-down':''} flex flex-col gap-0.5 ml-auto chat-history drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] items-end">
			{#each messagesToDisplay as message}
				<div
					class={`flex gap-1 justify-center items-center chat-line py-1 pl-2.5 pr-2 text-center text-white ${message.isStateUpdate ? 'font-semibold' : ''}`}>
					<p>{message.message}</p>
					<p class="text-sm">
						[{message.isStateUpdate ? '' : `${formatSeconds(message.mediaSec)}, `}{new Date(message.timestamp).toLocaleTimeString('en-US', {
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

	<div class="p-4 w-full flex flex-col gap-4 font-semibold">
		<div class="w-full flex gap-2 input-container">
			<div class="flex gap-2">
				<label class="custom-file-upload">
					<Pfp id={playerId} class="w-12 h-12" />
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
										 fetch(`${PUBLIC_HOST}/pfp/${playerId}`, {
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
			<div class="chat-box-main flex-grow">
				<Chatbox send={send} class="input-bordered input-md" />
			</div>
		</div>

		<div class="flex gap-2 w-full items-center justify-center">
			<select
				on:change={(e) => {
				const roomId = e.currentTarget.value;
				window.location.href = `/${roomId}`;
			}}
				bind:value={roomId}
				class="select media-select select-bordered flex-grow">
				<option disabled selected>Which media?</option>
				{#each jobs as job}
					<option value={job.Id}>{job.FileRawName}</option>
				{/each}
			</select>
			<div class="dropdown dropdown-end" id="codec-dropdown">
				<div
					tabindex="0" role="button" class="btn m-1 w-28">{selectedCodec} {(videoSrc?.sCodec && selectedCodec === "auto") ? `(${videoSrc.sCodec})`: ''}</div>
				<ul class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48">
					<li><a tabindex="0" role="button" on:click={()=>{
						onCodecChange("auto")
					}}>Auto</a></li>
					{#if job?.EncodedCodecs}
						{#each job?.EncodedCodecs as codec}
							<li><a tabindex="0" role="button" on:click={()=>{
							onCodecChange(codec)
							}}>{codec}{formatMbps(job, codec)}</a></li>
						{/each}
					{/if}
				</ul>
			</div>
		</div>

		<div class="flex gap-2 self-center">

			<div class="tooltip tooltip-top" data-tip="Ticked: {tickedSecsAgoStr}s ago">
				<button
					id="sync-button"
					class="btn font-bold {socketCommunicating ? 'text-green-600' : 'text-red-600' }">
					{#if socketCommunicating}
						<IconPlugConnected size={24} stroke={2} />
					{:else}
						<IconPlugConnectedX size={24} stroke={2} />
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-top" data-tip={chatHidden ? "Show Chat" : "Hide Chat"}>
				<button id="chat-hide-button" on:click={()=>{
					$chatHiddenStore = !chatHidden;
				}} class="btn font-bold">
					{#if !chatHidden}
						<IconEye size={16} stroke={2} />
						Chat
					{:else}
						<IconEyeOff size={16} stroke={2} />
						Chat
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-top" data-tip={chatPfpHidden ? "Show Avatar in Chat" : "Hide Avatar in Chat"}>
				<button id="chat-hide-button" on:click={()=>{
					chatPfpHidden = !chatPfpHidden;
					localStorage.setItem('chatPfpHidden', chatPfpHidden.toString());
				}} class="btn font-bold">
					{#if !chatPfpHidden}
						<IconAt size={16} stroke={2} />
						Avatar
					{:else}
						<IconAtOff size={16} stroke={2} />
						Avatar
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-top" data-tip={`Theme: ${currentTheme}`}>
				<button id="theme-button" on:click={nextTheme} class="btn font-bold">
					<IconBrightnessHalf size={24} stroke={2} />
				</button>
			</div>
		</div>

		<div class="flex gap-4 sync-states w-full justify-center">
			{#each roomPlayers as player}
				<button
					class="btn btn-neutral border-none h-auto pr-4 py-0 pl-0 rounded-l-full rounded-r-full shadow-md flex gap-3.5">
					<Pfp class="w-12 h-12 mr-0.5" id={player.id} />
					<span class="flex gap-1 flex-col items-center justify-center font-semibold">
						<span class="font-bold">{player.name}</span>
						{#if player.inBg}
							<div class="flex gap-1 items-center justify-center"><IconTableExport size={14}
																																									 stroke={2} /><span>BG</span></div>
						{:else}
							<span>{formatSeconds(player.time)}</span>
						{/if}
					</span>
					{#if player.paused === false}
						<IconPlayerPlayFilled size={18} stroke={2} />
					{:else}
						<IconPlayerPauseFilled size={18} stroke={2} />
					{/if}
				</button>
			{/each}
		</div>
	</div>


</main>

<style>
    .media-player {
        border: none !important;
        border-radius: unset !important;
        max-height: 100vh;
        max-width: 100vw;
    }

    .media-select {
        width: 20rem;
    }

    .chat-history {
        margin-top: 2rem;
        margin-right: 2rem;
    }

    .chat-line {
        width: fit-content;
        border-radius: 0.5rem;
        background-color: rgba(0, 0, 0, 0.2);
    }

    @media (max-width: 1000px) {

        .input-container {
            flex-direction: column-reverse;
            gap: 1rem;
        }

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

</style>
