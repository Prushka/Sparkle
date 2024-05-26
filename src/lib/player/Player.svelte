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
		formatPair,
		getAudioLocForCodec,
		audiosExistForCodec,
		languageMap, fallbackFontsMap, defaultFallback, chatLayouts
	} from './t';
	import { PUBLIC_BE, PUBLIC_STATIC, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import {
		IconAlertOctagonFilled,
		IconBrightnessHalf, IconCone, IconConePlus, IconEyeOff,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconPlugConnected,
		IconPlugConnectedX, IconTableExport
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import { chatFocusedStore, chatLayoutStore, pfpLastFetched } from '../../store';
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
	export let job: Job;
	export let jobs: Job[];
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
	let lastSentTime = -100;
	let chatFocused = false;
	let videoSrc: any = [];
	let fonts: string[] = [];
	let sup: any;
	let jas: any;
	let prevTrackSrc: string | null | undefined = '';
	let footer: string = '';
	let onPlay = () => {
	};
	let onPause = () => {
	};
	let onSeeked = () => {
	};
	let onSeeking = () => {
	};
	let chatLayout: string;
	const unsubscribeChatLayout = chatLayoutStore.subscribe((value) => chatLayout = value);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	$: BASE_STATIC = `${PUBLIC_STATIC}/${roomId}`;
	$: thumbnailVttSrc = `${BASE_STATIC}/storyboard.vtt`;
	$: socketCommunicating = socketConnected && (tickedSecsAgo >= 0 && tickedSecsAgo < 5);

	$: chatHidden = chatLayout === 'hidden';
	$: {
		console.log('srcList:', videoSrc);
	}

	onDestroy(() => {
		unsubscribeChatLayout();
		unsubscribeChatFocused();
	});

	function setVideoSrc(onChange = () => {
	}) {
		const prevCodec = videoSrc?.sCodec;
		let autoCodec;
		for (const codec of supportedCodecs) {
			if (job.EncodedCodecs.includes(codec)) {
				autoCodec = codec;
				break;
			}
		}
		if (!autoCodec) {
			autoCodec = job.EncodedCodecs[0];
		}
		const getVideoSrc = (codec: string) => {
			console.log('codec', codec, codecMap[codec]);
			return {
				src: `${BASE_STATIC}/${getAudioLocForCodec(job, codec, selectedAudioMapping)}.mp4`,
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
		if (selectedCodec !== 'auto' && job.EncodedCodecs && job.EncodedCodecs.length > 0 && !job?.EncodedCodecs.includes(selectedCodec)) {
			console.log('setting codec - no matching codec', selectedCodec, job.EncodedCodecs);
			onCodecChange('auto');
		}
	}

	$: {
		console.log('selectedAudioMapping', selectedAudioMapping);
		const audioExists = job.MappedAudio[videoSrc?.sCodec]?.find((am) => {
			if (am.Language === selectedAudioMapping) {
				return true;
			}
		});
		if (!audioExists && job.MappedAudio[videoSrc?.sCodec] && job.MappedAudio[videoSrc?.sCodec].length > 0) {
			selectedAudioMapping = job.MappedAudio[videoSrc?.sCodec][0].Language;
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
								[state.firedBy.id]: `${PUBLIC_STATIC}/pfp/${state.firedBy.id}.png?${Date.now()}`
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

	function updateList() {
		fetch(`${PUBLIC_BE}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = data;
				jobs.sort((a, b) => {
					return a.Input.localeCompare(b.Input);
				});
				console.log(jobs);
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
		if (job.Streams) {
			fonts = [];
			for (const [, stream] of Object.entries(job.Streams)) {
				switch (stream.CodecType) {
					case 'attachment':
						if (stream.Filename?.includes('otf') || stream.Filename?.includes('ttf')) {
							fonts.push(`${BASE_STATIC}/${stream.Location}`);
						}
						break;
					case 'subtitle':
						player.textTracks.add({
							src: `${BASE_STATIC}/${stream.Location}`,
							label: formatPair(stream, true, true),
							kind: 'subtitles',
							type: stream.CodecName.includes('vtt') ? 'vtt' : stream.CodecName.includes('ass') ? 'asshuh' : 'srt',
							language: languageSrcMap[stream.Language] || stream.Language,
							default: stream.Language.includes('eng')
						});
						break;
				}
			}
		}
		player.controlsDelay = 1600;
		console.debug('textTracks: ' + JSON.stringify(player.textTracks));
	}

	onMount(() => {
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
				console.log('destroyed sup');
				sup = null
			}
			if (jas != null) {
				jas.destroy();
				let canvas = document.getElementById('ass-canvas') as HTMLCanvasElement;
				if (canvas) {
					canvas.remove();
				}
				console.log('destroyed jas');
				jas = null
			}
		};
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
				const selectedTrack = player.textTracks.selected;
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
				if (prevTrackSrc !== selectedTrack?.src) {
					dispose();
					if (selectedTrack?.src) {
						const ext = selectedTrack.src.slice(-4);
						if (ext.includes('sup')) {
							console.log('sup', selectedTrack.src);
							fetch(selectedTrack.src)
								.then(response => response.arrayBuffer())
								.then(buffer => {
									const file = new Uint8Array(buffer);
									sup = new SUPtitles(canvas, file, () => {
										return player.currentTime * 1000;
									});
									onPlay = sup.playHandler;
									onPause = sup.pauseHandler;
									onSeeked = sup.seekedHandler;
									onSeeking = sup.seekingHandler;
									if (!player.paused) {
										sup.playHandler()
									}
								});
						} else if (ext.includes('ass')) {
							const fallback: string[] = fallbackFontsMap[selectedTrack.language] ? fallbackFontsMap[selectedTrack.language] : defaultFallback;
							const availableFonts = {
								[fallback[0]]: fallback[1]
							};
							jas = new JASSUB({
								video: videoElement,
								canvas: canvas,
								subUrl: selectedTrack.src,
								offscreenRender: false,
								workerUrl: '/scripts/jassub-worker.js',
								wasmUrl: '/scripts/jassub-worker.wasm',
								fallbackFont: fallback[0],
								availableFonts: availableFonts,
								fonts: [...fonts, fallback[1]]
							});
							console.log(fallback, selectedTrack.language);
						}
					}
					prevTrackSrc = selectedTrack?.src;
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
			dispose();
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
		}}
		on:pause={
			() => {
				send({ paused: true, type: SyncTypes.PauseSync });
				onPause()
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
			}}
	>
		<media-provider
			class="aspect-video media-provider"></media-provider>
		<media-video-layout colorScheme={lightThemes.includes(currentTheme) ? "light" : "dark"}
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
						[{(message.isStateUpdate || chatLayout !== "extended") ? '' : `${formatSeconds(message.mediaSec)}, `}{new Date(message.timestamp).toLocaleTimeString('en-US', {
						hour: '2-digit',
						minute: '2-digit'
					})}]
					</p>

					<p>{message.username}</p>
					<Pfp id={message.uid} class="avatar" />
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
										 fetch(`${PUBLIC_BE}/pfp/${playerId}`, {
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

		<div class="gap-4 w-full items-center justify-center sm:flex max-sm:grid max-sm:grid-cols-2">
			<select
				on:change={(e) => {
				const roomId = e.currentTarget.value;
				window.location.href = `/${roomId}`;
			}}
				bind:value={roomId}
				class="select media-select select-bordered flex-grow max-sm:col-span-2">
				<option disabled selected>Which media?</option>
				{#each jobs as job}
					<option value={job.Id}>{job.Input}</option>
				{/each}
			</select>
			{#if audiosExistForCodec(job, videoSrc?.sCodec)}
				<div class="dropdown dropdown-top dropdown-end max-sm:w-full" id="codec-dropdown">
					<div
						tabindex="0" role="button"
						class="btn m-1 w-full sm:w-44">{getAudioLocForCodec(job, videoSrc?.sCodec, selectedAudioMapping)
						? `${(languageMap[selectedAudioMapping] || selectedAudioMapping)}` : "Audio"}</div>
					<ul class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48">
						{#each job.MappedAudio[videoSrc?.sCodec] as am}
							<li><a
								class={selectedAudioMapping === am.Language? "selected-dropdown" : ""}
								tabindex="0" role="button" on:click={()=>{
									localStorage.setItem('preferredAudio', am.Language);
									window.location.reload();
							}}>
								{formatPair(am)}
							</a></li>
						{/each}
					</ul>
				</div>
			{/if}
			<div class="dropdown dropdown-top dropdown-end max-sm:w-full" id="codec-dropdown">
				<div
					tabindex="0" role="button"
					class="btn m-1 sm:w-28 w-full">{selectedCodec} {(videoSrc?.sCodec && selectedCodec === "auto") ? `(${videoSrc.sCodec})` : ''}</div>
				<ul class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48">
					<li><a
						class={selectedCodec === "auto"? "selected-dropdown" : ""}
						tabindex="0" role="button" on:click={()=>{
						onCodecChange("auto")
					}}>Auto</a></li>
					{#if job.EncodedCodecs}
						{#each job.EncodedCodecs as codec}
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

		<div class="max-sm:grid max-sm:grid-cols-2 sm:flex gap-4 self-center items-center justify-center w-full">

			<div class="tooltip tooltip-top max-sm:col-span-2" data-tip="Ticked: {tickedSecsAgoStr}s ago">
				<button
					id="sync-button"
					on:click={() => {
						if(!socketCommunicating && !interactedWithPlayer) {
							player?.play()
						}
					}}
					class="btn font-bold {socketCommunicating ? 'text-green-600' : 'text-red-600' } max-sm:w-full">
					{#if socketCommunicating}
						<IconPlugConnected size={24} stroke={2} />
					{:else}
						<IconPlugConnectedX size={24} stroke={2} />
						{#if !interactedWithPlayer}
							Connect Now
						{:else}
							Connecting...
						{/if}
					{/if}
				</button>
			</div>
			<div class="dropdown dropdown-top max-sm:w-full" id="chat-layout-dropdown">
				<div
					tabindex="0" role="button"
					class="btn m-1 w-40 max-sm:w-full">
					{#if chatLayout === "extended"}
						<IconConePlus size={16} stroke={2} />
						Extended Chat
					{:else if chatLayout === "simple"}
						<IconCone size={16} stroke={2} />
						Simple Chat
					{:else}
						<IconEyeOff size={16} stroke={2} />
						Chat Hidden
					{/if}
				</div>
				<ul class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48 max-sm:w-full">
					{#each chatLayouts as layout}
						<li><a
							class={chatLayout === layout? "selected-dropdown" : ""}
							tabindex="0" role="button" on:click={()=>{
								localStorage.setItem('chatLayout', layout);
								$chatLayoutStore = layout;
							}}>
							{#if layout === "extended"}
								<IconConePlus size={16} stroke={2} />
								Extended Chat
							{:else if layout === "simple"}
								<IconCone size={16} stroke={2} />
								Simple Chat
							{:else}
								<IconEyeOff size={16} stroke={2} />
								Chat Hidden
							{/if}
						</a></li>
					{/each}
				</ul>
			</div>
			<div class="tooltip tooltip-top max-sm:w-full" data-tip={`Theme: ${currentTheme}`}>
				<button id="theme-button" on:click={nextTheme} class="btn font-bold max-sm:w-full">
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
