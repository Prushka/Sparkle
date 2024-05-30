<script lang="ts">
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		formatSeconds,
		type Job,
		type Chat,
		type Player,
		SyncTypes,
		type SendPayload,
		formatMbps,
		languageSrcMap,
		codecMap,
		getSupportedCodecs,
		formatPair,
		getAudioLocForCodec,
		audiosExistForCodec,
		fallbackFontsMap,
		defaultFallback,
		chatLayouts,
		BroadcastTypes,
		codecDisplayMap,
		setGetLS,
		randomString,
		languageMap,
		setGetLsBoolean,
		setGetLsNumber, sortTracks, type ServerData, getLeftAndJoined
	} from './t';
	import { PUBLIC_BE, PUBLIC_STATIC, PUBLIC_WS } from '$env/static/public';
	import {
		IconAlertOctagonFilled, IconArrowBounce,
		IconCone, IconConePlus, IconEyeOff, IconLayout2, IconMoonFilled,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconSettings2, IconSunFilled,
		IconTableExport
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import {
		chatFocusedStore,
		chatLayoutStore,
		interactedStore,
		pageReloadCounterStore, playersStore, updatePfp
	} from '../../store';
	import SUPtitles from '$lib/suptitles/suptitles';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	import JASSUB from 'jassub';
	import { goto } from '$app/navigation';
	import { mode, setMode } from 'mode-watcher';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import ConnectButton from '$lib/player/ConnectButton.svelte';
	import MediaSelection from '$lib/player/MediaSelection.svelte';
	import MoveToast from '$lib/player/MoveToast.svelte';

	export let data: ServerData;
	const { jobs, job } = data;
	let controlsShowing = false;
	let player: MediaPlayerElement;
	let socket: WebSocket;
	let name = setGetLS('name', `Anon-${randomString(4)}`, (v: string) => {
		toast.message(`Using placeholder name: ${v}`, {
			description: `Change your name using the input next to your avatar`,
			duration: 8000,
			position: "top-left"
		});
	});
	let playerId: string = setGetLS('id', randomString(14));
	let pfp: File;
	let pfpInput: HTMLInputElement;
	let roomPlayers: Player[] = [];
	let roomMessages: Chat[] = [];
	let roomId = job.Id;
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
	let interacted = false;
	let lastSentTime = -100;
	let chatFocused = false;
	let videoSrc: any = [];
	let fonts: string[] = [];
	let sup: any;
	let jas: any;
	let currentTheme: 'light' | 'dark';
	let prevTrackSrc: string | null | undefined = '';
	let syncGoto = setGetLsBoolean('syncGoto', true);
	let playerVolume = setGetLsNumber('volume', 1);
	let notificationAudio = new Audio(`${PUBLIC_STATIC}/sound/anya_peanuts.mp3`);
	let inBg = false;
	let onPlay = () => {
	};
	let onPause = () => {
	};
	let onSeeked = () => {
	};
	let onSeeking = () => {
	};
	let chatLayout: string;
	let mediaSelection: any;
	let canvas: HTMLCanvasElement;
	const unsubscribeChatLayout = chatLayoutStore.subscribe((value) => chatLayout = value);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	const unsubscribeMode = mode.subscribe((value) => {
		if (!value) {
			value = 'dark';
		}
		currentTheme = value;
	});
	const unsubscribeInteracted = interactedStore.subscribe((value) => interacted = value);
	let exited = false;
	let nameEmptyDialog = false;
	$: BASE_STATIC = `${PUBLIC_STATIC}/${roomId}`;
	$: thumbnailVttSrc = `${BASE_STATIC}/storyboard.vtt`;
	$: socketCommunicating = socketConnected && (tickedSecsAgo >= 0 && tickedSecsAgo < 5);
	$: autoCodec = (videoSrc?.sCodec && selectedCodec === 'auto') ? `(${codecDisplayMap[videoSrc.sCodec]})` : '';

	$: chatHidden = chatLayout === 'hidden';
	$: {
		console.log('srcList:', videoSrc);
	}
	$: updatePlayers(roomPlayers, socketCommunicating);
	$:{
		if (selectedCodec !== 'auto' && job.EncodedCodecs && job.EncodedCodecs.length > 0 && !job?.EncodedCodecs.includes(selectedCodec)) {
			console.log('setting codec - no matching codec', selectedCodec, job.EncodedCodecs);
			onCodecChange('auto');
		}
	}

	function updatePlayers(players: Player[], socketCommunicating: boolean) {
		if (!socketCommunicating) {
			playersStore.set(-1);
		} else {
			playersStore.set(players.length);
		}
	}

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
		const setVideoSrc = (codec: string) => {
			const prevAudio = selectedAudioMapping;
			const audioExists = job.MappedAudio[codec]?.find((am) => {
				if (am.Language === selectedAudioMapping) {
					return true;
				}
			});
			if (!audioExists && job.MappedAudio[codec] && job.MappedAudio[codec].length > 0) {
				selectedAudioMapping = job.MappedAudio[codec][0].Language;
			}
			console.log('codec', codec, codecMap[codec], prevAudio, selectedAudioMapping);
			videoSrc = {
				src: `${BASE_STATIC}/${getAudioLocForCodec(job, codec, selectedAudioMapping)}.mp4`,
				type: 'video/mp4',
				codec: codecMap[codec],
				sCodec: codec
			};
			sendSettings();
			player.title = `${job.Input}`;
			player.artist = 'Let\'s watch anime!';
		};
		if (selectedCodec === 'auto' && prevCodec !== autoCodec) {
			setVideoSrc(autoCodec);
			onChange();
		} else if (selectedCodec !== 'auto' && prevCodec !== selectedCodec) {
			setVideoSrc(selectedCodec);
			console.log('selected codec', selectedCodec, codecMap[selectedCodec]);
			onChange();
		}
	}

	function onCodecChange(selected: string) {
		selectedCodec = selected;
		localStorage.setItem('sCodec', selectedCodec);
		setVideoSrc(() => {
			$pageReloadCounterStore++;
		});
	}

	function sendSettings() {
		send({ type: SyncTypes.SubtitleSwitch, subtitle: player?.textTracks?.selected?.src });
		send({ type: SyncTypes.AudioSwitch, audio: selectedAudioMapping });
		send({ type: SyncTypes.CodecSwitch, codec: `${selectedCodec},${videoSrc?.sCodec}` });
	}

	function connect() {
		if (!interacted) {
			return;
		}
		socket = new WebSocket(`${PUBLIC_WS}/sync/${roomId}/${playerId}`);
		console.log(`Socket, connecting to ${roomId}`);
		socket.onopen = () => {
			console.log(`Socket, connected to ${roomId}`);
			socketConnected = true;
			if (name !== '') {
				send({ name: name, type: SyncTypes.NameSync });
			}
			send({ type: SyncTypes.NewPlayer });
			sendSettings();
		};

		socket.onmessage = (event: MessageEvent) => {
			const state: SendPayload = JSON.parse(event.data);
			const broadcast = state.broadcast;
			const persistControlState = (state: any) => {
				if (state.firedBy !== undefined) {
					controlsToDisplay.push(state);
					updateMessages();
				}
			};
			if (player) {
				console.debug('received: ' + JSON.stringify(state));
				const initiateMoveTo = (jobs: Job[]) => {
					toast.loading(MoveToast, {
						duration: 20000,
						unstyled: true,
						class: '!bg-transparent !w-full',
						position: 'bottom-center',
						important: true,
						dismissable: false,
						componentProps: {
							seconds: 7,
							job: jobs.find((job: Job) => job.Id === broadcast!.moveTo),
							firedBy: state.firedBy
						}
					});
					state.moveToText = jobs.find((job) => job.Id === state.broadcast!.moveTo)?.Input;
					controlsToDisplay.push(state);
					updateMessages();
				};
				let left, joined: Player[];
				switch (state.type) {
					case SyncTypes.PfpSync:
						if (state.firedBy?.id) {
							updatePfp(state.firedBy.id);
						}
						break;
					case SyncTypes.ChatSync:
						if (inBg && getLatestMessageTimestamp() !== state.chats[state.chats.length - 1]?.timestamp) {
							notificationAudio.play();
						}
						roomMessages = state.chats;
						updateMessages();
						break;
					case SyncTypes.PlayersStatusSync:
						if (roomPlayers.length > 0) {
							({ left, joined } = getLeftAndJoined(roomPlayers, state.players, playerId));
							for (const player of left) {
								controlsToDisplay.push({
									...state,
									type: SyncTypes.PlayerLeft,
									firedBy: player
								});
							}
							for (const player of joined) {
								controlsToDisplay.push({
									...state,
									type: SyncTypes.PlayerJoined,
									firedBy: player
								});
							}
							if (left.length > 0 || joined.length > 0) {
								updateMessages();
							}
						}
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
					case SyncTypes.BroadcastSync:
						switch (broadcast?.type) {
							case BroadcastTypes.MoveTo:
								if (!jobs.find((job) => job.Id === broadcast.moveTo)) {
									mediaSelection.updateList((jobs: Job[]) => {
										initiateMoveTo(jobs);
									});
								} else {
									initiateMoveTo(jobs);
								}
								break;
						}
						break;
					case SyncTypes.ExitSync:
						exited = true;
						$pageReloadCounterStore++;
						break;
				}
			}
		};

		socket.onerror = function() {
			console.error('Socket encountered error');
			socket.close();
		};

		socket.onclose = () => {
			console.log(`Socket closed, ${roomId}`);
			socketConnected = false;
			if (!exited) {
				setTimeout(function() {
					console.log(`Socket reconnecting, ${roomId}`);
					connect();
				}, 1000);
			}
		};
	}

	function send(data: any) {
		if (player && socketConnected && !pauseSend && interacted) {
			console.log('sending: ' + JSON.stringify(data));
			socket.send(JSON.stringify(data));
		}
	}

	function getLatestMessageTimestamp() {
		for (let i = roomMessages.length - 1; i >= 0; i--) {
			if (!roomMessages[i].isStateUpdate) {
				return roomMessages[i].timestamp;
			}
		}
		return 0;
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
					message: control.type === SyncTypes.PauseSync ? (control.paused ? 'Paused' : 'Resumed') :
						control.type === SyncTypes.TimeSync ? 'Seeked to ' + formatSeconds(control.time) :
							control.type === SyncTypes.BroadcastSync ? `Moving to [${control.moveToText}] in 7 Seconds` :
								control.type === SyncTypes.PlayerLeft ? 'Left' :
									control.type === SyncTypes.PlayerJoined ? 'Joined' : '',
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
			job.Streams = sortTracks(job);
			let defaulted = false;
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
							default: !defaulted
						});
						defaulted = true;
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
				sup = null;
			}
			if (jas != null) {
				jas.destroy();
				console.log('destroyed jas');
				jas = null;
			}
			canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
		};
		player.volume = playerVolume;
		supportedCodecs = getSupportedCodecs();
		setVideoSrc();
		reloadPlayer();
		const visibilityChange = () => {
			if (document.hidden) {
				send({ state: 'bg', type: SyncTypes.StateSync });
				inBg = true;
			} else {
				send({ state: 'fg', type: SyncTypes.StateSync });
				inBg = false;
			}
		};
		document.addEventListener('visibilitychange', visibilityChange);
		const playerUnsubscribe = player.subscribe(({ controlsVisible }) => {
			controlsShowing = controlsVisible;
		});
		const playerCanPlayUnsubscribe = player.subscribe(({ canPlay }) => {
			if (canPlay && interacted && !socket) {
				connect();
			}
		});
		const playerSoundUnsubscribe = player.subscribe(({ volume }) => {
			playerVolume = volume;
			localStorage.setItem('volume', volume.toString());
		});
		const i = setInterval(() => {
			updateTime();
			if (!document.getElementById('chat-input')) {
				console.log('mounting chat');
				const node = document.querySelector('media-title');
				if (node) {
					const container = document.createElement('div');
					container.classList.add('max-md:hidden');
					node.parentNode?.insertBefore(container, node.nextSibling);
					new Chatbox({
						target: container,
						props: {
							send: send,
							chatFocused: chatFocused,
							focusByShortcut: true,
							controlsShowing: null,
							class: 'chat-pc',
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
				const selectedTrack = player?.textTracks?.selected;
				if (prevTrackSrc !== selectedTrack?.src) {
					dispose();
					send({ type: SyncTypes.SubtitleSwitch, subtitle: selectedTrack?.src });
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
										sup.playHandler();
									}
								});
						} else if (ext.includes('ass')) {
							console.log('ass', selectedTrack.src);
							const fallback: string[] = fallbackFontsMap[selectedTrack.language] ? fallbackFontsMap[selectedTrack.language] : defaultFallback;
							const availableFonts = {
								[fallback[0]]: fallback[1]
							};
							jas = new JASSUB({
								video: videoElement,
								canvas: canvas,
								subUrl: selectedTrack.src,
								offscreenRender: true,
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
			nameEmptyDialog = true;
		}
		const chatOverlay = document.getElementById('chat-overlay');
		player.appendChild(chatOverlay!);
		return () => {
			exited = true;
			socket?.close();
			clearInterval(i);
			dispose();
			playerUnsubscribe();
			playerCanPlayUnsubscribe();
			playerSoundUnsubscribe();
			document.removeEventListener('visibilitychange', () => {
				visibilityChange;
			});

			unsubscribeChatLayout();
			unsubscribeChatFocused();
			unsubscribeMode();
			unsubscribeInteracted();
			player.destroy();
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
	<Dialog.Root closeOnEscape={false} closeOnOutsideClick={false} bind:open={nameEmptyDialog}>
		<Dialog.Trigger />
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Edit profile</Dialog.Title>
				<Dialog.Description>
					Make changes to your name. Name is REQUIRED for syncing.
				</Dialog.Description>
			</Dialog.Header>
			<div class="grid w-full items-center gap-1.5">
				<Label>Name</Label>
				<Input
					on:focusout={() => {
					send({
					  type: SyncTypes.NameSync,
						name: name
					})
				localStorage.setItem("name", name)
			}}
					bind:value={name} type="text" class="grow focus-visible:ring-transparent" placeholder="Name?" />
			</div>
			<Dialog.Footer>
				<Button type="submit" on:click={()=>{
					nameEmptyDialog = false;
				}} disabled={name === ""}>Save changes
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
	<media-player
		keep-alive
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
				if(interacted) {
					send({ paused: false, type: SyncTypes.PauseSync });
				}else{
					$interactedStore = true;
					connect();
				}
				onPlay()
			}}
	>
		<media-provider
			class="aspect-video media-provider">
			<media-poster
				class="vds-poster"
				src={data.preview}
			></media-poster>
			<canvas bind:this={canvas} id="sub-canvas" class="pointer-events-none absolute top-0 left-0 w-full h-full"
							width="1920" height="1080" />
		</media-provider>
		<media-video-layout colorScheme={currentTheme}
												thumbnails={thumbnailVttSrc}></media-video-layout>
	</media-player>

	<div class="flex gap-1 w-full h-full absolute pointer-events-none z-50" id="chat-overlay"
			 style={chatHidden ? 'display: none' : ''}
	>
		<div
			class="{controlsShowing ? 'max-md:!mt-10':''} flex flex-col gap-0.5 ml-auto chat-history drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] items-end">
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
		<div class="w-full flex gap-4 items-center justify-center max-md:flex-col max-w-[90rem] self-center">
			<div class="flex gap-3 items-center justify-center max-md:w-full">
				<label class="custom-file-upload">
					<Pfp id={playerId} class="w-12 h-12" />
					<input accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
								 bind:this={pfpInput}
								 on:change={() => {
							 const ppfp = pfpInput?.files;
							 if (ppfp && ppfp[0]) {
								 if(ppfp[0].size > 12000000) {
									 toast.error("File size too large", {
      							description: "Max file size: 10MB",
      							duration: 5000,
    										})
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
												 updatePfp(playerId);
											});
									 }
								 };
								 reader.readAsDataURL(pfp);
							 }
						 }}
								 type="file" />
				</label>
				<Input
					on:focusout={() => {
					send({
					  type: SyncTypes.NameSync,
						name: name
					})
				localStorage.setItem("name", name)
			}}
					bind:value={name} type="text" class="focus-visible:ring-transparent w-auto max-md:grow" placeholder="Name" />
			</div>
			<Chatbox id="chat-mobile" bind:controlsShowing send={send} class="input-bordered input-md grow max-md:w-full" />
		</div>

		<Card.Root class="w-full max-w-[90rem] self-center">
			<Card.Header class="max-sm:px-4 max-sm:pt-4 max-sm:pb-0">
				<div class="flex gap-3 justify-center items-center">
					<div class="flex flex-col gap-1 max-sm:mr-4 flex-1">
						<Card.Title>Media</Card.Title>
						<Card.Description class="max-sm:hidden">Codec: {selectedCodec} {autoCodec},
							Audio: {languageMap[selectedAudioMapping] || selectedAudioMapping}</Card.Description>
					</div>
					<ConnectButton bind:socketCommunicating bind:interacted bind:exited bind:tickedSecsAgoStr
												 class="max-md:hidden"
												 onClick={() => {
						if(!socketCommunicating && !interacted) {
							player?.play()
								}}}
					/>
					<div class="flex gap-3 items-center justify-end flex-1">
						<Tooltip.Root openDelay={0}>
							<Tooltip.Trigger asChild let:builder>
								<Button builders={[builder]} variant={!socketCommunicating || !syncGoto ? "ghost" : "outline"}
												class="w-9 h-9 p-1 {(!socketCommunicating || !syncGoto) ? 'opacity-50' :''}"
												on:click={()=>{
										 syncGoto = !syncGoto;
										 localStorage.setItem('syncGoto', syncGoto.toString());
									 }}
												disabled={!socketCommunicating}>
									<IconArrowBounce size={syncGoto ? 20 : 18} stroke={2} />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								<p>Move users in room with you (on media change)</p>
							</Tooltip.Content>
						</Tooltip.Root>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild let:builder>
								<Button variant="outline" builders={[builder]}>
									<IconLayout2 class="sm:mr-2" size={20} stroke={2} />
									<span class="max-sm:hidden">Layout</span>
								</Button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-56">
								<DropdownMenu.Label>Theme</DropdownMenu.Label>
								<DropdownMenu.RadioGroup bind:value={currentTheme}>
									<DropdownMenu.RadioItem value={"light"} on:click={()=>{
								setMode("light")
							}}>
										<IconSunFilled class="mr-2" size={16} stroke={2} />
										Light
									</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value={"dark"} on:click={()=>{
								setMode("dark")
							}}>
										<IconMoonFilled class="mr-2" size={16} stroke={2} />
										Dark
									</DropdownMenu.RadioItem>
								</DropdownMenu.RadioGroup>

								<DropdownMenu.Separator />

								<DropdownMenu.Label>Chat Layout</DropdownMenu.Label>
								<DropdownMenu.RadioGroup bind:value={chatLayout}>
									{#each chatLayouts as layout}
										<DropdownMenu.RadioItem value={layout} on:click={()=>{
								localStorage.setItem('chatLayout', layout);
								$chatLayoutStore = layout;
							}}>
											{#if layout === "extended"}
												<IconConePlus class="mr-2" size={16} stroke={2} />
												Extended
											{:else if layout === "simple"}
												<IconCone class="mr-2" size={16} stroke={2} />
												Simple
											{:else}
												<IconEyeOff class="mr-2" size={16} stroke={2} />
												Hidden
											{/if}
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild let:builder>
								<Button builders={[builder]} variant={currentTheme === "dark" ? "outline" : "default"}>
									<IconSettings2 class="mr-2" size={16} stroke={2} />
									Video <span class="max-sm:hidden">&nbsp;Settings</span></Button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-56">
								<DropdownMenu.Label>
									Video Settings
								</DropdownMenu.Label>
								<DropdownMenu.Separator />
								<DropdownMenu.Group>
									{#if audiosExistForCodec(job, videoSrc?.sCodec)}
										<DropdownMenu.RadioGroup bind:value={selectedAudioMapping}>
											{#each job.MappedAudio[videoSrc?.sCodec] as am}
												<DropdownMenu.RadioItem value={am.Language} on:click={()=>{
								localStorage.setItem('preferredAudio', am.Language);
								$pageReloadCounterStore++;
							}}>{formatPair(am)}</DropdownMenu.RadioItem>
											{/each}
										</DropdownMenu.RadioGroup>
									{/if}
								</DropdownMenu.Group>
								<DropdownMenu.Separator />
								<DropdownMenu.Group>
									<DropdownMenu.RadioGroup bind:value={selectedCodec}>
										<DropdownMenu.RadioItem value={"auto"} on:click={()=>{
									onCodecChange("auto")
							}}>
											Auto {autoCodec}</DropdownMenu.RadioItem>
										{#each job.EncodedCodecs as codec}
											<DropdownMenu.RadioItem value={codec} on:click={()=>{
							onCodecChange(codec)
							}}>
												{codecDisplayMap[codec]}{formatMbps(job, codec)}
												{#if !supportedCodecs.includes(codec)}
													<IconAlertOctagonFilled class="ml-2" size={16} stroke={2} />
												{/if}
											</DropdownMenu.RadioItem>
										{/each}
									</DropdownMenu.RadioGroup>
								</DropdownMenu.Group>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</div>
			</Card.Header>
			<Card.Content
				class="max-sm:p-4">
				<MediaSelection data={data} bind:this={mediaSelection} bounceToOverride={(id)=>{
								if (syncGoto && socketCommunicating && roomPlayers.length > 1) {
										send({
											type: SyncTypes.BroadcastSync,
											broadcast: { type: BroadcastTypes.MoveTo, moveTo: id }
										});
									} else {
										goto(`/${id}`);
									}
							}} />

			</Card.Content>
		</Card.Root>

		<div class="flex gap-3 self-center items-center justify-center w-full md:hidden">
			<ConnectButton bind:socketCommunicating bind:interacted bind:exited bind:tickedSecsAgoStr
										 onClick={() => {
						if(!socketCommunicating && !interacted) {
							player?.play()
								}}}
			/>
		</div>

		<div class="flex gap-4 flex-wrap justify-center mb-3">
			{#each roomPlayers as player}
				<Button variant="outline"
								class="h-auto pr-4 py-0 pl-0 rounded-l-full rounded-r-full flex gap-3.5">
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
				</Button>
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
        display: flex;
        justify-content: center;
        flex-direction: column;
    }

    .media-provider {
        width: auto !important;
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

    @media (max-width: 900px) {

        .chat-history {
            margin-top: 0.5rem;
            margin-right: 0.5rem;
            font-size: 0.64rem;
        }

        .chat-history .text-sm {
            line-height: unset;
            font-size: 0.64rem;
        }
    }

</style>
