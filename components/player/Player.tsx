'use client';

import 'vidstack/player';
import 'vidstack/player/ui';
import 'vidstack/player/layouts/default';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TextTrack, type MediaKeyShortcuts } from 'vidstack';
import JASSUB from 'jassub';
import {
	IconAlertOctagonFilled,
	IconArrowBounce,
	IconCheck,
	IconMoon,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconSettings2,
	IconShare3,
	IconSun,
	IconTableExport
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { useAppState } from '@/lib/app-state';
import { useTheme } from '@/lib/theme';
import { PUBLIC_BE } from '@/lib/env';
import { createNotificationAudioUrl } from '@/lib/player/notification-audio';
import {
	BroadcastTypes,
	codecDisplayMap,
	codecMap,
	defaultFallback,
	fallbackFontsMap,
	formatMbps,
	formatPair,
	formatSeconds,
	getLeftAndJoined,
	getName,
	getSupportedCodecs,
	hideControlsOnChatFocused,
	languageSrcMap,
	moveSeconds,
	randomString,
	audiosExistForCodec,
	setGetLsBoolean,
	setGetLsNumber,
	sortTracks,
	SyncTypes,
	type Chat,
	type Discord,
	type Job,
	type Player as RoomPlayer,
	type SendPayload,
	type ServerData
} from '@/lib/player/t';
import SUPtitles from '@/lib/suptitles/suptitles';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import * as Tooltip from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Chatbox } from '@/components/player/Chatbox';
import { Pfp } from '@/components/player/Pfp';
import { ConnectButton } from '@/components/player/ConnectButton';
import { MediaSelection, type MediaSelectionHandle } from '@/components/player/MediaSelection';
import { MoveToast } from '@/components/player/MoveToast';
import { Chats } from '@/components/player/Chats';

type VideoSource = {
	src: string;
	type: string;
	codec: string;
	sCodec: string;
	audio: string;
};

type MoveToastState = {
	seconds: number;
	firedBy: RoomPlayer;
	job: Job | undefined;
};

const PLAYER_KEY_SHORTCUTS: MediaKeyShortcuts = {
	togglePaused: 'k Space',
	toggleMuted: 'm',
	toggleFullscreen: null,
	togglePictureInPicture: 'i',
	seekBackward: ['j', 'J', 'ArrowLeft'],
	seekForward: ['l', 'L', 'ArrowRight'],
	volumeUp: 'ArrowUp',
	volumeDown: 'ArrowDown'
};

