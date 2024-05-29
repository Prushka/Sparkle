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
		setGetPlayerId,
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
		preprocessJobs,
		codecDisplayMap, getTitleComponents, type TitleComponents
	} from './t';
	import { PUBLIC_BE, PUBLIC_STATIC, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	import {
		IconAlertOctagonFilled, IconArrowBounce, IconChevronRight,
		IconCone, IconConePlus, IconEyeOff, IconLayout2,
		IconPlayerPauseFilled,
		IconPlayerPlayFilled,
		IconPlugConnected, IconSettings2,
		IconTableExport
	} from '@tabler/icons-svelte';
	import Chatbox from '$lib/player/Chatbox.svelte';
	import Pfp from '$lib/player/Pfp.svelte';
	import { chatFocusedStore, chatLayoutStore, pageReloadCounterStore, pfpLastFetched } from '../../store';
	import SUPtitles from '$lib/suptitles/suptitles';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	import JASSUB from 'jassub';
	import { goto } from '$app/navigation';
	import { toggleMode, mode } from 'mode-watcher';
	import { Moon, Reload, Rocket, Slash, Sun } from 'svelte-radix';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import { Separator } from '$lib/components/ui/separator';

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
	export let data: any;
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
	let lastSentTime = -100;
	let chatFocused = false;
	let videoSrc: any = [];
	let fonts: string[] = [];
	let sup: any;
	let jas: any;
	let currentTheme: 'light' | 'dark';
	let prevTrackSrc: string | null | undefined = '';
	let footer: string = '';
	let syncGoto = false;
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
	const unsubscribeChatLayout = chatLayoutStore.subscribe((value) => chatLayout = value);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	const unsubscribeMode = mode.subscribe((value) => {
		if (!value) {
			value = 'light';
		}
		currentTheme = value;
	});
	let exited = false;
	let nameEmptyDialog = false;
	$: BASE_STATIC = `${PUBLIC_STATIC}/${roomId}`;
	$: thumbnailVttSrc = `${BASE_STATIC}/storyboard.vtt`;
	$: socketCommunicating = socketConnected && (tickedSecsAgo >= 0 && tickedSecsAgo < 5);
	$: titles = jobs.reduce((acc: { [key: string]: TitleComponents }, job) => {
		const components = getTitleComponents(job);
		if (!acc[components.titleId]) {
			acc[components.titleId] = components;
		} else if (components.episodes) {
			if (!acc[components.titleId].episodes) {
				acc[components.titleId].episodes = {};
			}
			acc[components.titleId].episodes = {
				...acc[components.titleId].episodes,
				...components.episodes
			};
		}
		return acc;
	}, {});
	let selectedTitleId: string = getTitleComponents(job).titleId;
	let selectedSe: string | null = getTitleComponents(job).episodes ? Object.keys(getTitleComponents(job).episodes!)[0] : null;

	$: selectedTitle = titles[selectedTitleId];
	$: selectedEpisodes = selectedTitle?.episodes;
	$: selectedEpisode = (selectedTitle?.episodes && selectedSe) ? selectedTitle.episodes[selectedSe!] : null;
	$:{
		console.log(titles, selectedTitle);
	}

	$: chatHidden = chatLayout === 'hidden';
	$: {
		console.log('srcList:', videoSrc);
	}

	onDestroy(() => {
		unsubscribeChatLayout();
		unsubscribeChatFocused();
		unsubscribeMode();
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

	$:{
		if (selectedCodec !== 'auto' && job.EncodedCodecs && job.EncodedCodecs.length > 0 && !job?.EncodedCodecs.includes(selectedCodec)) {
			console.log('setting codec - no matching codec', selectedCodec, job.EncodedCodecs);
			onCodecChange('auto');
		}
	}

	function sendSettings() {
		send({ type: SyncTypes.SubtitleSwitch, subtitle: player?.textTracks?.selected?.src });
		send({ type: SyncTypes.AudioSwitch, audio: selectedAudioMapping });
		send({ type: SyncTypes.CodecSwitch, codec: `${selectedCodec},${videoSrc?.sCodec}` });
	}

	function connect() {
		if (!interactedWithPlayer) {
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
				const initiateMoveTo = () => {
					controlsToDisplay.push(state);
					updateMessages();
					setTimeout(() => {
						goto(`/${broadcast!.moveTo}`);
					}, 5000);
				};
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
						if (inBg && roomMessages[roomMessages.length - 1]?.timestamp !== state.chats[state.chats.length - 1]?.timestamp) {
							notificationAudio.play();
						}
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
					case SyncTypes.BroadcastSync:
						switch (broadcast?.type) {
							case BroadcastTypes.MoveTo:
								if (!jobs.find((job) => job.Id === broadcast.moveTo)) {
									updateList(() => {
										initiateMoveTo();
									});
								} else {
									initiateMoveTo();
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
			console.log('Socket closed, reconnecting');
			socketConnected = false;
			if (!exited) {
				setTimeout(function() {
					console.log('Socket reconnecting');
					connect();
				}, 1000);
			}
		};
	}

	function send(data: any) {
		if (player && socketConnected && !pauseSend && interactedWithPlayer) {
			console.log('sending: ' + JSON.stringify(data));
			socket.send(JSON.stringify(data));
		}
	}

	function updateList(onSuccess = () => {
	}) {
		fetch(`${PUBLIC_BE}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = preprocessJobs(data);
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
					message: control.type === SyncTypes.PauseSync ? (control.paused ? 'paused' : 'resumed') :
						control.type === SyncTypes.TimeSync ? 'seeked to ' + formatSeconds(control.time) :
							control.type === SyncTypes.BroadcastSync ? `Moving to [${jobs.find((job) => job.Id === control.broadcast!.moveTo)?.Input}] in 5 Seconds` : 'unknown',
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
				sup = null;
			}
			if (jas != null) {
				jas.destroy();
				let canvas = document.getElementById('ass-canvas') as HTMLCanvasElement;
				if (canvas) {
					canvas.remove();
				}
				console.log('destroyed jas');
				jas = null;
			}
		};
		supportedCodecs = getSupportedCodecs();
		setVideoSrc();
		reloadPlayer();
		const ii = setInterval(() => {
			updateList();
		}, 60000);
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
			nameEmptyDialog = true;
		}
		const chatOverlay = document.getElementById('chat-overlay');
		const thePlayer = document.getElementById('the-player');
		thePlayer!.appendChild(chatOverlay!);
		return () => {
			exited = true;
			socket?.close();
			clearInterval(i);
			clearInterval(ii);
			dispose();
			playerUnsubscribe();
			document.removeEventListener('visibilitychange', () => {
				visibilityChange;
			});
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

	function bounceTo(id: string) {
		if (syncGoto && socketCommunicating) {
			send({
				type: SyncTypes.BroadcastSync,
				broadcast: { type: BroadcastTypes.MoveTo, moveTo: id }
			});
		} else {
			goto(`/${id}`);
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
			class="aspect-video media-provider">
			<media-poster
				class="vds-poster"
				src={data.preview}
				alt={data.plot}
			></media-poster>

		</media-provider>
		<media-video-layout colorScheme={currentTheme}
												thumbnails={thumbnailVttSrc}></media-video-layout>
	</media-player>

	<div class="flex gap-1 w-full h-full absolute pointer-events-none" id="chat-overlay"
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
		<div class="w-full flex gap-4 items-center justify-center max-md:flex-col">
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
					bind:value={name} type="text" class="focus-visible:ring-transparent w-auto max-md:grow" placeholder="Who?" />
			</div>
			<Chatbox send={send} class="input-bordered input-md grow max-md:w-full" />
		</div>

		<div class="gap-4 w-full items-center justify-center flex max-md:flex-col">
			<div class="flex gap-2 items-center justify-center max-md:w-full flex-grow">
				<Tooltip.Root openDelay={0}>
					<Tooltip.Trigger asChild let:builder>
						<Button builders={[builder]} variant={!socketCommunicating || !syncGoto ? "ghost" : "secondary"}
										class="w-10 h-10 p-2 {(!socketCommunicating || !syncGoto) ? 'opacity-50' :''}"
										on:click={()=>{
										 syncGoto = !syncGoto;
									 }}
										disabled={!socketCommunicating}>
							<IconArrowBounce size={20} stroke={2} />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>Move users in room on selection</p>
					</Tooltip.Content>
				</Tooltip.Root>


				<div class="flex grow gap-2 items-center justify-center max-sm:flex-col max-sm:w-full">
					<Select.Root>
						<Select.Trigger class="flex-grow max-sm:w-full">
							<Select.Value placeholder={selectedTitle?.title} />
						</Select.Trigger>
						<Select.Content>
							<div class="max-h-[35vh] w-full overflow-y-auto">
								{#each Object.values(titles) as title}
									<Select.Item value={title.titleId} on:click={()=>{
									selectedTitleId = title.titleId;
									selectedSe = null;
									if(!title.episodes) {
										bounceTo(title.id)
									}
						}}>{title.title}</Select.Item>
								{/each}
							</div>
						</Select.Content>
					</Select.Root>

					{#if selectedEpisodes}
						<IconChevronRight size={20} stroke={2} />
						<Select.Root>
							<Select.Trigger class="flex-grow max-sm:w-full">
								<Select.Value placeholder={selectedEpisode ?
										`${selectedSe} - ${selectedEpisode.seTitle}` : "Select episode"} />
							</Select.Trigger>
							<Select.Content>
								<div class="max-h-[35vh] w-full overflow-y-auto">
									{#each Object.values(selectedEpisodes) as es}
										<Select.Item class="p-1" value={es.se} on:click={()=>{
									bounceTo(es.id)
									selectedSe = es.se;
						}}>
											<img src="{PUBLIC_STATIC}/{es.id}/poster.jpg" alt="{es.seTitle}" class="h-8 w-12 object-cover mr-2 rounded-sm" />{es.se}
											- {es.seTitle}
										</Select.Item>
									{/each}
								</div>
							</Select.Content>
						</Select.Root>
					{/if}
				</div>
			</div>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild let:builder>
					<Button builders={[builder]} variant="outline" class="max-md:w-full">
						<IconSettings2 class="mr-2" size={16} stroke={2} /> Video Settings</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-56">
					<DropdownMenu.Label>
						Video Settings</DropdownMenu.Label>
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
								Auto {(videoSrc?.sCodec && selectedCodec === "auto") ? `(${codecDisplayMap[videoSrc.sCodec]})` : ''}</DropdownMenu.RadioItem>
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

		<Separator />

		<div class="flex gap-3 self-center items-center justify-center w-full">
			<Tooltip.Root openDelay={0}>
				<Tooltip.Trigger asChild let:builder>
					<Button builders={[builder]} variant="outline"
									on:click={() => {
						if(!socketCommunicating && !interactedWithPlayer) {
							player?.play()
								}}}
									class="font-bold {socketCommunicating ? 'text-green-600 hover:text-green-600' : 'text-red-600 hover:text-red-600' }">
						{#if socketCommunicating}
							<IconPlugConnected size={20} stroke={2} />
						{:else}
							{#if !interactedWithPlayer}
								<Rocket class="mr-2 h-4 w-4 animate-bounce" />
								Connect Now
							{:else if !exited}
								<Reload class="mr-2 h-4 w-4 animate-spin" />
								Connecting...
							{:else}
								Disconnected
							{/if}
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>Ticked: {tickedSecsAgoStr}s ago</p>
				</Tooltip.Content>
			</Tooltip.Root>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild let:builder>
					<Button variant="outline" builders={[builder]}>
						<IconLayout2 class="mr-2" size={16} stroke={2} />
						Layout
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-56">
					<DropdownMenu.Label>Chat Layout</DropdownMenu.Label>
					<DropdownMenu.Separator />
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
			<Button on:click={toggleMode} variant="outline" size="icon">
				<Sun
					class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
				/>
				<Moon
					class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
				/>
				<span class="sr-only">Toggle theme</span>
			</Button>
		</div>

		<div class="md:flex gap-4 max-md:grid max-md:grid-cols-2 w-full justify-center mt-2">
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

    .chat-history {
        margin-top: 2rem;
        margin-right: 2rem;
    }

    .chat-line {
        width: fit-content;
        border-radius: 0.5rem;
        background-color: rgba(0, 0, 0, 0.2);
    }

    @media (max-width: 800px) {

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
