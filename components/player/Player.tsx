'use client';

import 'vidstack/player';
import 'vidstack/player/ui';
import 'vidstack/player/layouts/default';

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { TextTrack, type MediaKeyShortcuts } from 'vidstack';
import JASSUB from 'jassub';
import {
	IconAlertOctagonFilled,
	IconCheck,
	IconMoon,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconSettings2,
	IconSun,
	IconTableExport
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { useAppState } from '@/lib/app-state';
import { useTheme } from '@/lib/theme';
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

type SubtitleTrackFormat = 'ass' | 'srt' | 'sup' | 'vtt';

type SubtitleTrackInfo = {
	src: string;
	label: string;
	kind: 'subtitles';
	type: string;
	language: string;
	default: boolean;
	format: SubtitleTrackFormat;
};

type SelectedSubtitleTrack = Pick<SubtitleTrackInfo, 'format' | 'label' | 'language' | 'src'> & {
	mode?: TextTrackMode;
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

function getSubtitleFormat(src: string): SubtitleTrackFormat {
	const cleanSrc = src.split(/[?#]/)[0].toLowerCase();
	if (cleanSrc.endsWith('.ass')) {
		return 'ass';
	}
	if (cleanSrc.endsWith('.sup')) {
		return 'sup';
	}
	if (cleanSrc.endsWith('.srt')) {
		return 'srt';
	}
	return 'vtt';
}

function toArray(list: any): any[] {
	if (!list) {
		return [];
	}
	if (typeof list.toArray === 'function') {
		return list.toArray();
	}
	try {
		return Array.from(list);
	} catch {
		return [];
	}
}

function getPublicAssetUrl(src: string) {
	if (/^(https?:)?\/\//.test(src) || src.startsWith('/')) {
		return src;
	}
	return `/scripts/${src}`;
}

function findSubtitleTrack(
	tracks: SubtitleTrackInfo[],
	track:
		| (Partial<Pick<SubtitleTrackInfo, 'label' | 'language' | 'src'>> & { id?: string })
		| null
		| undefined
) {
	if (!track) {
		return null;
	}
	if (track.src) {
		const matchingSrc = tracks.find((candidate) => candidate.src === track.src);
		if (matchingSrc) {
			return matchingSrc;
		}
	}
	if (track.id) {
		const matchingId = tracks.find((candidate) => candidate.src === track.id);
		if (matchingId) {
			return matchingId;
		}
	}
	return (
		tracks.find(
			(candidate) => candidate.label === track.label && candidate.language === track.language
		) || null
	);
}

function selectedFromVidstackTrack(
	track: any,
	tracks: SubtitleTrackInfo[] = []
): SelectedSubtitleTrack | null {
	const matchingTrack = findSubtitleTrack(tracks, track);
	if (matchingTrack) {
		return {
			...matchingTrack,
			mode: track?.mode
		};
	}
	if (!track?.src) {
		return null;
	}
	return {
		src: track.src,
		label: track.label || '',
		language: track.language || '',
		format: getSubtitleFormat(track.src),
		mode: track.mode
	};
}

function getSelectedSubtitleTrack(
	player: any,
	video: HTMLVideoElement | null,
	tracks: SubtitleTrackInfo[],
	requestedTrack: SelectedSubtitleTrack | null = null
): SelectedSubtitleTrack | null {
	if (requestedTrack) {
		return requestedTrack;
	}

	const directSelected = selectedFromVidstackTrack(player?.textTracks?.selected, tracks);
	if (directSelected) {
		return directSelected;
	}

	const showingTrack = toArray(player?.textTracks).find((track) => track?.mode === 'showing');
	const selectedFromList = selectedFromVidstackTrack(showingTrack, tracks);
	if (selectedFromList) {
		return selectedFromList;
	}

	const captionsButton = player?.querySelector?.('media-caption-button');
	const defaultSelected = () =>
		captionsButton?.getAttribute('aria-pressed') === 'true'
			? tracks.find((track) => track.default) || tracks[0] || null
			: null;

	if (!video?.textTracks) {
		return defaultSelected();
	}
	const nativeShowing = Array.from(video.textTracks).find((track) => track.mode === 'showing');
	if (!nativeShowing) {
		return defaultSelected();
	}
	const matchingTrack = findSubtitleTrack(tracks, nativeShowing);
	return matchingTrack ? { ...matchingTrack, mode: nativeShowing.mode } : defaultSelected();
}

function getLatestMessageTimestamp(messages: Chat[]) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (!messages[i].isStateUpdate) {
			return messages[i].timestamp;
		}
	}
	return 0;
}

const GENERATED_NAME_STORAGE_KEY = 'generatedName';
const GENERATED_NAME_TOAST_PREFIX = 'generated-name-toast';
const USERNAME_ADJECTIVES = [
	'Nova',
	'Pixel',
	'Cosmic',
	'Velvet',
	'Solar',
	'Neon',
	'Azure',
	'Midnight',
	'Lucky',
	'Kindred',
	'Echo',
	'Orbit'
];
const USERNAME_NOUNS = [
	'Voyager',
	'Pilot',
	'Sage',
	'Runner',
	'Beacon',
	'Tempo',
	'Comet',
	'Mosaic',
	'Pulse',
	'Bloom',
	'Drift',
	'Harbor'
];

function generatePlaceholderName() {
	const adjective = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
	const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
	const suffix = Math.floor(100 + Math.random() * 900);
	return `${adjective}${noun}${suffix}`;
}

function joinBackendPath(base: string, path: string) {
	if (!base) {
		return path.startsWith('/') ? path : `/${path}`;
	}
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function getBackendWebSocketUrl(base: string, path: string) {
	const fullPath = joinBackendPath(base, path);
	if (/^https?:\/\//.test(fullPath)) {
		const url = new URL(fullPath);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		return url.toString();
	}
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${wsProtocol}//${window.location.host}${fullPath}`;
}

async function waitForTextTracks(player: any) {
	try {
		await window.customElements?.whenDefined('media-player');
	} catch (error) {
		console.log(error);
	}
	for (let i = 0; i < 60; i++) {
		const textTracks = player?.textTracks;
		if (textTracks?.add) {
			return textTracks;
		}
		await new Promise((resolve) => window.setTimeout(resolve, 50));
	}
	return null;
}

export function Player({ data }: { data: ServerData }) {
	const { job } = data;
	const router = useRouter();
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
	const playerElementRef = useRef<any>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const socketUrlRef = useRef<string | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const reconnectAttemptRef = useRef(0);
	const connectRef = useRef<((_forceInteracted?: boolean) => void) | null>(null);
	const profileSyncedRef = useRef(false);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const chatMountRef = useRef<HTMLDivElement | null>(null);
	const mediaSelectionRef = useRef<MediaSelectionHandle | null>(null);
	const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
	const supRef = useRef<SUPtitles | null>(null);
	const supPlayingRef = useRef(false);
	const jasRef = useRef<any>(null);
	const fontsRef = useRef<string[]>([]);
	const subtitleTracksRef = useRef<SubtitleTrackInfo[]>([]);
	const selectedSubtitleTrackRef = useRef<SelectedSubtitleTrack | null>(null);
	const prevTrackSrcRef = useRef<string | null>('');
	const lastTickedRef = useRef(0);
	const roomPlayersCountRef = useRef(0);
	const lastSentTimeRef = useRef(-100);
	const inBgRef = useRef(false);
	const exitedRef = useRef(false);
	const interactedRef = useRef(interacted);
	const playerCanPlayRef = useRef(false);
	const chatFocusedSecsRef = useRef(0);
	const volumeInitializedRef = useRef(false);
	const [mounted, setMounted] = useState(false);
	const [playerEl, setPlayerEl] = useState<any>(null);
	const [chatMountNode, setChatMountNode] = useState<HTMLDivElement | null>(null);
	const [controlsShowing, setControlsShowing] = useState(false);
	const [socketConnected, setSocketConnected] = useState(false);
	const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
	const [historicalPlayers, setHistoricalPlayers] = useState<Record<string, RoomPlayer>>({});
	const [roomMessages, setRoomMessages] = useState<Chat[]>([]);
	const [controlsToDisplay, setControlsToDisplay] = useState<SendPayload[]>([]);
	const [selectedCodec, setSelectedCodec] = useState('auto');
	const [selectedAudio, setSelectedAudio] = useState('1-jpn');
	const [supportedCodecs, setSupportedCodecs] = useState<string[]>([]);
	const [copiedRoomLink, setCopiedRoomLink] = useState(false);
	const [exited, setExited] = useState(false);
	const [moveToast, setMoveToast] = useState<MoveToastState | null>(null);
	const [name, setName] = useState('');
	const [playerId, setPlayerId] = useState('');
	const lastSavedNameRef = useRef('');
	const [initialVolume] = useState(() => setGetLsNumber('volume', 1));
	const [renderNow, setRenderNow] = useState(0);
	const BASE_STATIC = `${data.staticBaseUrl}/${job.Id}`;
	const [tickedSecsAgo, setTickedSecsAgo] = useState(-1);
	const [tickedSecsAgoStr, setTickedSecsAgoStr] = useState('0.00');
	const [chatFocusedSecs, setChatFocusedSecs] = useState(0);
	const thumbnailVttSrc = `${data.staticBaseUrl}/${job.Id}/storyboard.vtt`;
	const backendBaseUrl = data.backendBaseUrl;
	const roomBase = searchParams.get('room') || searchParams.get('channel_id') || '';
	const room = roomBase ? `${roomBase}${job.Id}` : job.Id;
	const getRoomPath = useCallback(
		(id: string) => (roomBase ? `/${id}?room=${encodeURIComponent(roomBase)}` : `/${id}`),
		[roomBase]
	);
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
	const setPlayerElement = useCallback((element: any | null) => {
		playerElementRef.current = element;
		setPlayerEl(element);
	}, []);

	const clearReconnectTimer = useCallback(() => {
		if (reconnectTimerRef.current === null) {
			return;
		}
		window.clearTimeout(reconnectTimerRef.current);
		reconnectTimerRef.current = null;
	}, []);

	const messagesToDisplay = (() => {
		let nextMessages = roomMessages.filter((message) => renderNow - message.timestamp < 140000);
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
			if (control.firedBy && renderNow - control.timestamp < 8000) {
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
		const timer = window.setTimeout(() => setMounted(true), 0);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		interactedRef.current = interacted;
	}, [interacted]);

	useEffect(() => {
		const update = () => setRenderNow(Date.now());
		const timer = window.setTimeout(update, 0);
		const interval = window.setInterval(update, 1000);
		return () => {
			window.clearTimeout(timer);
			window.clearInterval(interval);
		};
	}, []);

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
		roomPlayersCountRef.current = roomPlayers.length;
	}, [roomPlayers.length]);

	useEffect(() => {
		if (!playerEl || typeof customElements === 'undefined') {
			return;
		}
		const player = playerElementRef.current;
		if (!player) {
			return;
		}
		let cancelled = false;
		customElements
			.whenDefined('media-player')
			.then(() => {
				if (!cancelled) {
					player.keyShortcuts = PLAYER_KEY_SHORTCUTS;
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
				const nextName = getName(discord.user) || '';
				lastSavedNameRef.current = nextName;
				setName(nextName);
				return;
			}
			if (name) {
				return;
			}
			const stored = window.localStorage.getItem('name');
			if (stored && !stored.startsWith('Anon-')) {
				lastSavedNameRef.current = stored;
				setName(stored);
				return;
			}
			const generatedName = generatePlaceholderName();
			window.localStorage.setItem('name', generatedName);
			window.localStorage.setItem(GENERATED_NAME_STORAGE_KEY, generatedName);
			lastSavedNameRef.current = generatedName;
			setName(generatedName);
		}, 0);
		return () => window.clearTimeout(timer);
	}, [discord?.user, name]);

	useEffect(() => {
		if (discord?.user || typeof window === 'undefined' || !name) {
			return;
		}
		if (window.localStorage.getItem(GENERATED_NAME_STORAGE_KEY) !== name) {
			return;
		}
		const toastKey = `${GENERATED_NAME_TOAST_PREFIX}:${name}`;
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

	const send = useCallback((data: any) => {
		const socket = socketRef.current;
		if (
			playerElementRef.current &&
			interactedRef.current &&
			socket?.readyState === WebSocket.OPEN
		) {
			console.log('sending: ' + JSON.stringify(data));
			socket.send(JSON.stringify(data));
		}
	}, []);

	const sendProfile = useCallback(() => {
		if (displayName === '' || socketRef.current?.readyState !== WebSocket.OPEN) {
			return false;
		}
		send({
			name: displayName,
			type: SyncTypes.ProfileSync,
			discordUser: discord?.user
		});
		return true;
	}, [discord?.user, displayName, send]);

	const sendSettings = useCallback(() => {
		const selectedTrack = getSelectedSubtitleTrack(
			playerEl,
			typeof document === 'undefined'
				? null
				: (document.querySelector('media-provider video') as HTMLVideoElement | null),
			subtitleTracksRef.current,
			selectedSubtitleTrackRef.current
		);
		send({
			type: SyncTypes.SubtitleSwitch,
			subtitle: selectedTrack?.src
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
		const player = playerElementRef.current;
		if (!player) {
			return;
		}
		player.title = job.Input;
		player.artist = "Let's watch anime!";
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
				supPlayingRef.current = false;
			}
			if (jasRef.current != null) {
				jasRef.current.destroy();
				jasRef.current = null;
			}
			const canvas = canvasRef.current;
			canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
		};

		const setupTracks = async () => {
			if (cancelled) {
				return;
			}
			const player = playerElementRef.current;
			if (!player) {
				return;
			}
			const textTracks = await waitForTextTracks(player);
			if (cancelled || !textTracks) {
				return;
			}
			if (typeof textTracks.clear === 'function') {
				textTracks.clear();
			}
			const fonts: string[] = [];
			const subtitleTracks: SubtitleTrackInfo[] = [];
			selectedSubtitleTrackRef.current = null;
			prevTrackSrcRef.current = '';
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
							const src = `${BASE_STATIC}/${stream.Location}`;
							const format = getSubtitleFormat(src);
							const track: SubtitleTrackInfo = {
								src,
								label: formatPair(stream, true, true),
								kind: 'subtitles',
								type: format === 'ass' ? 'asshuh' : format,
								language: languageSrcMap[stream.Language] || stream.Language,
								default: !defaulted,
								format
							};
							subtitleTracks.push(track);
							const shouldRenderTrackNatively = format === 'vtt' || format === 'srt';
							textTracks.add(
								new TextTrack(
									shouldRenderTrackNatively
										? (track as any)
										: {
												id: src,
												label: track.label,
												kind: track.kind,
												language: track.language,
												default: track.default
											}
								)
							);
							defaulted = true;
							break;
					}
				}
			}
			fontsRef.current = fonts;
			subtitleTracksRef.current = subtitleTracks;
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

	const updateLastTicked = useCallback(
		(resetTimer = false, playersCount = roomPlayersCountRef.current) => {
			if (resetTimer) {
				lastTickedRef.current = Date.now();
			}
			const nextTickedSecsAgo =
				socketRef.current?.readyState === WebSocket.OPEN && playersCount > 0
					? (Date.now() - lastTickedRef.current) / 1000
					: -1;
			setTickedSecsAgo(nextTickedSecsAgo);
			setTickedSecsAgoStr((Math.round(nextTickedSecsAgo * 100) / 100).toFixed(2));
		},
		[]
	);

	const updateTime = useCallback(() => {
		const player = playerElementRef.current;
		if (!player) {
			return;
		}
		const timeRounded = Math.ceil(player.currentTime);
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
	}, [job.Duration, send, setCurrentlyWatching]);

	const connect = useCallback(
		(forceInteracted = false) => {
			const player = playerElementRef.current;
			if ((!forceInteracted && !interactedRef.current) || !player || !playerId) {
				return;
			}
			const socketUrl = getBackendWebSocketUrl(backendBaseUrl, `/sync/${room}/${playerId}`);
			const existingSocket = socketRef.current;
			if (
				existingSocket &&
				socketUrlRef.current === socketUrl &&
				(existingSocket.readyState === WebSocket.CONNECTING ||
					existingSocket.readyState === WebSocket.OPEN)
			) {
				return;
			}
			clearReconnectTimer();
			if (existingSocket && existingSocket.readyState !== WebSocket.CLOSED) {
				existingSocket.onopen = null;
				existingSocket.onmessage = null;
				existingSocket.onerror = null;
				existingSocket.onclose = null;
				existingSocket.close();
			}
			interactedRef.current = true;
			exitedRef.current = false;
			setInteracted(true);
			setExited(false);
			const socket = new WebSocket(socketUrl);
			socketRef.current = socket;
			socketUrlRef.current = socketUrl;
			console.log(`Socket, connecting to ${room}`);
			socket.onopen = () => {
				if (socketRef.current !== socket) {
					socket.close();
					return;
				}
				console.log(`Socket, connected to ${room}`);
				setSocketConnected(true);
				profileSyncedRef.current = sendProfile();
				send({ type: SyncTypes.NewPlayer });
				sendSettings();
				if (!playerElementRef.current?.paused) {
					send({ paused: false, type: SyncTypes.PauseSync });
				}
				updateLastTicked(true);
			};

			socket.onmessage = (event: MessageEvent) => {
				if (socketRef.current !== socket) {
					return;
				}
				const state: SendPayload = JSON.parse(event.data);
				const broadcast = state.broadcast;
				const persistControlState = (payload: any) => {
					if (payload.firedBy !== undefined) {
						setControlsToDisplay((prev) => [...prev, payload]);
					}
				};
				if (player) {
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
							reconnectAttemptRef.current = 0;
							roomPlayersCountRef.current = state.players.length;
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
							updateLastTicked(true, state.players.length);
							setCurrentlyWatching((value) => {
								if (value) {
									return { ...value, roomPlayers: state.players.length };
								}
								return null;
							});
							break;
						case SyncTypes.PauseSync:
							if (state.paused === true && player.paused === false) {
								player.pause();
								persistControlState(state);
							} else if (
								state.paused === false &&
								player.paused === true &&
								(!inBgRef.current || (inBgRef.current && roomPlayersCountRef.current > 1))
							) {
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
				if (socketRef.current !== socket) {
					return;
				}
				console.error('Socket encountered error: ', event);
				socket.close();
			};

			socket.onclose = () => {
				if (socketRef.current !== socket) {
					return;
				}
				console.log(`Socket closed, ${room}`);
				setSocketConnected(false);
				socketRef.current = null;
				socketUrlRef.current = null;
				if (!exitedRef.current && interactedRef.current) {
					clearReconnectTimer();
					const reconnectDelayMs = Math.min(
						30000,
						1000 * 2 ** Math.min(reconnectAttemptRef.current, 5)
					);
					reconnectAttemptRef.current += 1;
					console.log(`Socket reconnecting in ${reconnectDelayMs / 1000}s, ${room}`);
					reconnectTimerRef.current = window.setTimeout(() => {
						reconnectTimerRef.current = null;
						if (socketRef.current || exitedRef.current || !interactedRef.current) {
							return;
						}
						console.log(`Socket reconnecting, ${room}`);
						connectRef.current?.(true);
					}, reconnectDelayMs);
				}
			};
		},
		[
			backendBaseUrl,
			clearReconnectTimer,
			playerId,
			room,
			send,
			sendProfile,
			sendSettings,
			setCurrentlyWatching,
			setInteracted,
			setPageReloadCounter,
			updateLastTicked,
			updatePfp
		]
	);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	const startWatchRoomConnection = useCallback(() => {
		reconnectAttemptRef.current = 0;
		interactedRef.current = true;
		setInteracted(true);
		connect(true);
	}, [connect, setInteracted]);

	useEffect(() => {
		if (
			!playerEl ||
			!playerId ||
			!interactedRef.current ||
			!playerCanPlayRef.current ||
			socketRef.current
		) {
			return;
		}
		connect();
	}, [connect, interacted, playerEl, playerId]);

	useEffect(() => {
		if (!socketConnected || profileSyncedRef.current) {
			return;
		}
		profileSyncedRef.current = sendProfile();
	}, [sendProfile, socketConnected]);

	useEffect(() => {
		return () => {
			clearReconnectTimer();
			exitedRef.current = true;
			const socket = socketRef.current;
			socketRef.current = null;
			socketUrlRef.current = null;
			if (socket && socket.readyState !== WebSocket.CLOSED) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
			}
		};
	}, [clearReconnectTimer]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}

		const setSelectedSubtitleTrack = (track: any, mode?: TextTrackMode) => {
			const nextTrack = selectedFromVidstackTrack(track, subtitleTracksRef.current);
			const nextMode = mode ?? track?.mode;
			selectedSubtitleTrackRef.current =
				nextTrack && (!nextMode || nextMode === 'showing') ? nextTrack : null;
		};

		const handleTextTrackChange = (event: Event) => {
			setSelectedSubtitleTrack((event as CustomEvent).detail);
		};

		const handleTextTrackChangeRequest = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			if (detail?.mode !== 'showing') {
				selectedSubtitleTrackRef.current = null;
				return;
			}
			const requestedTrack =
				typeof detail.index === 'number'
					? subtitleTracksRef.current[detail.index] || playerEl.textTracks?.[detail.index]
					: null;
			setSelectedSubtitleTrack(requestedTrack, detail.mode);
		};

		playerEl.addEventListener?.('text-track-change', handleTextTrackChange);
		playerEl.addEventListener?.('media-text-track-change-request', handleTextTrackChangeRequest);
		playerEl.textTracks?.addEventListener?.('mode-change', handleTextTrackChange);

		return () => {
			playerEl.removeEventListener?.('text-track-change', handleTextTrackChange);
			playerEl.removeEventListener?.(
				'media-text-track-change-request',
				handleTextTrackChangeRequest
			);
			playerEl.textTracks?.removeEventListener?.('mode-change', handleTextTrackChange);
		};
	}, [playerEl]);

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
			playerCanPlayRef.current = canPlay;
			if (canPlay && interactedRef.current && !socketRef.current) {
				connectRef.current?.();
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
		const playRequest = () => {
			startWatchRoomConnection();
		};
		player.addEventListener?.('mouseleave', mouseLeave);
		player.addEventListener?.('media-play-request', playRequest);

		const interval = window.setInterval(() => {
			updateTime();
			updateLastTicked();
			const videoElement = document.querySelector(
				'media-provider video'
			) as HTMLVideoElement | null;
			const selectedTrack = getSelectedSubtitleTrack(
				player,
				videoElement,
				subtitleTracksRef.current,
				selectedSubtitleTrackRef.current
			);
			const selectedTrackSrc = selectedTrack?.src || '';
			if (videoElement && prevTrackSrcRef.current !== selectedTrackSrc) {
				if (supRef.current) {
					supRef.current.dispose();
					supRef.current = null;
					supPlayingRef.current = false;
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
					if (selectedTrack.format === 'sup') {
						fetch(selectedTrack.src)
							.then((response) => {
								if (!response.ok) {
									throw new Error(`Failed to load SUP subtitles: ${response.status}`);
								}
								return response.arrayBuffer();
							})
							.then((buffer) => {
								const file = new Uint8Array(buffer);
								if (!canvasRef.current) {
									return;
								}
								supRef.current = new SUPtitles(canvasRef.current, file, () => {
									return videoElement.currentTime * 1000;
								});
								supPlayingRef.current = false;
								if (!videoElement.paused) {
									supRef.current.playHandler();
									supPlayingRef.current = true;
								}
							})
							.catch((error) => {
								console.error(error);
							});
					} else if (selectedTrack.format === 'ass') {
						const fallback = fallbackFontsMap[selectedTrack.language]
							? fallbackFontsMap[selectedTrack.language]
							: defaultFallback;
						const fallbackFontUrl = getPublicAssetUrl(fallback[1]);
						const availableFonts = {
							[fallback[0]]: fallbackFontUrl
						};
						jasRef.current = new JASSUB({
							video: videoElement,
							subUrl: selectedTrack.src,
							fallbackFont: fallback[0],
							defaultFont: fallback[0],
							availableFonts,
							fonts: [...fontsRef.current, fallbackFontUrl],
							queryFonts: false
						} as any);
						jasRef.current.ready?.catch((error: unknown) => {
							console.error('Failed to initialize ASS subtitles:', error);
						});
					}
				}
				prevTrackSrcRef.current = selectedTrackSrc;
			}
			if (videoElement && selectedTrack?.format === 'sup' && supRef.current) {
				if (videoElement.paused) {
					if (supPlayingRef.current) {
						supRef.current.pauseHandler();
						supPlayingRef.current = false;
					}
				} else if (!supPlayingRef.current) {
					supRef.current.playHandler();
					supPlayingRef.current = true;
				}
			}
			if (chatFocused) {
				chatFocusedSecsRef.current += 1;
				setChatFocusedSecs(chatFocusedSecsRef.current);
			} else {
				chatFocusedSecsRef.current = 0;
				setChatFocusedSecs(0);
			}
			if (!playerEl) {
				return;
			}
		}, 1000);

		return () => {
			window.clearInterval(interval);
			document.removeEventListener('visibilitychange', visibilityChange);
			document.removeEventListener('mousemove', mouseMove);
			player.removeEventListener?.('mouseleave', mouseLeave);
			player.removeEventListener?.('media-play-request', playRequest);
			playerCanPlayRef.current = false;
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
		send,
		startWatchRoomConnection,
		updateLastTicked,
		updateTime,
		interacted
	]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		const ensureChatMount = () => {
			if (chatMountRef.current?.isConnected) {
				return;
			}
			const anchor =
				playerEl.querySelector?.('media-caption-button') ||
				playerEl.querySelector?.('media-title') ||
				playerEl.querySelector?.('media-chapter-title') ||
				document.querySelector('media-caption-button') ||
				document.querySelector('media-title') ||
				document.querySelector('media-chapter-title');
			if (!anchor?.parentNode) {
				return;
			}
			const container = document.createElement('div');
			container.className = 'player-chat-control max-md:hidden';
			container.dataset.playerChatMount = 'true';
			anchor.parentNode.insertBefore(
				container,
				anchor.matches?.('media-caption-button') ? anchor : anchor.nextSibling
			);
			chatMountRef.current = container;
			setChatMountNode(container);
		};

		ensureChatMount();
		const interval = window.setInterval(ensureChatMount, 500);

		return () => {
			window.clearInterval(interval);
			chatMountRef.current?.remove();
			chatMountRef.current = null;
			setChatMountNode(null);
		};
	}, [playerEl]);

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

	async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
		const input = event.currentTarget;
		const pfp = input.files?.[0];
		if (!pfp) {
			return;
		}
		if (!playerId) {
			toast.error('Avatar upload is not ready yet');
			input.value = '';
			return;
		}
		if (pfp.size > 12000000) {
			toast.error('File size too large', {
				description: 'Max file size: 10MB',
				duration: 5000
			});
			input.value = '';
			return;
		}
		const formData = new FormData();
		formData.append('pfp', pfp);
		try {
			const response = await fetch(joinBackendPath(backendBaseUrl, `/pfp/${playerId}`), {
				method: 'POST',
				body: formData
			});
			if (!response.ok) {
				throw new Error(`Avatar upload failed: ${response.status}`);
			}
			updatePfp(playerId);
			send({ type: SyncTypes.PfpSync });
			toast.success('Avatar updated');
		} catch (error) {
			console.error(error);
			toast.error('Avatar upload failed', {
				description: 'Please try another image.'
			});
		} finally {
			input.value = '';
		}
	}

	function handleNameBlur() {
		if (discord?.user) {
			send({
				type: SyncTypes.ProfileSync,
				name: displayName
			});
			return;
		}
		const nextName = name.trim();
		if (!nextName) {
			setName(lastSavedNameRef.current);
			toast.error('Name cannot be empty');
			return;
		}
		if (nextName !== name) {
			setName(nextName);
		}
		send({
			type: SyncTypes.ProfileSync,
			name: nextName
		});
		window.localStorage.setItem('name', nextName);
		if (nextName !== lastSavedNameRef.current) {
			lastSavedNameRef.current = nextName;
			window.localStorage.removeItem(GENERATED_NAME_STORAGE_KEY);
			toast.success('Name updated');
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

	function handleJoinWatchRoom() {
		if (socketCommunicating) {
			return;
		}
		startWatchRoomConnection();
		playerEl?.play?.().catch?.(() => {});
	}

	const mediaPlayerClassName = `media-player relative w-full bg-slate-900 ${discord ? 'h-screen' : ''} ${playerEl && !playerEl.paused && chatFocusedSecs > hideControlsOnChatFocused ? 'chat-controls-hidden' : ''}`;
	const controlsChat =
		chatMountNode &&
		createPortal(
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
			/>,
			chatMountNode
		);

	return (
		<>
			<div className="relative w-full">
				{mounted ? (
					<media-player
						keep-alive
						className={mediaPlayerClassName}
						src={videoSrc?.src || undefined}
						crossorigin
						ref={setPlayerElement}
						playsInline
						onSeeked={() => {
							supRef.current?.seekedHandler(!playerEl?.paused);
							supPlayingRef.current = Boolean(supRef.current && !playerEl?.paused);
						}}
						onSeeking={() => {
							supRef.current?.seekingHandler();
						}}
						onPause={() => {
							supRef.current?.pauseHandler();
							supPlayingRef.current = false;
							send({ paused: true, type: SyncTypes.PauseSync });
							setCurrentlyWatching((value) => (value ? { ...value, paused: true } : null));
						}}
						onPlay={() => {
							supRef.current?.playHandler();
							if (supRef.current) {
								supPlayingRef.current = true;
							}
							startWatchRoomConnection();
							if (interactedRef.current) {
								send({ paused: false, type: SyncTypes.PauseSync });
								setCurrentlyWatching((value) => (value ? { ...value, paused: false } : null));
							}
						}}
					>
						<media-provider className="media-provider h-full w-full">
							<media-poster className="vds-poster" src={data.preview}></media-poster>
							<canvas ref={canvasRef} id="sub-canvas" className="pointer-events-none absolute" />
						</media-provider>
						<media-video-layout
							color-scheme={theme}
							thumbnails={thumbnailVttSrc}
						></media-video-layout>
						{controlsChat}
					</media-player>
				) : (
					<div className={mediaPlayerClassName} />
				)}

				<div
					className="pointer-events-none absolute inset-0 z-50 flex gap-1"
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
			</div>

			<div className="flex w-full flex-col gap-4 p-4 font-semibold">
				<div className="mx-auto flex w-full max-w-[90rem] flex-col gap-2 sm:flex-row sm:items-center">
					<div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-[0_1_17rem]">
						<label className="custom-file-upload shrink-0">
							<Pfp
								id={playerId}
								className="h-12 w-12"
								discordUser={discord?.user}
								staticBaseUrl={data.staticBaseUrl}
							/>
							<input
								accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
								onChange={handleAvatarChange}
								type="file"
							/>
						</label>
						<Input
							disabled={discord?.user !== undefined}
							onBlur={handleNameBlur}
							value={displayName}
							onChange={(event) => setName(event.target.value)}
							type="text"
							className="h-10 min-w-0 flex-1 focus-visible:ring-transparent"
							placeholder="Name"
						/>
					</div>
					<Chatbox
						send={send}
						chatFocused={chatFocused}
						controlsShowing={null}
						className="w-full min-w-0 sm:flex-[1_1_36rem]"
						inputId="chat-page-input"
						formId="chat-page-form"
						useButton
						messages={roomMessages}
						historicalPlayers={historicalPlayers}
						staticBaseUrl={data.staticBaseUrl}
						onFocus={() => {
							setChatFocused(true);
						}}
						onBlur={() => {
							setChatFocused(false);
							chatFocusedSecsRef.current = 0;
							setChatFocusedSecs(0);
						}}
					/>
				</div>

				<Card className="w-full max-w-[90rem] self-center">
					<CardHeader className="max-sm:pb-0 max-sm:pl-4 max-sm:pr-4 max-sm:pt-4">
						<div className="flex items-center justify-center gap-3">
							<div className="flex flex-1 flex-col gap-1 max-sm:mr-4">
								<CardTitle>Media</CardTitle>
								<CardDescription className="max-sm:hidden">
									Codec: {selectedCodec} {autoCodec ?? ''} {job.ExtractedQuality}; Audio:{' '}
									{effectiveAudio}
								</CardDescription>
							</div>
							<ConnectButton
								socketCommunicating={socketCommunicating}
								interacted={interacted}
								exited={exited}
								tickedSecsAgoStr={tickedSecsAgoStr}
								className="max-md:hidden"
								onClick={handleJoinWatchRoom}
							/>
							<div className="flex flex-1 items-center justify-end gap-3 max-sm:gap-2">
								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												variant="outline"
												className="h-9 px-3 font-bold"
												onClick={handleCopyRoomLink}
											>
												{copiedRoomLink ? (
													<>
														<IconCheck className="mr-1.5 h-4 w-4" stroke={2} />
														Copied
													</>
												) : (
													'Share Room'
												)}
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											{copiedRoomLink ? <p>Copied!</p> : <p>Copy the watch room link</p>}
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
							backendBaseUrl={backendBaseUrl}
							bounceToOverride={(id) => {
								if (socketCommunicating && roomPlayers.length > 1 && id !== job.Id) {
									send({
										type: SyncTypes.BroadcastSync,
										broadcast: { type: BroadcastTypes.MoveTo, moveTo: id }
									});
								} else {
									router.push(getRoomPath(id));
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
						onClick={handleJoinWatchRoom}
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
						moveToPath={getRoomPath}
						staticBaseUrl={data.staticBaseUrl}
					/>
				</div>
			) : null}
		</>
	);
}