export function Player({ data }: { data: ServerData }) {
	const { job } = data;
	const searchParams = useSearchParams();
	const {
		setCurrentlyWatching,
		setChatFocused,
		chatFocused,
		chatLayout,
		setPageReloadCounter,
		interacted,
		setInteracted,
		setPlayersCount,
		updatePfp,
		discordAuth
	} = useAppState();
	const { theme, setTheme } = useTheme();
	const [playerEl, setPlayerEl] = useState<any>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const mediaSelectionRef = useRef<MediaSelectionHandle | null>(null);
	const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
	const supRef = useRef<SUPtitles | null>(null);
	const jasRef = useRef<any>(null);
	const fontsRef = useRef<string[]>([]);
	const prevTrackSrcRef = useRef<string | null>('');
	const lastTickedRef = useRef(0);
	const lastSentTimeRef = useRef(-100);
	const inBgRef = useRef(false);
	const exitedRef = useRef(false);
	const chatFocusedSecsRef = useRef(0);
	const volumeInitializedRef = useRef(false);
	const [controlsShowing, setControlsShowing] = useState(false);
	const [socketConnected, setSocketConnected] = useState(false);
	const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
	const [historicalPlayers, setHistoricalPlayers] = useState<Record<string, RoomPlayer>>({});
	const [roomMessages, setRoomMessages] = useState<Chat[]>([]);
	const [controlsToDisplay, setControlsToDisplay] = useState<SendPayload[]>([]);
	const [selectedCodec, setSelectedCodec] = useState('auto');
	const [selectedAudio, setSelectedAudio] = useState('1-jpn');
	const [syncGoto, setSyncGoto] = useState(() => setGetLsBoolean('syncGoto', true));
	const [supportedCodecs, setSupportedCodecs] = useState<string[]>([]);
	const [copiedRoomLink, setCopiedRoomLink] = useState(false);
	const [exited, setExited] = useState(false);
	const [moveToast, setMoveToast] = useState<MoveToastState | null>(null);
	const [name, setName] = useState('');
	const [playerId, setPlayerId] = useState('');
	const [initialVolume] = useState(() => setGetLsNumber('volume', 1));
	const BASE_STATIC = `${data.staticBaseUrl}/${job.Id}`;
	const [tickedSecsAgo, setTickedSecsAgo] = useState(-1);
	const [tickedSecsAgoStr, setTickedSecsAgoStr] = useState('0.00');
	const [chatFocusedSecs, setChatFocusedSecs] = useState(0);
	const thumbnailVttSrc = `${data.staticBaseUrl}/${job.Id}/storyboard.vtt`;
	const roomBase = searchParams.get('room') || searchParams.get('channel_id') || '';
	const room = roomBase ? `${roomBase}${job.Id}` : job.Id;
	const discord = discordAuth as Discord | null;
	const displayName = discord?.user ? getName(discord.user) || '' : name;
	const socketCommunicating = socketConnected && tickedSecsAgo >= 0 && tickedSecsAgo < 5;
	const videoSrc = useMemo<VideoSource | null>(() => {
		const encodedCodecs = job.EncodedCodecs || [];
		const autoCodec =
			supportedCodecs.find((codec) => encodedCodecs.includes(codec)) || encodedCodecs[0];
		const effectiveCodec = selectedCodec === 'auto' ? autoCodec : selectedCodec;
		if (!effectiveCodec) {
			return null;
		}
		const audioStreams = job.MappedAudio[effectiveCodec] ?? [];
		let stream = audioStreams.find(
			(candidate) => `${candidate.Index}-${candidate.Language}` === selectedAudio
		);
		if (!stream) {
			const selectedLanguage = selectedAudio.split('-')[1];
			stream =
				audioStreams.find((candidate) => candidate.Language === selectedLanguage) ||
				audioStreams[0];
		}
		const effectiveAudio = stream ? `${stream.Index}-${stream.Language}` : selectedAudio;
		return {
			src: `${BASE_STATIC}/${effectiveCodec}-${effectiveAudio}.mp4`,
			type: 'video/mp4',
			codec: codecMap[effectiveCodec],
			sCodec: effectiveCodec,
			audio: effectiveAudio
		};
	}, [
		BASE_STATIC,
		job.EncodedCodecs,
		job.MappedAudio,
		selectedAudio,
		selectedCodec,
		supportedCodecs
	]);
	const effectiveAudio = videoSrc?.audio || selectedAudio;
	const autoCodec =
		videoSrc?.sCodec && selectedCodec === 'auto' ? `(${codecDisplayMap[videoSrc.sCodec]})` : '';
	const chatHidden = chatLayout === 'hide';

	const messagesToDisplay = (() => {
		let nextMessages = roomMessages.filter((message) => Date.now() - message.timestamp < 140000);
		if (playerEl?.clientHeight < 250) {
			nextMessages = nextMessages.slice(-4);
		} else if (playerEl?.clientHeight < 450) {
			nextMessages = nextMessages.slice(-6);
		} else if (playerEl?.clientHeight < 620) {
			nextMessages = nextMessages.slice(-8);
		} else {
			nextMessages = nextMessages.slice(-10);
		}
		for (const control of controlsToDisplay) {
			if (control.firedBy && Date.now() - control.timestamp < 8000) {
				nextMessages = nextMessages.concat({
					uid: control.firedBy.id,
					message:
						control.type === SyncTypes.PauseSync
							? control.paused
								? 'Paused'
								: 'Resumed'
							: control.type === SyncTypes.TimeSync
								? 'Seeked to ' + formatSeconds(control.time)
								: control.type === SyncTypes.BroadcastSync
									? `Moving to [${control.moveToText}] in ${moveSeconds} Seconds`
									: control.type === SyncTypes.PlayerLeft
										? 'Left'
										: control.type === SyncTypes.PlayerJoined
											? 'Joined'
											: '',
					timestamp: control.timestamp,
					mediaSec: playerEl?.currentTime || 0,
					isStateUpdate: true,
					timeStr: ''
				});
			}
		}
		nextMessages.sort((a, b) => a.timestamp - b.timestamp);
		for (let i = 0; i < nextMessages.length; i++) {
			let prevTimeStr = '';
			for (let j = i - 1; j >= 0; j--) {
				if (nextMessages[j].timeStr) {
					prevTimeStr = nextMessages[j].timeStr;
					break;
				}
			}
			const currTimeStr = new Date(nextMessages[i].timestamp).toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false
			});
			nextMessages[i].timeStr = prevTimeStr === currTimeStr ? '' : currTimeStr;
		}
		return nextMessages;
	})();

	useEffect(() => {
		setCurrentlyWatching({
			id: job.Id,
			title: job.Title.title,
			se: job.Title.episode ? job.Title.episode.se : '',
			seTitle: job.Title.episode ? job.Title.episode.title : '',
			thumbnail: data.preview,
			timeEntered: Date.now(),
			paused: true,
			totalDuration: 0,
			duration: 0,
			roomPlayers: 1
		});
		if (discord) {
			setInteracted(true);
		}
	}, [data.preview, discord, job.Id, job.Title, setCurrentlyWatching, setInteracted]);

	useEffect(() => {
		setPlayersCount(socketCommunicating ? roomPlayers.length : -1);
	}, [roomPlayers.length, setPlayersCount, socketCommunicating]);

	useEffect(() => {
		if (!playerEl || typeof customElements === 'undefined') {
			return;
		}
		let cancelled = false;
		customElements
			.whenDefined('media-player')
			.then(() => {
				if (!cancelled) {
					playerEl.keyShortcuts = PLAYER_KEY_SHORTCUTS;
				}
			})
			.catch((error) => console.log(error));
		return () => {
			cancelled = true;
		};
	}, [playerEl]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			if (discord?.user) {
				setName(getName(discord.user) || '');
				return;
			}
			if (name) {
				return;
			}
			const stored = window.localStorage.getItem('name');
			if (stored) {
				setName(stored);
				return;
			}
			const anon = `Anon-${randomString(4)}`;
			window.localStorage.setItem('name', anon);
			setName(anon);
		}, 0);
		return () => window.clearTimeout(timer);
	}, [discord?.user, name]);

	useEffect(() => {
		if (discord?.user || typeof window === 'undefined' || !name.startsWith('Anon-')) {
			return;
		}
		const toastKey = `anon-name-toast:${name}`;
		if (window.sessionStorage.getItem(toastKey)) {
			return;
		}
		window.sessionStorage.setItem(toastKey, '1');
		toast('Using placeholder name: ' + name, {
			description: 'Change your name using the input next to your avatar',
			duration: 9000
		});
	}, [discord?.user, name]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			const storedId = window.localStorage.getItem('id');
			if (storedId) {
				setPlayerId(storedId);
				return;
			}
			const nextId = randomString(14);
			window.localStorage.setItem('id', nextId);
			setPlayerId(nextId);
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			setSupportedCodecs(getSupportedCodecs());
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			const storedCodec = window.localStorage.getItem('sCodec') || 'auto';
			if (
				storedCodec !== 'auto' &&
				job.EncodedCodecs &&
				job.EncodedCodecs.length > 0 &&
				!job.EncodedCodecs.includes(storedCodec)
			) {
				window.localStorage.setItem('sCodec', 'auto');
				setSelectedCodec('auto');
				return;
			}
			setSelectedCodec(storedCodec);
		}, 0);
		return () => window.clearTimeout(timer);
	}, [job.EncodedCodecs]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			const storedAudio = window.localStorage.getItem('sAudio');
			const codecToUse = selectedCodec === 'auto' ? job.EncodedCodecs?.[0] : selectedCodec;
			const streams = codecToUse ? (job.MappedAudio[codecToUse] ?? []) : [];
			let nextAudio = streams[0] ? `${streams[0].Index}-${streams[0].Language}` : '1-jpn';
			if (storedAudio) {
				const exactMatch = streams.find(
					(candidate) => `${candidate.Index}-${candidate.Language}` === storedAudio
				);
				if (exactMatch) {
					nextAudio = storedAudio;
				} else {
					const storedLanguage = storedAudio.split('-')[1];
					const languageMatch = streams.find((candidate) => candidate.Language === storedLanguage);
					if (languageMatch) {
						nextAudio = `${languageMatch.Index}-${languageMatch.Language}`;
					} else if (streams.length === 0) {
						nextAudio = storedAudio;
					}
				}
			}
			setSelectedAudio(nextAudio);
		}, 0);
		return () => window.clearTimeout(timer);
	}, [job.EncodedCodecs, job.MappedAudio, selectedCodec]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const notificationAudio = new Audio(createNotificationAudioUrl());
		notificationAudio.volume = 0.25;
		notificationAudioRef.current = notificationAudio;
	}, []);

	const send = useCallback(
		(data: any) => {
			if (playerEl && socketConnected && interacted) {
				console.log('sending: ' + JSON.stringify(data));
				socketRef.current?.send(JSON.stringify(data));
			}
		},
		[interacted, playerEl, socketConnected]
	);

	const sendSettings = useCallback(() => {
		send({
			type: SyncTypes.SubtitleSwitch,
			subtitle: playerEl?.textTracks?.selected?.src
		});
		send({
			type: SyncTypes.AudioSwitch,
			audio: effectiveAudio
		});
		send({
			type: SyncTypes.CodecSwitch,
			codec: `${selectedCodec},${videoSrc?.sCodec}`
		});
	}, [effectiveAudio, playerEl, send, selectedCodec, videoSrc?.sCodec]);

	useEffect(() => {
		if (!playerEl || !videoSrc) {
			return;
		}
		playerEl.title = job.Input;
		playerEl.artist = "Let's watch anime!";
		sendSettings();
	}, [job.Input, playerEl, sendSettings, videoSrc]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		let cancelled = false;
		const dispose = () => {
			if (supRef.current != null) {
				supRef.current.dispose();
				supRef.current = null;
			}
			if (jasRef.current != null) {
				jasRef.current.destroy();
				jasRef.current = null;
			}
			canvasRef.current
				?.getContext('2d')
				?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
		};

		const setupTracks = async () => {
			try {
				await customElements.whenDefined('media-player');
			} catch (error) {
				console.log(error);
			}
			if (cancelled) {
				return;
			}
			const player = playerEl as any;
			const textTracks = player?.textTracks;
			if (!textTracks?.add) {
				return;
			}
			if (typeof textTracks.clear === 'function') {
				textTracks.clear();
			}
			const fonts: string[] = [];
			if (job.Streams) {
				const sortedJob = { ...job, Streams: [...job.Streams] };
				sortedJob.Streams = sortTracks(sortedJob);
				let defaulted = false;
				for (const [, stream] of Object.entries(sortedJob.Streams)) {
					switch (stream.CodecType) {
						case 'attachment':
							if (stream.Location?.includes('otf') || stream.Location?.includes('ttf')) {
								fonts.push(`${BASE_STATIC}/${stream.Location}`);
							}
							break;
						case 'subtitle':
							textTracks.add({
								src: `${BASE_STATIC}/${stream.Location}`,
								label: formatPair(stream, true, true),
								kind: 'subtitles',
								type:
									stream.Location.slice(-3) === 'vtt'
										? 'vtt'
										: stream.Location.slice(-3) === 'ass'
											? 'asshuh'
											: stream.Location.slice(-3) === 'sup'
												? 'sup'
												: 'srt',
								language: languageSrcMap[stream.Language] || stream.Language,
								default: !defaulted
							});
							defaulted = true;
							break;
					}
				}
			}
			fontsRef.current = fonts;
			if (job.Chapters && job.Chapters.length > 0) {
				const track = new TextTrack({
					kind: 'chapters',
					language: 'en-US',
					type: 'vtt',
					default: true
				});
				for (const chapter of job.Chapters) {
					if (chapter.tags?.title && chapter.end - chapter.start > 2 * 1000000000) {
						track.addCue(new VTTCue(chapter.start, chapter.end, chapter.tags?.title));
					}
				}
				textTracks.add(track);
			}
			player.controlsDelay = 1500;
		};
		void setupTracks();

		return () => {
			cancelled = true;
			dispose();
		};
	}, [BASE_STATIC, job, playerEl]);

	function connect() {
		if (!interacted || !playerEl) {
			return;
		}
		const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(
			`${wsProtocol}//${window.location.host}${PUBLIC_BE}/sync/${room}/${playerId}`
		);
		socketRef.current = socket;
		console.log(`Socket, connecting to ${room}`);
		socket.onopen = () => {
			console.log(`Socket, connected to ${room}`);
			setSocketConnected(true);
			if (displayName !== '') {
				send({
					name: displayName,
					type: SyncTypes.ProfileSync,
					discordUser: discord?.user
				});
			}
			send({ type: SyncTypes.NewPlayer });
			sendSettings();
			updateLastTicked(true);
		};

		socket.onmessage = (event: MessageEvent) => {
			const state: SendPayload = JSON.parse(event.data);
			const broadcast = state.broadcast;
			const persistControlState = (payload: any) => {
				if (payload.firedBy !== undefined) {
					setControlsToDisplay((prev) => [...prev, payload]);
				}
			};
			if (playerEl) {
				console.debug('received: ' + JSON.stringify(state));
				const initiateMoveTo = (jobs: Job[]) => {
					setMoveToast({
						seconds: moveSeconds,
						job: jobs.find((candidate: Job) => candidate.Id === broadcast!.moveTo),
						firedBy: state.firedBy!
					});
					const target = jobs.find((candidate) => candidate.Id === state.broadcast!.moveTo);
					state.moveToText =
						target?.Title.title + (target?.Title?.episode ? ` ${target.Title.episode.se}` : '');
					setControlsToDisplay((prev) => [...prev, state]);
				};
				switch (state.type) {
					case SyncTypes.PfpSync:
						if (state.firedBy?.id) {
							updatePfp(state.firedBy.id);
						}
						break;
					case SyncTypes.ChatSync:
						setRoomMessages((prev) => {
							if (
								inBgRef.current &&
								getLatestMessageTimestamp(prev) !== state.chats[state.chats.length - 1]?.timestamp
							) {
								notificationAudioRef.current?.play().catch(() => {});
							}
							return state.chats;
						});
						break;
					case SyncTypes.PlayersStatusSync:
						setRoomPlayers((prev) => {
							if (prev.length > 0) {
								const { left, joined } = getLeftAndJoined(prev, state.players, playerId);
								for (const player of left) {
									setControlsToDisplay((controls) => [
										...controls,
										{
											...state,
											type: SyncTypes.PlayerLeft,
											firedBy: player
										}
									]);
								}
								for (const player of joined) {
									setControlsToDisplay((controls) => [
										...controls,
										{
											...state,
											type: SyncTypes.PlayerJoined,
											firedBy: player
										}
									]);
								}
							}
							return state.players;
						});
						setHistoricalPlayers((prev) => {
							const next = { ...prev };
							for (const player of state.players) {
								if (!next[player.id] || next[player.id].name !== player.name) {
									next[player.id] = player;
								}
							}
							return next;
						});
						updateLastTicked(true);
						setCurrentlyWatching((value) => {
							if (value) {
								return { ...value, roomPlayers: state.players.length };
							}
							return null;
						});
						break;
					case SyncTypes.PauseSync:
						if (state.paused === true && playerEl.paused === false) {
							playerEl.pause();
							persistControlState(state);
						} else if (
							state.paused === false &&
							playerEl.paused === true &&
							(!inBgRef.current || (inBgRef.current && roomPlayers.length > 1))
						) {
							playerEl.play();
							persistControlState(state);
						}
						break;
					case SyncTypes.TimeSync:
						if (state.time !== undefined && Math.abs(playerEl.currentTime - state.time) > 3) {
							playerEl.currentTime = state.time;
							persistControlState(state);
						}
						break;
					case SyncTypes.BroadcastSync:
						switch (broadcast?.type) {
							case BroadcastTypes.MoveTo:
								mediaSelectionRef.current?.updateList(broadcast.moveTo, (jobs: Job[]) => {
									initiateMoveTo(jobs);
								});
								break;
						}
						break;
					case SyncTypes.ExitSync:
						setExited(true);
						exitedRef.current = true;
						setInteracted(false);
						setPageReloadCounter((value) => value + 1);
						break;
				}
			}
		};

		socket.onerror = (event) => {
			console.error('Socket encountered error: ', event);
			socket.close();
		};

		socket.onclose = () => {
			console.log(`Socket closed, ${room}`);
			setSocketConnected(false);
			if (!exitedRef.current) {
				window.setTimeout(() => {
					console.log(`Socket reconnecting, ${room}`);
					connect();
				}, 1000);
			}
		};
	}

	function getLatestMessageTimestamp(messages: Chat[]) {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (!messages[i].isStateUpdate) {
				return messages[i].timestamp;
			}
		}
		return 0;
	}

	function updateLastTicked(resetTimer = false) {
		if (resetTimer) {
			lastTickedRef.current = Date.now();
		}
		const nextTickedSecsAgo =
			socketConnected && roomPlayers.length > 0 ? (Date.now() - lastTickedRef.current) / 1000 : -1;
		setTickedSecsAgo(nextTickedSecsAgo);
		setTickedSecsAgoStr((Math.round(nextTickedSecsAgo * 100) / 100).toFixed(2));
	}

	function updateTime() {
		const timeRounded = Math.ceil(playerEl.currentTime);
		if (lastSentTimeRef.current !== timeRounded) {
			send({
				type: SyncTypes.TimeSync,
				time: timeRounded
			});
			lastSentTimeRef.current = timeRounded;
			setCurrentlyWatching((value) => {
				if (value) {
					return {
						...value,
						duration: timeRounded,
						totalDuration: job.Duration
					};
				}
				return null;
			});
		}
	}

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		const player = playerEl;
		const playerUnsubscribe = player.subscribe?.(
			({ controlsVisible }: { controlsVisible: boolean }) => {
				setControlsShowing(controlsVisible);
			}
		);
		const playerCanPlayUnsubscribe = player.subscribe?.(({ canPlay }: { canPlay: boolean }) => {
			if (canPlay && interacted && !socketRef.current) {
				connect();
			}
		});
		const playerSoundUnsubscribe = player.subscribe?.(
			({ volume, muted }: { volume: number; muted: boolean }) => {
				if (!volumeInitializedRef.current) {
					player.volume = initialVolume >= 0 && initialVolume <= 1 ? initialVolume : 1;
					volumeInitializedRef.current = true;
				} else {
					window.localStorage.setItem('volume', muted ? '0' : volume.toString());
				}
			}
		);

		const visibilityChange = () => {
			if (document.hidden) {
				send({ state: 'bg', type: SyncTypes.StateSync, paused: player.paused });
				inBgRef.current = true;
				if (!player.paused) {
					player.enterPictureInPicture?.();
				}
			} else {
				send({ state: 'fg', type: SyncTypes.StateSync, paused: player.paused });
				inBgRef.current = false;
				player.exitPictureInPicture?.();
			}
		};
		document.addEventListener('visibilitychange', visibilityChange);
		const mouseMove = () => {
			chatFocusedSecsRef.current = 0;
			setChatFocusedSecs(0);
		};
		document.addEventListener('mousemove', mouseMove);
		const mouseLeave = () => {
			if (!player.paused && controlsShowing) {
				player.remoteControl?.toggleControls?.();
			}
		};
		player.addEventListener?.('mouseleave', mouseLeave);

		const interval = window.setInterval(() => {
			updateTime();
			updateLastTicked();
			const videoElement = document.querySelector(
				'media-provider video'
			) as HTMLVideoElement | null;
			const selectedTrack = player.textTracks?.selected;
			if (videoElement && prevTrackSrcRef.current !== selectedTrack?.src) {
				if (supRef.current) {
					supRef.current.dispose();
					supRef.current = null;
				}
				if (jasRef.current) {
					jasRef.current.destroy();
					jasRef.current = null;
				}
				canvasRef.current
					?.getContext('2d')
					?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
				send({ type: SyncTypes.SubtitleSwitch, subtitle: selectedTrack?.src });
				if (selectedTrack?.src) {
					const ext = selectedTrack.src.slice(-4);
					if (ext.includes('sup')) {
						fetch(selectedTrack.src)
							.then((response) => response.arrayBuffer())
							.then((buffer) => {
								const file = new Uint8Array(buffer);
								supRef.current = new SUPtitles(
									canvasRef.current!,
									file,
									() => player.currentTime * 1000
								);
								if (!player.paused) {
									supRef.current.playHandler();
								}
							});
					} else if (ext.includes('ass')) {
						const fallback = fallbackFontsMap[selectedTrack.language]
							? fallbackFontsMap[selectedTrack.language]
							: defaultFallback;
						const availableFonts = {
							[fallback[0]]: fallback[1]
						};
						jasRef.current = new JASSUB({
							video: videoElement,
							canvas: canvasRef.current!,
							subUrl: selectedTrack.src,
							offscreenRender: true,
							workerUrl: '/scripts/jassub-worker.js',
							wasmUrl: '/scripts/jassub-worker.wasm',
							fallbackFont: fallback[0],
							availableFonts,
							fonts: [...fontsRef.current, fallback[1]]
						} as any);
					}
				}
				prevTrackSrcRef.current = selectedTrack?.src;
			}
			if (chatFocused) {
				chatFocusedSecsRef.current += 1;
				setChatFocusedSecs(chatFocusedSecsRef.current);
			} else {
				chatFocusedSecsRef.current = 0;
				setChatFocusedSecs(0);
			}
			const nextTickedSecsAgo =
				socketConnected && roomPlayers.length > 0
					? (Date.now() - lastTickedRef.current) / 1000
					: -1;
			setTickedSecsAgo(nextTickedSecsAgo);
			setTickedSecsAgoStr((Math.round(nextTickedSecsAgo * 100) / 100).toFixed(2));
			if (!playerEl) {
				return;
			}
		}, 1000);

		return () => {
			window.clearInterval(interval);
			document.removeEventListener('visibilitychange', visibilityChange);
			document.removeEventListener('mousemove', mouseMove);
			player.removeEventListener?.('mouseleave', mouseLeave);
			playerUnsubscribe?.();
			playerCanPlayUnsubscribe?.();
			playerSoundUnsubscribe?.();
		};
	}, [
		chatFocused,
		connect,
		controlsShowing,
		initialVolume,
		playerEl,
		roomPlayers.length,
		send,
		socketConnected,
		updateLastTicked,
		updateTime,
		interacted
	]);

	useEffect(() => {
		if (discordAuth?.user) {
			setInteracted(true);
		}
	}, [discordAuth, setInteracted]);

	function changeCodec(selected: string) {
		setSelectedCodec(selected);
		window.localStorage.setItem('sCodec', selected);
		setPageReloadCounter((value) => value + 1);
	}

	function changeAudio(curr: string) {
		if (selectedAudio !== curr) {
			setSelectedAudio(curr);
			window.localStorage.setItem('sAudio', curr);
			setPageReloadCounter((value) => value + 1);
		}
	}

	function handleCopyRoomLink() {
		let link = window.location.href;
		if (searchParams.has('room') || searchParams.has('channel_id')) {
			link = `${window.location.href.split('?')[0]}?room=${searchParams.get('room') || searchParams.get('channel_id')}`;
		}
		window.navigator.clipboard.writeText(link).then(() => {
			setCopiedRoomLink(true);
			window.setTimeout(() => {
				setCopiedRoomLink(false);
			}, 1500);
		});
	}

	return (
		<>
			<media-player
				keep-alive
				className={`media-player relative block w-full overflow-hidden bg-slate-900 ${discord ? 'h-screen' : 'aspect-video'} ${playerEl && !playerEl.paused && chatFocusedSecs > hideControlsOnChatFocused ? 'chat-controls-hidden' : ''}`}
				src={videoSrc?.src || undefined}
				crossorigin
				ref={setPlayerEl}
				playsInline
				onSeeked={() => {}}
				onSeeking={() => {}}
				onPause={() => {
					send({ paused: true, type: SyncTypes.PauseSync });
					setCurrentlyWatching((value) => (value ? { ...value, paused: true } : null));
				}}
				onPlay={() => {
					if (interacted) {
						send({ paused: false, type: SyncTypes.PauseSync });
						setCurrentlyWatching((value) => (value ? { ...value, paused: false } : null));
					} else {
						setInteracted(true);
						connect();
					}
				}}
			>
				<media-provider className="media-provider">
					<media-poster className="vds-poster" src={data.preview}></media-poster>
					<canvas ref={canvasRef} id="sub-canvas" className="pointer-events-none absolute" />
				</media-provider>
				<media-video-layout color-scheme={theme} thumbnails={thumbnailVttSrc}></media-video-layout>
			</media-player>

			<div
				className="pointer-events-none absolute z-50 flex h-full w-full gap-1"
				id="chat-overlay"
				style={chatHidden ? { display: 'none' } : undefined}
			>
				<Chats
					controlsShowing={controlsShowing}
					messagesToDisplay={messagesToDisplay}
					historicalPlayers={historicalPlayers}
					staticBaseUrl={data.staticBaseUrl}
				/>
			</div>

			<div className="flex w-full flex-col gap-4 p-4 font-semibold">
				<div className="mx-auto flex w-full max-w-[90rem] flex-col items-center justify-center gap-4 max-md:flex-col">
					<div className="flex w-full flex-col gap-3 items-center justify-center max-md:w-full">
						<div className="flex w-full flex-col gap-3 items-center justify-center max-md:w-full">
							<label className="custom-file-upload">
								<Pfp
									id={playerId}
									className="h-12 w-12"
									discordUser={discord?.user}
									staticBaseUrl={data.staticBaseUrl}
								/>
								<input
									accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
									onChange={(event) => {
										const ppfp = event.currentTarget.files;
										if (ppfp && ppfp[0]) {
											if (ppfp[0].size > 12000000) {
												toast.error('File size too large', {
													description: 'Max file size: 10MB',
													duration: 5000
												});
												event.currentTarget.value = '';
												return;
											}
											const pfp = ppfp[0];
											const reader = new FileReader();
											reader.onload = function (e) {
												const res = e.target?.result;
												if (res && typeof res === 'string') {
													const formData = new FormData();
													formData.append('pfp', pfp);
													fetch(`${PUBLIC_BE}/pfp/${playerId}`, {
														method: 'POST',
														body: formData
													}).then(() => {
														updatePfp(playerId);
													});
												}
											};
											reader.readAsDataURL(pfp);
										}
									}}
									type="file"
								/>
							</label>
							<Input
								disabled={discord?.user !== undefined}
								onBlur={() => {
									send({
										type: SyncTypes.ProfileSync,
										name: displayName
									});
									if (!discord?.user) {
										window.localStorage.setItem('name', name);
									}
								}}
								value={displayName}
								onChange={(event) => setName(event.target.value)}
								type="text"
								className="w-auto focus-visible:ring-transparent max-md:grow"
								placeholder="Name"
							/>
						</div>

						<div className="fixed left-0 top-0 z-50 flex w-full justify-end p-4 max-md:hidden pointer-events-none">
							<div className="pointer-events-auto">
								<Chatbox
									send={send}
									chatFocused={chatFocused}
									focusByShortcut
									controlsShowing={null}
									className="chat-pc"
									inputId="chat-pc-input"
									formId="chat-pc-form"
									messages={[]}
									historicalPlayers={{}}
									staticBaseUrl={data.staticBaseUrl}
									onFocus={() => {
										playerEl?.controls?.pause?.();
										setChatFocused(true);
									}}
									onBlur={() => {
										playerEl?.controls?.resume?.();
										setChatFocused(false);
										chatFocusedSecsRef.current = 0;
										setChatFocusedSecs(0);
									}}
								/>
							</div>
						</div>
					</div>
				</div>

				<Card className="w-full max-w-[90rem] self-center">
					<CardHeader className="max-sm:pb-0 max-sm:pl-4 max-sm:pr-4 max-sm:pt-4">
						<div className="flex items-center justify-center gap-3">
							<div className="flex flex-1 flex-col gap-1 max-sm:mr-4">
								<CardTitle>Media</CardTitle>
								<CardDescription className="max-sm:hidden">
									Codec: {selectedCodec} {autoCodec ?? ''}; Audio: {effectiveAudio}
								</CardDescription>
							</div>
							<ConnectButton
								socketCommunicating={socketCommunicating}
								interacted={interacted}
								exited={exited}
								tickedSecsAgoStr={tickedSecsAgoStr}
								className="max-md:hidden"
								onClick={() => {
									if (!socketCommunicating && !interacted) {
										playerEl?.play?.();
									}
								}}
							/>
							<div className="flex flex-1 items-center justify-end gap-3 max-sm:gap-2">
								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												variant={!socketCommunicating || !syncGoto ? 'ghost' : 'outline'}
												className={`h-9 w-9 p-1 ${!socketCommunicating || !syncGoto ? 'opacity-50' : ''}`}
												onClick={() => {
													setSyncGoto((value) => {
														const next = !value;
														window.localStorage.setItem('syncGoto', next.toString());
														return next;
													});
												}}
												disabled={!socketCommunicating}
											>
												<IconArrowBounce size={syncGoto ? 20 : 18} stroke={2} />
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											<p>Move users in room with you (on media change)</p>
										</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>

								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												variant="outline"
												className="h-9 w-9 p-1"
												onClick={handleCopyRoomLink}
											>
												{copiedRoomLink ? (
													<IconCheck size={18} stroke={2} />
												) : (
													<IconShare3 size={18} stroke={2} />
												)}
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											{copiedRoomLink ? <p>Copied!</p> : <p>Copy room link to clipboard!</p>}
										</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>

								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												variant="outline"
												className="h-9 w-9 p-1"
												onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
											>
												{theme === 'dark' ? (
													<IconMoon size={18} stroke={2} />
												) : (
													<IconSun size={18} stroke={2} />
												)}
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											<p>Toggle theme</p>
										</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>

								<DropdownMenu.Root>
									<DropdownMenu.Trigger asChild>
										<Button variant={theme === 'dark' ? 'outline' : 'default'}>
											<IconSettings2 className="mr-2 max-sm:hidden" size={16} stroke={2} />
											Video <span className="max-sm:hidden">&nbsp;Settings</span>
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content className="w-56">
										<DropdownMenu.Label>Video Settings</DropdownMenu.Label>
										<DropdownMenu.Separator />
										<DropdownMenu.Group>
											{audiosExistForCodec(job, videoSrc?.sCodec || '') ? (
												<DropdownMenu.RadioGroup value={effectiveAudio}>
													{job.MappedAudio[videoSrc?.sCodec || '']?.map((stream) => {
														const curr = `${stream.Index}-${stream.Language}`;
														return (
															<DropdownMenu.RadioItem
																key={curr}
																value={curr}
																onClick={() => changeAudio(curr)}
															>
																{formatPair(stream)} ({stream.Index})
															</DropdownMenu.RadioItem>
														);
													})}
												</DropdownMenu.RadioGroup>
											) : null}
										</DropdownMenu.Group>
										<DropdownMenu.Separator />
										<DropdownMenu.Group>
											<DropdownMenu.RadioGroup value={selectedCodec}>
												<DropdownMenu.RadioItem value="auto" onClick={() => changeCodec('auto')}>
													Auto {autoCodec}
												</DropdownMenu.RadioItem>
												{job.EncodedCodecs.map((codec) => (
													<DropdownMenu.RadioItem
														key={codec}
														value={codec}
														onClick={() => changeCodec(codec)}
													>
														{codecDisplayMap[codec]}
														{formatMbps(job, codec)}
														{!supportedCodecs.includes(codec) ? (
															<IconAlertOctagonFilled className="ml-2" size={16} stroke={2} />
														) : null}
													</DropdownMenu.RadioItem>
												))}
											</DropdownMenu.RadioGroup>
										</DropdownMenu.Group>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
						</div>
					</CardHeader>
					<CardContent className="max-sm:p-4">
						<MediaSelection
							ref={mediaSelectionRef}
							data={data}
							staticBaseUrl={data.staticBaseUrl}
							bounceToOverride={(id) => {
								if (syncGoto && socketCommunicating && roomPlayers.length > 1 && id !== job.Id) {
									send({
										type: SyncTypes.BroadcastSync,
										broadcast: { type: BroadcastTypes.MoveTo, moveTo: id }
									});
								} else {
									window.location.href = `/${id}`;
								}
							}}
						/>
					</CardContent>
				</Card>

				<div className="flex w-full items-center justify-center gap-3 md:hidden">
					<ConnectButton
						socketCommunicating={socketCommunicating}
						interacted={interacted}
						exited={exited}
						tickedSecsAgoStr={tickedSecsAgoStr}
						onClick={() => {
							if (!socketCommunicating && !interacted) {
								playerEl?.play?.();
							}
						}}
					/>
				</div>

				<div className="mb-3 flex flex-wrap justify-center gap-4">
					{roomPlayers.map((player) => (
						<Button
							key={player.id}
							variant="outline"
							className="flex h-auto gap-2 rounded-full rounded-l-full rounded-r-full py-0 pl-0 pr-4"
						>
							<Pfp
								className="mr-0.5 h-12 w-12"
								id={player.id}
								discordUser={historicalPlayers[player.id]?.discordUser}
								staticBaseUrl={data.staticBaseUrl}
							/>
							<span className="player-status-text flex flex-col items-center justify-center gap-0.5 font-semibold">
								<span className="w-16 overflow-hidden text-ellipsis font-bold">{player.name}</span>
								{player.inBg ? (
									<div className="flex items-center justify-center gap-1">
										<IconTableExport size={14} stroke={2} />
										<span>BG</span>
									</div>
								) : (
									<span>{formatSeconds(player.time)}</span>
								)}
							</span>
							{player.paused === false ? (
								<IconPlayerPlayFilled size={18} stroke={2} />
							) : (
								<IconPlayerPauseFilled size={18} stroke={2} />
							)}
						</Button>
					))}
				</div>
			</div>

			{moveToast ? (
				<div className="fixed bottom-4 left-1/2 z-[100] w-[90%] max-w-xl -translate-x-1/2">
					<MoveToast
						key={`${moveToast.job?.Id ?? 'unknown'}-${moveToast.seconds}-${moveToast.firedBy.id}`}
						historicalPlayers={historicalPlayers}
						seconds={moveToast.seconds}
						firedBy={moveToast.firedBy}
						job={moveToast.job}
						staticBaseUrl={data.staticBaseUrl}
						onClose={() => setMoveToast(null)}
					/>
				</div>
			) : null}
		</>
	);
}
