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
		languageSrcMap,
		codecMap,
		getSupportedCodecs,
		lightThemes,
		audioTrackFeature,
		formatPair,
		getAudioLocForCodec,
		audiosExistForCodec,
		languageMap
	} from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import {
		IconAlertOctagonFilled,
		IconBrightnessHalf, IconCone, IconConePlus, IconEye, IconEyeOff,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconPlugConnected,
		IconPlugConnectedX, IconTableExport
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import { chatFocusedStore, chatHiddenStore, metadataStore, pfpLastFetched } from '../../store';
	import SUPtitles from '$lib/suptitles/suptitles';

	import JASSUB from 'jassub';

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
	let job: Job;
	let roomId = $page.params.id || '';
	let lastTicked = 0;
	let tickedSecsAgo = 0;
	let tickedSecsAgoStr = '0';
	let socketConnected = false;
	let messagesToDisplay: Chat[] = [];
	let controlsToDisplay: SendPayload[] = [];
	let selectedCodec = localStorage.getItem('sCodec') || 'auto';
	let selectedAudioMapping = localStorage.getItem('preferredAudio') || 'jpn';
	let pauseSend = false;
	let supportedCodecs: string[] = [];
	let interactedWithPlayer = false;
	let currentTheme = localStorage.getItem('theme') || defaultTheme;
	let chatHidden = false;
	let lastSentTime = -100;
	let chatFocused = false;
	let chatDisplay: string = localStorage.getItem('chatDisplay') ? localStorage.getItem('chatDisplay')! : 'simple';
	let metadata: any;
	let videoSrc: any = [];
	const unsubscribeMetadata = metadataStore.subscribe((value) => {
		metadata = value;
		job = metadata.job;
	});
	let sup: any;
	let prevTrackSrc: string = '';
	let footer: string = '';
	let onPlay = () => {
	};
	let onPause = () => {
	};
	let onSeeked = () => {
	};
	let onSeeking = () => {
	};
	let audio: HTMLAudioElement;
	const audioTracks: any[] = [];
	let selectedAudioTrack = -1;
	let videoLoaded = false;
	let audioLoaded = false;
	$: audioVideoLoaded = videoLoaded && audioLoaded;
	let videoListenersAttached = false;
	let internalPaused = false;
	let pausedBeforeLoading = false;
	const unsubscribeChatHidden = chatHiddenStore.subscribe((value) => chatHidden = value);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	$: thumbnailVttSrc = `${PUBLIC_HOST}/static/${roomId}/storyboard.vtt`;
	$: socketCommunicating = socketConnected && (tickedSecsAgo >= 0 && tickedSecsAgo < 5);

	$: {
		console.log(metadata);
		console.log('srcList:', videoSrc);
	}

	$: audioTrackEnabled = selectedAudioTrack >= 0;

	function internalPause() {
		if (player) {
			audio.currentTime = player.currentTime;
			player.pause();
			audio.pause();
			internalPaused = true;
		}
	}

	function internalPlay() {
		if (player) {
			player.play();
			audio.play();
			internalPaused = false;
		}
	}

	$: {
		if (audioTrackEnabled) {
			console.log('audioVideoLoaded', audioVideoLoaded, pausedBeforeLoading, internalPaused);
			if (!pausedBeforeLoading) {
				if (audioVideoLoaded && internalPaused) {
					internalPlay();
				} else if (!audioVideoLoaded && !internalPaused) {
					internalPause();
				}
			}
		}
	}

	onDestroy(() => {
		unsubscribeChatHidden();
		unsubscribeChatFocused();
		unsubscribeMetadata();
	});

	function setVideoSrc(onChange = () => {
	}) {
		if (job) {
			const prevCodec = videoSrc?.sCodec;
			let autoCodec;
			for (const codec of supportedCodecs) {
				if (job?.EncodedCodecs.includes(codec)) {
					autoCodec = codec;
					break;
				}
			}
			if (!autoCodec) {
				autoCodec = job?.EncodedCodecs[0];
			}
			const getVideoSrc = (codec: string) => {
				console.log('codec', codec, codecMap[codec]);
				return {
					src: `${PUBLIC_HOST}/static/${roomId}/${getAudioLocForCodec(job, codec, selectedAudioMapping)}.mp4`,
					type: 'video/mp4',
					codec: codecMap[codec],
					sCodec: codec
				};
			};
			if (selectedCodec === 'auto' && prevCodec !== autoCodec) {
				videoSrc = getVideoSrc(autoCodec);
				onChange();
			} else if (selectedCodec !== 'auto' && prevCodec !== selectedCodec) {
				videoSrc = getVideoSrc(selectedCodec);
				console.log('selected codec', selectedCodec, codecMap[selectedCodec]);
				onChange();
			}

		}
	}

	function nextTheme() {
		const html = document.querySelector('html');
		const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length];
		html?.setAttribute('data-theme', nextTheme);
		localStorage.setItem('theme', nextTheme);
		currentTheme = nextTheme;
	}

	function onCodecChange(selected: string) {
		selectedCodec = selected;
		localStorage.setItem('sCodec', selectedCodec);
		setVideoSrc(() => {
			window.location.reload();
		});
	}

	$:{
		if (selectedCodec !== 'auto' && job?.EncodedCodecs && job?.EncodedCodecs.length > 0 && !job?.EncodedCodecs.includes(selectedCodec)) {
			console.log('setting codec - no matching codec', selectedCodec, job?.EncodedCodecs);
			onCodecChange('auto');
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
							player.currentTime = state.time;
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
			if (job.Subtitles) {
				for (const [, sub] of Object.entries(job.Subtitles)) {
					const enc = sub.Enc;
					if (enc) {
						const loc = `${PUBLIC_HOST}/static/${roomId}/${enc.Location}`;
						player.textTracks.add({
							src: loc,
							label: formatPair(sub, true),
							kind: 'subtitles',
							type: enc.CodecName.includes('vtt') ? 'vtt' : enc.CodecName.includes('ass') ? 'asshuh' : 'srt',
							language: languageSrcMap[enc.Language] || enc.Language,
							default: enc.Language.includes('eng')
						});
					}
				}
			}
			if (job.Audios && audioTrackFeature) {
				let counter = 0;
				selectedAudioTrack = -1;
				for (const [, sub] of Object.entries(job.Audios)) {
					const enc = sub.Enc;
					if (enc) {
						const loc = `${PUBLIC_HOST}/static/${roomId}/${enc.Location}`;
						audio.src = loc;
						audioTracks.push({
							src: loc,
							kind: 'audio',
							language: languageSrcMap[enc.Language] || enc.Language
						});
						if (enc.Language.includes('jp')) {
							selectedAudioTrack = counter;
						}
					}
					counter++;
				}
				if (audioTracks.length > 0 && selectedAudioTrack < 0) {
					selectedAudioTrack = 0;
				}
			}
			player.controlsDelay = 1600;
		}
		console.debug('textTracks: ' + JSON.stringify(player.textTracks));
	}

	onMount(() => {
		updateList();
		supportedCodecs = getSupportedCodecs();
		setVideoSrc();
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
		const playerUnsubscribe = player.subscribe(({ controlsVisible }) => {
			controlsShowing = controlsVisible;
		});
		const playerAudioUnsubscribe = player.subscribe(({ volume, muted }) => {
			if (audioTrackEnabled) {
				audio.volume = volume;
				audio.muted = muted;
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
			const videoElement = document.querySelector('media-provider video') as HTMLVideoElement;
			if (videoElement) {
				if (!videoListenersAttached && audioTrackFeature) {
					videoElement.addEventListener('canplay', () => {
						console.log('Video canplay');
						videoLoaded = true;
					});
					videoElement.addEventListener('waiting', () => {
						console.log('Video waiting');
						videoLoaded = false;
					});
					videoElement.addEventListener('stalled', () => {
						console.log('Video stalled');
						videoLoaded = false;
					});
				}
				const selectedTrack = player.textTracks.selected;
				if (selectedTrack?.src) {
					const dispose = () => {
						if (sup != null) {
							sup.dispose();
							onPlay = () => {
							};
							onPause = () => {
							};
							onSeeked = () => {
							};
							onSeeking = () => {
							};
						}
					};
					if (prevTrackSrc !== selectedTrack.src) {
						dispose();
						const ext = selectedTrack.src.slice(-4);
						if (ext.includes('sup')) {
							console.log('sup', selectedTrack.src);
							fetch(selectedTrack.src)
								.then(response => response.arrayBuffer())
								.then(buffer => {
									const file = new Uint8Array(buffer);
									sup = new SUPtitles(videoElement, file, () => {
										return player.currentTime * 1000;
									});
									onPlay = sup.playHandler;
									onPause = sup.pauseHandler;
									onSeeked = sup.seekedHandler;
									onSeeking = sup.seekingHandler;
								});
						} else if (ext.includes('ass')) {
							let canvas = document.getElementById('ass-canvas') as HTMLCanvasElement;
							if (!canvas) {
								canvas = document.createElement('canvas');
								canvas.height = 1080;
								canvas.width = 1920;
								canvas.style.width = '100%';
								canvas.style.height = '100%';
								canvas.style.top = '0';
								canvas.style.left = '0';
								canvas.style.position = 'absolute';
								canvas.style.pointerEvents = 'none';
								canvas.id = 'ass-canvas';
								videoElement.parentNode?.appendChild(canvas);
							}
							new JASSUB({
								video: videoElement,
								canvas: canvas,
								subUrl: selectedTrack.src,
								offscreenRender: false,
								workerUrl: '/scripts/jassub-worker.js',
								wasmUrl: '/scripts/jassub-worker.wasm'
							});
						}
						prevTrackSrc = selectedTrack.src;
					}
				}
			}
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
			playerAudioUnsubscribe();
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
	{#if audioTrackFeature}
		<audio
			on:canplay={()=>{
			console.log("Audio canplay")
			audioLoaded = true;
		}}
			on:waiting={()=>{
			console.log("Audio waiting")
			audioLoaded = false;
		}}
			on:stalled={()=>{
			console.log("Audio stalled")
			audioLoaded = false;
		}}
			class="hidden" bind:this={audio} />
	{/if}
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
		class="media-player bg-slate-900 aspect-video relative w-full"
		src={videoSrc}
		crossorigin
		bind:this={player}
		playsInline
		on:seeked={()=>{
			onSeeked()
		}}
		on:seeking={()=>{
			onSeeking()
			if (audioTrackEnabled) {
				audio.currentTime = player.currentTime;
			}
		}}
		on:pause={
			() => {
				send({ paused: true, type: SyncTypes.PauseSync });
				onPause()
				if(audioTrackEnabled && audioVideoLoaded) {
					audio.pause()
					pausedBeforeLoading = true;
				}
			}}
		on:play={
			() => {
				if(interactedWithPlayer) {
					send({ paused: false, type: SyncTypes.PauseSync });
				}else{
					interactedWithPlayer = true;
					connect();
				}
				onPlay()
				if(audioTrackEnabled && audioVideoLoaded) {
					audio.play()
					pausedBeforeLoading = false;
				}
			}}
	>
		<media-provider
			class="aspect-video media-provider {(!audioVideoLoaded && audioTrackEnabled) ? 'invisible':'visible'}"></media-provider>
		<media-video-layout class="{(!audioVideoLoaded && audioTrackEnabled) ? 'invisible':'visible'}"
												colorScheme={lightThemes.includes(currentTheme) ? "light" : "dark"}
												thumbnails={thumbnailVttSrc}></media-video-layout>
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
						[{(message.isStateUpdate || chatDisplay !== "full") ? '' : `${formatSeconds(message.mediaSec)}, `}{new Date(message.timestamp).toLocaleTimeString('en-US', {
						hour: '2-digit',
						minute: '2-digit'
					})}]
					</p>

					<p>{message.username}</p>
					{#if chatDisplay === "full"}
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
			{#if audiosExistForCodec(job, videoSrc?.sCodec)}
				<div class="dropdown dropdown-left" id="codec-dropdown">
					<div
						tabindex="0" role="button"
						class="btn m-1 w-44">{getAudioLocForCodec(job, videoSrc?.sCodec, selectedAudioMapping)
						? `${(languageMap[selectedAudioMapping] || selectedAudioMapping)}` : "Audio"}</div>
					<ul class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48">
						{#each Object.values(job.MappedAudio[videoSrc?.sCodec]) as am}
							{#if am.Enc}
								<li><a
									class={selectedAudioMapping === am.Enc.Language? "selected-dropdown" : ""}
									tabindex="0" role="button" on:click={()=>{
									selectedAudioMapping = am.Enc.Language;
									localStorage.setItem('preferredAudio', selectedAudioMapping);
									window.location.reload();
							}}>
									{formatPair(am)}
								</a></li>
							{/if}
						{/each}
					</ul>
				</div>
			{/if}
			<div class="dropdown dropdown-left" id="codec-dropdown">
				<div
					tabindex="0" role="button"
					class="btn m-1 w-28">{selectedCodec} {(videoSrc?.sCodec && selectedCodec === "auto") ? `(${videoSrc.sCodec})` : ''}</div>
				<ul class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48">
					<li><a
						class={selectedCodec === "auto"? "selected-dropdown" : ""}
						tabindex="0" role="button" on:click={()=>{
						onCodecChange("auto")
					}}>Auto</a></li>
					{#if job?.EncodedCodecs}
						{#each job?.EncodedCodecs as codec}
							<li><a
								class={selectedCodec === codec? "selected-dropdown" : ""}
								tabindex="0" role="button" on:click={()=>{
							onCodecChange(codec)
							}}>
								{codec}{formatMbps(job, codec)}
								{#if !supportedCodecs.includes(codec)}
									<IconAlertOctagonFilled size={16} stroke={2} />
								{/if}
							</a></li>
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
			<div class="tooltip tooltip-top"
					 data-tip={chatDisplay === "full" ? "Switch to simple chat layout" : "Switch to full chat layout"}>
				<button id="chat-hide-button" on:click={()=>{
					chatDisplay = chatDisplay === "full" ? "simple" : "full";
					localStorage.setItem('chatDisplay', chatDisplay);
				}} class="btn font-bold">
					{#if chatDisplay === "full"}
						<IconConePlus size={16} stroke={2} />
						Full
					{:else}
						<IconCone size={16} stroke={2} />
						Simple
					{/if}
				</button>
			</div>
			<div class="tooltip tooltip-top" data-tip={`Theme: ${currentTheme}`}>
				<button id="theme-button" on:click={nextTheme} class="btn font-bold">
					<IconBrightnessHalf size={24} stroke={2} />
				</button>
			</div>
		</div>

		<div class="flex gap-4 sync-states w-full justify-center mb-16">
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

	<div class="mt-auto bottom-0 mb-4 w-full flex px-4">
		{#if footer}
			<div class="badge badge-outline">{footer}</div>
		{/if}
	</div>
</main>

<style>
    .media-player {
        border: none !important;
        border-radius: unset !important;
        max-height: 100vh;
        max-width: 100vw;
        display: flex;
        justify-content: center;
        flex-direction: column;
    }

    .media-provider {
        width: auto !important;
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
