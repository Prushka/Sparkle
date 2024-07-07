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
		audiosExistForCodec,
		fallbackFontsMap,
		defaultFallback,
		chatLayouts,
		BroadcastTypes,
		codecDisplayMap,
		setGetLS,
		randomString,
		setGetLsBoolean,
		sortTracks,
		type ServerData,
		getLeftAndJoined,
		hideControlsOnChatFocused,
		moveSeconds,
		getTitleComponents
	} from './t';
	import { PUBLIC_BE, PUBLIC_STATIC } from '$env/static/public';
	import {
		IconAlertOctagonFilled, IconArrowBounce, IconCheck,
		IconCone, IconEyeOff, IconLayout2, IconMoonFilled,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconSettings2, IconShare3, IconSunFilled,
		IconTableExport
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import {
		chatFocusedStore,
		chatLayoutStore, currentlyWatching, type Discord, getName,
		interactedStore,
		pageReloadCounterStore, playersStore, updatePfp
	} from '../../store';
	import SUPtitles from '$lib/suptitles/suptitles';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { TextTrack } from 'vidstack';


	import JASSUB from 'jassub';
	import { goto } from '$app/navigation';
	import { mode, setMode } from 'mode-watcher';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import ConnectButton from '$lib/player/ConnectButton.svelte';
	import MediaSelection from '$lib/player/MediaSelection.svelte';
	import MoveToast from '$lib/player/MoveToast.svelte';
	import Chats from '$lib/player/Chats.svelte';

	export let data: ServerData;
	const { job } = data;
	const discord: Discord | null = sessionStorage.getItem('discord') ? JSON.parse(sessionStorage.getItem('discord')!) : null;
	let controlsShowing = false;
	let player: MediaPlayerElement;
	let socket: WebSocket;
	let name = getName(discord?.user) ?? setGetLS('name', `Anon-${randomString(4)}`, (v: string) => {
		toast.message(`Using placeholder name: ${v}`, {
			description: `Change your name using the input next to your avatar`,
			duration: 9000,
			position: 'bottom-left'
		});
	});
	let playerId: string = setGetLS('id', randomString(14));
	let pfp: File;
	let pfpInput: HTMLInputElement;
	let roomPlayers: Player[] = [];
	let historicalPlayers: { [key: string]: Player } = {};
	let roomMessages: Chat[] = [];
	let roomId = discord?.channelId ? discord.channelId : job.Id;
	let lastTicked = 0;
	let tickedSecsAgo = 0;
	let tickedSecsAgoStr = '0';
	let socketConnected = false;
	let messagesToDisplay: Chat[] = [];
	let controlsToDisplay: SendPayload[] = [];
	let selectedCodec = localStorage.getItem('sCodec') || 'auto';
	let selectedAudio = localStorage.getItem('sAudio') || '1-jpn';
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
	let notificationAudio = new Audio(`${PUBLIC_STATIC}/sound/anya_peanuts.mp3`);
	let inBg = false;
	let chatFocusedSecs = 0;
	let copiedRoomLink = false;
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
	$: BASE_STATIC = `${PUBLIC_STATIC}/${job.Id}`;
	$: thumbnailVttSrc = `https://${location.host}${BASE_STATIC}/storyboard.vtt`;
	$: socketCommunicating = socketConnected && (tickedSecsAgo >= 0 && tickedSecsAgo < 5);
	$: autoCodec = (videoSrc?.sCodec && selectedCodec === 'auto') ? `(${codecDisplayMap[videoSrc.sCodec]})` : '';
	$: chatHidden = chatLayout === 'hide';
	$: {
		console.log('srcList:', videoSrc);
	}
	$: updatePlayers(roomPlayers, socketCommunicating);
	$:{
		if (selectedCodec !== 'auto' && job.EncodedCodecs && job.EncodedCodecs.length > 0 && !job.EncodedCodecs.includes(selectedCodec)) {
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
			let stream = job.MappedAudio[codec]?.find((am) => {
				return `${am.Index}-${am.Language}` === selectedAudio;
			});
			if (!stream) {
				stream = job.MappedAudio[codec]?.find((am) => {
					return selectedAudio.split('-').length > 1 && am.Language === selectedAudio.split('-')[1];
				});
				if (!stream) {
					if (job.MappedAudio[codec] && job.MappedAudio[codec].length > 0) {
						stream = job.MappedAudio[codec][0];
					}
				}
			}
			selectedAudio = `${stream?.Index}-${stream?.Language}`;
			console.log('codec', codec, codecMap[codec], selectedAudio);
			videoSrc = {
				src: `${BASE_STATIC}/${codec}-${selectedAudio}.mp4`,
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
		send({ type: SyncTypes.AudioSwitch, audio: selectedAudio });
		send({ type: SyncTypes.CodecSwitch, codec: `${selectedCodec},${videoSrc?.sCodec}` });
	}

	function connect() {
		if (!interacted) {
			return;
		}
		socket = new WebSocket(`wss://${location.host}${PUBLIC_BE}/sync/${roomId}/${playerId}`);
		console.log(`Socket, connecting to ${roomId}`);
		socket.onopen = () => {
			console.log(`Socket, connected to ${roomId}`);
			socketConnected = true;
			if (name !== '') {
				send({ name: name, type: SyncTypes.ProfileSync, discordUser: discord?.user });
			}
			send({ type: SyncTypes.NewPlayer });
			sendSettings();
			updateLastTicked(true);
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
							seconds: moveSeconds,
							historicalPlayers: Object.values(historicalPlayers),
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
						for (const player of roomPlayers) {
							historicalPlayers[player.id] = player;
						}
						updateLastTicked(true);
						currentlyWatching.update((value) => {
							if (value) {
								value.roomPlayers = roomPlayers.length;
								return value;
							}
							return null;
						});
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
								mediaSelection.updateList(broadcast.moveTo, (jobs: Job[]) => {
									initiateMoveTo(jobs);
								});
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

		socket.onerror = function(event) {
			console.error('Socket encountered error: ', event);
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
			return (Date.now() - message.timestamp) < 140000;
		});
		if (player.clientHeight < 250) {
			messagesToDisplay = messagesToDisplay.slice(-4);
		} else if (player.clientHeight < 450) {
			messagesToDisplay = messagesToDisplay.slice(-6);
		} else if (player.clientHeight < 620) {
			messagesToDisplay = messagesToDisplay.slice(-8);
		} else {
			messagesToDisplay = messagesToDisplay.slice(-10);
		}
		for (const control of controlsToDisplay) {
			if (control.firedBy && (Date.now() - control.timestamp) < 8000) {
				const message: Chat = {
					uid: control.firedBy.id,
					message: control.type === SyncTypes.PauseSync ? (control.paused ? 'Paused' : 'Resumed') :
						control.type === SyncTypes.TimeSync ? 'Seeked to ' + formatSeconds(control.time) :
							control.type === SyncTypes.BroadcastSync ? `Moving to [${control.moveToText}] in ${moveSeconds} Seconds` :
								control.type === SyncTypes.PlayerLeft ? 'Left' :
									control.type === SyncTypes.PlayerJoined ? 'Joined' : '',
					timestamp: control.timestamp,
					mediaSec: player.currentTime,
					isStateUpdate: true,
					timeStr: ''
				};
				messagesToDisplay.push(message);
			}
		}
		messagesToDisplay.sort((a, b) => {
			return a.timestamp - b.timestamp;
		});
		for (let i = 0; i < messagesToDisplay.length; i++) {
			let prevTimeStr = '';
			for (let j = i - 1; j >= 0; j--) {
				if (messagesToDisplay[j].timeStr) {
					prevTimeStr = messagesToDisplay[j].timeStr;
					break;
				}
			}
			const currTimeStr = new Date(messagesToDisplay[i].timestamp).toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false
			});
			messagesToDisplay[i].timeStr = prevTimeStr === currTimeStr ? '' : currTimeStr;
		}
	}

	function updateLastTicked(resetTimer: boolean = false) {
		if (resetTimer) {
			lastTicked = Date.now();
		}
		tickedSecsAgo = (socketConnected && roomPlayers.length > 0) ? (Date.now() - lastTicked) / 1000 : -1;
		tickedSecsAgoStr = (Math.round(tickedSecsAgo * 100) / 100).toFixed(2);
	}

	function reloadPlayer() {
		if (job.Streams) {
			fonts = [];
			job.Streams = sortTracks(job);
			let defaulted = false;
			for (const [, stream] of Object.entries(job.Streams)) {
				switch (stream.CodecType) {
					case 'attachment':
						if (stream.Location?.includes('otf') || stream.Location?.includes('ttf')) {
							fonts.push(`${BASE_STATIC}/${stream.Location}`);
						}
						break;
					case 'subtitle':
						player.textTracks.add({
							src: `${BASE_STATIC}/${stream.Location}`,
							label: formatPair(stream, true, true),
							kind: 'subtitles',
							type: stream.Location.slice(-3) === 'vtt' ?
								'vtt' : stream.Location.slice(-3) === 'ass' ?
									'asshuh' : stream.Location.slice(-3) === 'sup' ?
										'sup' : 'srt',
							language: languageSrcMap[stream.Language] || stream.Language,
							default: !defaulted
						});
						defaulted = true;
						break;
				}
			}
		}
		if (job.Chapters && job.Chapters.length > 0) {
			const track = new TextTrack({
				kind: 'chapters',
				language: 'en-US',
				type: 'vtt',
				default: true
			});
			for (const chapter of job.Chapters) {
				if (chapter.tags?.title) {
					track.addCue(new VTTCue(chapter.start, chapter.end, chapter.tags?.title));
				}
			}
			player.textTracks.add(track);
		}
		player.controlsDelay = 1500;
		console.debug('textTracks: ' + JSON.stringify(player.textTracks));
	}

	onMount(() => {
		console.log(job);
		currentlyWatching.update(() => {
			const components = getTitleComponents(job);
			return {
				id: job.Id,
				title: components.title,
				se: components.episodes ? Object.values(components.episodes)[0].se : '',
				seTitle: components.episodes ? Object.values(components.episodes)[0].seTitle : '',
				thumbnail: data.preview,
				timeEntered: Date.now(),
				paused: true,
				totalDuration: 0,
				duration: 0,
				roomPlayers: 1
			};
		});
		if (discord) {
			$interactedStore = true;
		}
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
		let volumeInitialized = false;
		const playerSoundUnsubscribe = player.subscribe(({ volume, muted }) => {
			if (!volumeInitialized) {
				volumeInitialized = true;
			} else {
				localStorage.setItem('volume', volume.toString());
				if (muted) {
					localStorage.setItem('volume', '0');
				}
			}
		});
		const i = setInterval(() => {
			updateTime();
			if (!document.getElementById('chat-pc-form')) {
				console.log('mounting chat');
				const node = document.querySelector('media-title') || document.querySelector('media-chapter-title');
				if (node && node.parentNode && node.nextSibling) {
					const container = document.createElement('div');
					container.classList.add('max-md:hidden');
					node.parentNode.insertBefore(container, node.nextSibling);
					new Chatbox({
						target: container,
						props: {
							send: send,
							chatFocused: chatFocused,
							focusByShortcut: true,
							controlsShowing: null,
							class: 'chat-pc',
							inputId: 'chat-pc-input',
							formId: 'chat-pc-form',
							messages: [],
							historicalPlayers: [],
							onFocus: () => {
								player.controls?.pause();
								$chatFocusedStore = true;
							},
							onBlur: () => {
								player.controls?.resume();
								$chatFocusedStore = false;
								chatFocusedSecs = 0;
							}
						}
					});
				}
			}
			updateMessages();
			updateLastTicked();
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
			if (chatFocused) {
				chatFocusedSecs++;
			} else {
				chatFocusedSecs = 0;
			}
		}, 1000);
		if (localStorage.getItem('volume')) {
			const v = parseFloat(localStorage.getItem('volume')!);
			if (v >= 0 && v <= 1) {
				player.volume = v;
			}
		}
		const chatOverlay = document.getElementById('chat-overlay');
		player.appendChild(chatOverlay!);
		player.hideControlsOnMouseLeave = true;
		const mouseMove = () => {
			chatFocusedSecs = 0;
		};
		document.addEventListener('mousemove', mouseMove);
		return () => {
			exited = true;
			socket?.close();
			clearInterval(i);
			dispose();
			playerUnsubscribe();
			playerCanPlayUnsubscribe();
			playerSoundUnsubscribe();
			document.removeEventListener('visibilitychange', visibilityChange);
			document.removeEventListener('mousemove', mouseMove);

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
			currentlyWatching.update((value) => {
				if (value) {
					value.duration = timeRounded;
					value.totalDuration = job.Duration;
					return value;
				}
				return null;
			});
		}
	}
</script>

<main id="main-page" class="overflow-hidden flex flex-col items-center w-full h-full">
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
		class="media-player bg-slate-900 relative w-full
{player && !player.paused && chatFocusedSecs > hideControlsOnChatFocused ? 'chat-controls-hidden':''}
{discord ? 'h-screen' : ''}"
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
				onPause();
				currentlyWatching.update((value) => {
					if(value) {
						value.paused = true;
						return value;
					}
					return null
				});
			}}
		on:play={
			() => {
				if(interacted) {
					send({ paused: false, type: SyncTypes.PauseSync });
					currentlyWatching.update((value) => {
						if(value) {
							value.paused = false;
							return value;
						}
						return null
					});
				}else{
					$interactedStore = true;
					connect();
				}
				onPlay()
			}}
	>
		<media-provider
			class="media-provider w-full h-full">
			<media-poster
				class="vds-poster"
				src={data.preview}
			></media-poster>
			<canvas bind:this={canvas} id="sub-canvas" class="pointer-events-none absolute" />
		</media-provider>
		<media-video-layout colorScheme={currentTheme}
												thumbnails={thumbnailVttSrc}></media-video-layout>
	</media-player>

	<div class="flex gap-1 w-full h-full absolute pointer-events-none z-50" id="chat-overlay"
			 style={chatHidden ? 'display: none' : ''}
	>
		<Chats bind:controlsShowing bind:messagesToDisplay bind:historicalPlayers />
	</div>

	<div class="p-4 w-full flex flex-col gap-4 font-semibold">
		<div class="w-full flex gap-4 items-center justify-center max-md:flex-col max-w-[90rem] self-center">
			<div class="flex gap-3 items-center justify-center max-md:w-full">
				<label class="custom-file-upload">
					<Pfp id={playerId} class="w-12 h-12" discordUser={discord?.user} />
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
					disabled={getName(discord?.user) !== undefined}
					on:focusout={() => {
					send({
					  type: SyncTypes.ProfileSync,
						name: name
					})
				localStorage.setItem("name", name)
			}}
					bind:value={name} type="text" class="focus-visible:ring-transparent w-auto max-md:grow"
					placeholder="Name" />
			</div>
			<Chatbox
				useButton={true}
				formId="chat-mobile-form"
				inputId="chat-mobile-input"
				bind:controlsShowing send={send}
				bind:messages={roomMessages}
				bind:historicalPlayers
				class="input-bordered input-md grow max-md:w-full" />
		</div>

		<Card.Root class="w-full max-w-[90rem] self-center">
			<Card.Header class="max-sm:px-4 max-sm:pt-4 max-sm:pb-0">
				<div class="flex gap-3 justify-center items-center">
					<div class="flex flex-col gap-1 max-sm:mr-4 flex-1">
						<Card.Title>Media</Card.Title>
						<Card.Description class="max-sm:hidden">
							Codec: {selectedCodec} {autoCodec ?? ''} {job.ExtractedQuality}; Audio: {selectedAudio}</Card.Description>
					</div>
					<ConnectButton bind:socketCommunicating bind:interacted bind:exited bind:tickedSecsAgoStr
												 class="max-md:hidden"
												 onClick={() => {
						if(!socketCommunicating && !interacted) {
							player?.play()
								}}}
					/>
					<div class="flex gap-3 max-sm:gap-2 items-center justify-end flex-1">
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

						<Tooltip.Root openDelay={0}>
							<Tooltip.Trigger asChild let:builder>
								<Button builders={[builder]} variant="outline"
												class="w-9 h-9 p-1"
												on:click={()=>{
													navigator.clipboard.writeText(window.location.href).then(() => {
														copiedRoomLink = true;
														setTimeout(() => {
															copiedRoomLink = false;
														}, 1500);
													});
									 }}>
									{#if copiedRoomLink}
										<IconCheck size={18} stroke={2} />
									{:else}
										<IconShare3 size={18} stroke={2} />
									{/if}
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{#if copiedRoomLink}
									<p>Copied!</p>
								{:else}
									<p>Copy room link to clipboard!</p>
								{/if}
							</Tooltip.Content>
						</Tooltip.Root>


						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild let:builder>
								<Button variant="outline" builders={[builder]}>
									<IconLayout2 class="sm:mr-2 max-sm:hidden" size={20} stroke={2} />
									<span>Layout</span>
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
								localStorage.setItem('chatLayout2', layout);
								$chatLayoutStore = layout;
							}}>
											{#if layout === "show"}
												<IconCone class="mr-2" size={16} stroke={2} />
												Show
											{:else}
												<IconEyeOff class="mr-2" size={16} stroke={2} />
												Hide
											{/if}
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild let:builder>
								<Button builders={[builder]} variant={currentTheme === "dark" ? "outline" : "default"}>
									<IconSettings2 class="mr-2 max-sm:hidden" size={16} stroke={2} />
									Video <span class="max-sm:hidden">&nbsp;Settings</span></Button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-56">
								<DropdownMenu.Label>
									Video Settings
								</DropdownMenu.Label>
								<DropdownMenu.Separator />
								<DropdownMenu.Group>
									{#if audiosExistForCodec(job, videoSrc?.sCodec)}
										<DropdownMenu.RadioGroup bind:value={selectedAudio}>
											{#each job.MappedAudio[videoSrc?.sCodec] as am}
												<DropdownMenu.RadioItem value={`${am.Index}-${am.Language}`} on:click={()=>{
													const curr = `${am.Index}-${am.Language}`
													if (selectedAudio !== curr) {
														localStorage.setItem('sAudio', curr);
														$pageReloadCounterStore++;
													}
							}}>{formatPair(am)} ({am.Index})
												</DropdownMenu.RadioItem>
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
								class="h-auto pr-4 py-0 pl-0 rounded-l-full rounded-r-full flex gap-2">
					<Pfp class="w-12 h-12 mr-0.5" id={player.id}
							 discordUser={Object.values(historicalPlayers).find((p) => p.id === player.id)?.discordUser} />
					<span class="flex gap-0.5 flex-col items-center justify-center font-semibold player-status-text">
						<span class="font-bold w-16 text-ellipsis overflow-hidden">{player.name}</span>
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
</style>
