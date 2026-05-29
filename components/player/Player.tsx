'use client';

import {
	type ChangeEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
	MediaPlayer,
	MediaProvider,
	Poster,
	TextTrack,
	type MediaKeyShortcuts,
	type MediaPlayerInstance
} from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import JASSUB from 'jassub';
import {
	IconAlertOctagonFilled,
	IconBrandYoutubeFilled,
	IconCheck,
	IconHeadphones,
	IconHeadphonesOff,
	IconMicrophone,
	IconMicrophoneOff,
	IconMoon,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconSettings2,
	IconSun,
	IconTableExport
} from '@tabler/icons-react';
import { useAppState } from '@/lib/app-state';
import { useTheme } from '@/lib/theme';
import { createNotificationAudioUrl } from '@/lib/player/notification-audio';
import { getSoundEffect } from '@/lib/player/sound-effects';
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
	type ServerData,
	type YouTubeSyncState
} from '@/lib/player/t';
import SUPtitles from '@/lib/suptitles/suptitles';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import * as Dialog from '@/components/ui/dialog';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import * as Tooltip from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Chatbox } from '@/components/player/Chatbox';
import { Pfp } from '@/components/player/Pfp';
import { ConnectButton } from '@/components/player/ConnectButton';
import { MediaSelection, type MediaSelectionHandle } from '@/components/player/MediaSelection';
import { MoveToast } from '@/components/player/MoveToast';
import { Chats } from '@/components/player/Chats';
import { useVoiceChat } from '@/components/player/useVoiceChat';
import { YouTubeFloatingTab } from '@/components/player/YouTubeFloatingTab';

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

type LocalSystemMessage = Chat & {
	isSystem: true;
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

const PLAYER_VOLUME_STORAGE_KEY = 'volume';
const DEFAULT_PLAYER_VOLUME = 1;

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

const DEFAULT_YOUTUBE_SYNC_STATE: YouTubeSyncState = {
	open: false,
	url: '',
	videoId: '',
	time: 0,
	paused: true,
	playbackRate: 1,
	updatedAt: 0
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function normalizeYouTubeSyncState(state: Partial<YouTubeSyncState> | null | undefined) {
	const playbackRate =
		typeof state?.playbackRate === 'number' && Number.isFinite(state.playbackRate)
			? Math.max(0.25, Math.min(4, state.playbackRate))
			: DEFAULT_YOUTUBE_SYNC_STATE.playbackRate;
	const videoId =
		typeof state?.videoId === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(state.videoId)
			? state.videoId
			: '';
	return {
		open: Boolean(state?.open),
		url: typeof state?.url === 'string' ? state.url : '',
		videoId,
		time:
			typeof state?.time === 'number' && Number.isFinite(state.time) && state.time > 0
				? state.time
				: 0,
		paused: state?.paused === false ? false : true,
		playbackRate,
		updatedAt:
			typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0
	};
}

function readStoredYouTubeSyncState(storageKey: string): YouTubeSyncState {
	if (typeof window === 'undefined') {
		return DEFAULT_YOUTUBE_SYNC_STATE;
	}
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (!stored) {
			return DEFAULT_YOUTUBE_SYNC_STATE;
		}
		return normalizeYouTubeSyncState(JSON.parse(stored) as Partial<YouTubeSyncState>);
	} catch {
		return DEFAULT_YOUTUBE_SYNC_STATE;
	}
}

function saveStoredYouTubeSyncState(storageKey: string, state: YouTubeSyncState) {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function isMeaningfulYouTubeState(state: YouTubeSyncState) {
	return state.open || state.videoId !== '' || state.url !== '';
}

function normalizePlayerVolume(volume: number): number {
	if (!Number.isFinite(volume)) {
		return DEFAULT_PLAYER_VOLUME;
	}
	return Math.min(1, Math.max(0, volume));
}

function savePlayerVolume(volume: number, muted: boolean) {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(
		PLAYER_VOLUME_STORAGE_KEY,
		normalizePlayerVolume(muted ? 0 : volume).toString()
	);
}

function restorePlayerVolume(player: MediaPlayerInstance, volume: number) {
	const nextVolume = normalizePlayerVolume(volume);
	player.volume = nextVolume;
	player.muted = nextVolume === 0;
}

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

	const captionsButton = player?.querySelector?.('.vds-caption-button');
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
const GENERATED_NAME_MESSAGE_PREFIX = 'generated-name-message';
const SYSTEM_MESSAGE_DURATION_MS = 6000;
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
	return `${adjective}${noun}`;
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

type VoiceChatController = ReturnType<typeof useVoiceChat>;

function RemoteVoiceAudio({ stream, deafened }: { stream: MediaStream; deafened: boolean }) {
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		if (!audioRef.current || audioRef.current.srcObject === stream) {
			return;
		}
		audioRef.current.srcObject = stream;
	}, [stream]);

	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.muted = deafened;
		}
	}, [deafened]);

	return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
}

function VoiceToggleButton({
	active,
	disabled,
	label,
	onClick,
	children
}: {
	active: boolean;
	disabled?: boolean;
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip.Provider delayDuration={0}>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<motion.button
						type="button"
						aria-label={label}
						aria-pressed={active}
						disabled={disabled}
						onClick={onClick}
						whileTap={{ scale: disabled ? 1 : 0.94 }}
						style={{ width: 40, height: 40, minWidth: 40, maxWidth: 40 }}
						className={`inline-flex flex-none cursor-pointer items-center justify-center rounded-xl border p-0 text-sm transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 ${
							active
								? 'border-primary/40 bg-primary text-primary-foreground shadow-sm'
								: 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
						}`}
					>
						<AnimatePresence mode="wait" initial={false}>
							<motion.span
								key={label}
								initial={{ opacity: 0, rotate: -8, scale: 0.82 }}
								animate={{ opacity: 1, rotate: 0, scale: 1 }}
								exit={{ opacity: 0, rotate: 8, scale: 0.82 }}
								transition={{ duration: 0.16, ease: 'easeOut' }}
								className="flex h-5 w-5 items-center justify-center"
							>
								{children}
							</motion.span>
						</AnimatePresence>
					</motion.button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>{label}</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

function VoiceControls({ voice }: { voice: VoiceChatController }) {
	const isMuted = voice.muted || voice.status === 'listen-only';
	const isDeafened = voice.deafened;
	const disabled = voice.status === 'joining' || !voice.desiredJoined;

	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.22, ease: 'easeOut' }}
			className="flex items-center gap-1 rounded-xl border bg-muted/35 p-1 shadow-sm"
		>
			<VoiceToggleButton
				active={!isMuted}
				disabled={disabled}
				label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
				onClick={() => {
					void voice.toggleMuted();
				}}
			>
				{isMuted ? (
					<IconMicrophoneOff size={18} stroke={2} />
				) : (
					<IconMicrophone size={18} stroke={2} />
				)}
			</VoiceToggleButton>
			<VoiceToggleButton
				active={!isDeafened}
				disabled={disabled}
				label={isDeafened ? 'Undeafen' : 'Deafen'}
				onClick={voice.toggleDeafened}
			>
				{isDeafened ? (
					<IconHeadphonesOff size={18} stroke={2} />
				) : (
					<IconHeadphones size={18} stroke={2} />
				)}
			</VoiceToggleButton>
		</motion.div>
	);
}

async function waitForTextTracks(player: any) {
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
	const playerElementRef = useRef<MediaPlayerInstance | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const socketUrlRef = useRef<string | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const reconnectAttemptRef = useRef(0);
	const youtubeSocketRef = useRef<WebSocket | null>(null);
	const pendingYouTubeStateRef = useRef<YouTubeSyncState | null>(null);
	const youtubeStateRef = useRef<YouTubeSyncState>(DEFAULT_YOUTUBE_SYNC_STATE);
	const youtubeStateStorageKeyRef = useRef('');
	const connectRef = useRef<((_forceInteracted?: boolean) => void) | null>(null);
	const profileSyncedRef = useRef(false);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const mediaSelectionRef = useRef<MediaSelectionHandle | null>(null);
	const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
	const soundEffectAudioRef = useRef<HTMLAudioElement | null>(null);
	const supRef = useRef<SUPtitles | null>(null);
	const supPlayingRef = useRef(false);
	const jasRef = useRef<any>(null);
	const fontsRef = useRef<string[]>([]);
	const subtitleTracksRef = useRef<SubtitleTrackInfo[]>([]);
	const selectedSubtitleTrackRef = useRef<SelectedSubtitleTrack | null>(null);
	const prevTrackSrcRef = useRef<string | null>('');
	const lastTickedRef = useRef(0);
	const roomPlayersCountRef = useRef(0);
	const roomPlayersRef = useRef<RoomPlayer[]>([]);
	const lastSentTimeRef = useRef(-100);
	const suppressNextPlaybackSyncRef = useRef(false);
	const awaitingInitialPlaybackSyncRef = useRef(false);
	const inBgRef = useRef(false);
	const exitedRef = useRef(false);
	const interactedRef = useRef(interacted);
	const playerCanPlayRef = useRef(false);
	const chatFocusedSecsRef = useRef(0);
	const volumeInitializedRef = useRef(false);
	const volumeRestoringRef = useRef(false);
	const volumeCanPlayRestoredRef = useRef(false);
	const playbackSyncSuppressionTimerRef = useRef<number | null>(null);
	const [mounted, setMounted] = useState(false);
	const [playerEl, setPlayerEl] = useState<MediaPlayerInstance | null>(null);
	const [playerCanPlay, setPlayerCanPlay] = useState(false);
	const [controlsShowing, setControlsShowing] = useState(false);
	const [playerSmallLayout, setPlayerSmallLayout] = useState(false);
	const [socketConnected, setSocketConnected] = useState(false);
	const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
	const [historicalPlayers, setHistoricalPlayers] = useState<Record<string, RoomPlayer>>({});
	const [roomMessages, setRoomMessages] = useState<Chat[]>([]);
	const [localSystemMessages, setLocalSystemMessages] = useState<LocalSystemMessage[]>([]);
	const [controlsToDisplay, setControlsToDisplay] = useState<SendPayload[]>([]);
	const [selectedCodec, setSelectedCodec] = useState('auto');
	const [selectedAudio, setSelectedAudio] = useState('1-jpn');
	const [supportedCodecs, setSupportedCodecs] = useState<string[]>([]);
	const [copiedRoomLink, setCopiedRoomLink] = useState(false);
	const [exited, setExited] = useState(false);
	const [moveToast, setMoveToast] = useState<MoveToastState | null>(null);
	const [name, setName] = useState('');
	const [profileId, setProfileId] = useState('');
	const [playerId, setPlayerId] = useState('');
	const lastSavedNameRef = useRef('');
	const [initialVolume] = useState(() =>
		normalizePlayerVolume(setGetLsNumber(PLAYER_VOLUME_STORAGE_KEY, DEFAULT_PLAYER_VOLUME))
	);
	const [playerVolume, setPlayerVolume] = useState(initialVolume);
	const [playerMuted, setPlayerMuted] = useState(initialVolume === 0);
	const [renderNow, setRenderNow] = useState(0);
	const BASE_STATIC = `${data.staticBaseUrl}/${job.Id}`;
	const [tickedSecsAgo, setTickedSecsAgo] = useState(-1);
	const [chatFocusedSecs, setChatFocusedSecs] = useState(0);
	const thumbnailVttSrc = `${data.staticBaseUrl}/${job.Id}/storyboard.vtt`;
	const backendBaseUrl = data.backendBaseUrl;
	const roomBase = searchParams.get('room') || searchParams.get('channel_id') || '';
	const room = roomBase ? `${roomBase}${job.Id}` : job.Id;
	const youtubeRoomId = roomBase || job.Id;
	const youtubeSyncRoom = `youtube:${youtubeRoomId}`;
	const youtubeStateStorageKey = `sparkle:youtube-sync-state:${youtubeRoomId}`;
	const [youtubeState, setYoutubeState] = useState<YouTubeSyncState>(() =>
		readStoredYouTubeSyncState(youtubeStateStorageKey)
	);
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
	const effectiveAudioStream = videoSrc?.sCodec
		? job.MappedAudio[videoSrc.sCodec]?.find(
				(stream) => `${stream.Index}-${stream.Language}` === effectiveAudio
			)
		: null;
	const videoSettingsAudioLabel = effectiveAudioStream
		? `${formatPair(effectiveAudioStream)} (${effectiveAudioStream.Index})`
		: effectiveAudio;
	const videoSettingsCodecLabel =
		selectedCodec === 'auto'
			? `Auto ${autoCodec}`.trim()
			: `${codecDisplayMap[selectedCodec] ?? selectedCodec}${formatMbps(job, selectedCodec)}`;
	const videoSettingsSummary = `${videoSettingsAudioLabel} • ${videoSettingsCodecLabel}`;
	const chatHidden = chatLayout === 'hide';
	const setPlayerElement = useCallback((element: MediaPlayerInstance | null) => {
		if (element !== playerElementRef.current) {
			volumeInitializedRef.current = false;
			volumeRestoringRef.current = false;
			volumeCanPlayRestoredRef.current = false;
		}
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

	const addSystemMessage = useCallback((message: string) => {
		const timestamp = Date.now();
		setLocalSystemMessages((prev) => [
			...prev.slice(-3),
			{
				uid: 'system',
				message,
				timestamp,
				mediaSec: playerElementRef.current?.currentTime || 0,
				isStateUpdate: true,
				isSystem: true,
				timeStr: ''
			}
		]);
	}, []);

	const playSoundEffect = useCallback((id: string | undefined) => {
		const effect = getSoundEffect(id);
		if (!effect) {
			return;
		}

		const previous = soundEffectAudioRef.current;
		if (previous) {
			previous.pause();
			previous.currentTime = 0;
		}

		const audio = new Audio(effect.src);
		audio.preload = 'auto';
		audio.volume = 0.72;
		soundEffectAudioRef.current = audio;
		audio.play().catch((error) => {
			console.warn('Unable to play sound effect', error);
		});
	}, []);

	const messagesToDisplay = (() => {
		let nextMessages = [
			...roomMessages.filter((message) => renderNow - message.timestamp < 140000),
			...localSystemMessages.filter(
				(message) => renderNow - message.timestamp < SYSTEM_MESSAGE_DURATION_MS
			)
		];
		const playerHeight = playerEl?.el?.clientHeight ?? 0;
		if (playerHeight < 250) {
			nextMessages = nextMessages.slice(-4);
		} else if (playerHeight < 450) {
			nextMessages = nextMessages.slice(-6);
		} else if (playerHeight < 620) {
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
		return () => {
			soundEffectAudioRef.current?.pause();
			soundEffectAudioRef.current = null;
		};
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
		roomPlayersRef.current = roomPlayers;
	}, [roomPlayers]);

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
			const generatedName = window.localStorage.getItem(GENERATED_NAME_STORAGE_KEY);
			if (
				stored &&
				!stored.startsWith('Anon-') &&
				!(generatedName === stored && /\d/.test(stored))
			) {
				lastSavedNameRef.current = stored;
				setName(stored);
				return;
			}
			const nextGeneratedName = generatePlaceholderName();
			window.localStorage.setItem('name', nextGeneratedName);
			window.localStorage.setItem(GENERATED_NAME_STORAGE_KEY, nextGeneratedName);
			lastSavedNameRef.current = nextGeneratedName;
			setName(nextGeneratedName);
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
		const messageKey = `${GENERATED_NAME_MESSAGE_PREFIX}:${name}`;
		if (window.sessionStorage.getItem(messageKey)) {
			return;
		}
		window.sessionStorage.setItem(messageKey, '1');
		addSystemMessage(`Using placeholder name: ${name}`);
	}, [addSystemMessage, discord?.user, name]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			const storedId = window.localStorage.getItem('id');
			if (storedId) {
				setProfileId(storedId);
			} else {
				const nextId = randomString(14);
				window.localStorage.setItem('id', nextId);
				setProfileId(nextId);
			}

			const sessionPlayerId = randomString(14);
			window.sessionStorage.setItem('playerId', sessionPlayerId);
			setPlayerId(sessionPlayerId);
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
		if (displayName === '' || !profileId || socketRef.current?.readyState !== WebSocket.OPEN) {
			return false;
		}
		send({
			name: displayName,
			profileId,
			type: SyncTypes.ProfileSync,
			discordUser: discord?.user
		});
		return true;
	}, [discord?.user, displayName, profileId, send]);

	const sendSettings = useCallback(() => {
		const selectedTrack = getSelectedSubtitleTrack(
			playerEl,
			typeof document === 'undefined'
				? null
				: (document.querySelector('.media-provider video') as HTMLVideoElement | null),
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
		sendSettings();
	}, [playerEl, sendSettings, videoSrc]);

	const applyYouTubeState = useCallback((nextState: YouTubeSyncState) => {
		const normalized = normalizeYouTubeSyncState(nextState);
		youtubeStateRef.current = normalized;
		setYoutubeState(normalized);
		saveStoredYouTubeSyncState(youtubeStateStorageKeyRef.current, normalized);
	}, []);

	const sendYouTubeSnapshot = useCallback((nextState: YouTubeSyncState, queue = true) => {
		const socket = youtubeSocketRef.current;
		if (queue) {
			pendingYouTubeStateRef.current = nextState;
		}
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(
			JSON.stringify({
				type: SyncTypes.YouTubeSync,
				youtube: nextState
			})
		);
		if (pendingYouTubeStateRef.current === nextState) {
			pendingYouTubeStateRef.current = null;
		}
	}, []);

	const updateYouTubeState = useCallback(
		(patch: Partial<YouTubeSyncState>) => {
			const nextState = normalizeYouTubeSyncState({
				...youtubeStateRef.current,
				...patch,
				updatedAt: Date.now()
			});
			applyYouTubeState(nextState);
			sendYouTubeSnapshot(nextState);
		},
		[applyYouTubeState, sendYouTubeSnapshot]
	);

	useEffect(() => {
		youtubeStateStorageKeyRef.current = youtubeStateStorageKey;
		const timer = window.setTimeout(() => {
			const stored = readStoredYouTubeSyncState(youtubeStateStorageKey);
			applyYouTubeState(stored);
			pendingYouTubeStateRef.current = null;
		}, 0);
		return () => window.clearTimeout(timer);
	}, [applyYouTubeState, youtubeStateStorageKey]);

	useEffect(() => {
		if (!playerId) {
			return;
		}

		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;
		let disposed = false;
		const playerYouTubeId = `${playerId}-youtube`;
		const socketUrl = getBackendWebSocketUrl(
			backendBaseUrl,
			`/sync/${encodeURIComponent(youtubeSyncRoom)}/${encodeURIComponent(playerYouTubeId)}`
		);

		const clearReconnectTimer = () => {
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const connectYouTubeSocket = () => {
			if (disposed) {
				return;
			}
			const existingSocket = youtubeSocketRef.current;
			if (
				existingSocket &&
				(existingSocket.readyState === WebSocket.CONNECTING ||
					existingSocket.readyState === WebSocket.OPEN)
			) {
				return;
			}
			clearReconnectTimer();
			const socket = new WebSocket(socketUrl);
			youtubeSocketRef.current = socket;

			socket.onopen = () => {
				if (youtubeSocketRef.current !== socket) {
					socket.close();
					return;
				}
				reconnectAttempt = 0;
				const pendingState = pendingYouTubeStateRef.current;
				if (pendingState) {
					socket.send(JSON.stringify({ type: SyncTypes.YouTubeSync, youtube: pendingState }));
					pendingYouTubeStateRef.current = null;
				}
				socket.send(JSON.stringify({ type: SyncTypes.NewPlayer }));
			};

			socket.onmessage = (event: MessageEvent) => {
				if (youtubeSocketRef.current !== socket) {
					return;
				}
				const payload: SendPayload = JSON.parse(event.data);
				if (payload.type !== SyncTypes.YouTubeSync || !payload.youtube) {
					return;
				}
				const incoming = normalizeYouTubeSyncState(payload.youtube);
				const current = youtubeStateRef.current;
				if (incoming.updatedAt === 0 && isMeaningfulYouTubeState(current)) {
					sendYouTubeSnapshot(current, false);
					return;
				}
				applyYouTubeState(incoming);
			};

			socket.onerror = () => {
				if (youtubeSocketRef.current === socket) {
					socket.close();
				}
			};

			socket.onclose = () => {
				if (youtubeSocketRef.current !== socket) {
					return;
				}
				youtubeSocketRef.current = null;
				if (disposed) {
					return;
				}
				const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
				reconnectAttempt += 1;
				reconnectTimer = window.setTimeout(() => {
					reconnectTimer = null;
					connectYouTubeSocket();
				}, delay);
			};
		};

		connectYouTubeSocket();

		return () => {
			disposed = true;
			clearReconnectTimer();
			const socket = youtubeSocketRef.current;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				if (socket.readyState !== WebSocket.CLOSED) {
					socket.close();
				}
			}
			if (youtubeSocketRef.current === socket) {
				youtubeSocketRef.current = null;
			}
		};
	}, [applyYouTubeState, backendBaseUrl, playerId, sendYouTubeSnapshot, youtubeSyncRoom]);

	const voice = useVoiceChat({
		playerId,
		roomPlayers,
		socketCommunicating,
		send,
		addSystemMessage
	});
	const { handleVoiceBroadcast, join: joinVoice } = voice;
	const speakingPlayerIds = useMemo(() => new Set(voice.speakingIds), [voice.speakingIds]);
	const displayedRoomPlayers = useMemo(() => {
		if (!playerId) {
			return roomPlayers;
		}
		const currentRoomPlayer = roomPlayers.find((player) => player.id === playerId);
		const selfPlayer: RoomPlayer = currentRoomPlayer ?? {
			id: playerId,
			profileId,
			name: displayName || 'You',
			time: 0,
			paused: true,
			inBg: false,
			audio: effectiveAudio,
			codec: videoSrc?.sCodec || selectedCodec,
			subtitle: '',
			discordUser: discord?.user
		};
		return [
			{ ...selfPlayer, name: selfPlayer.name || displayName || 'You' },
			...roomPlayers.filter((player) => player.id !== playerId)
		];
	}, [
		discord?.user,
		displayName,
		effectiveAudio,
		playerId,
		profileId,
		roomPlayers,
		selectedCodec,
		videoSrc?.sCodec
	]);

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
		},
		[setTickedSecsAgo]
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

	const clearPlaybackSyncSuppression = useCallback(() => {
		if (playbackSyncSuppressionTimerRef.current !== null) {
			window.clearTimeout(playbackSyncSuppressionTimerRef.current);
			playbackSyncSuppressionTimerRef.current = null;
		}
		suppressNextPlaybackSyncRef.current = false;
	}, []);

	const armPlaybackSyncSuppression = useCallback(() => {
		clearPlaybackSyncSuppression();
		suppressNextPlaybackSyncRef.current = true;
		playbackSyncSuppressionTimerRef.current = window.setTimeout(() => {
			playbackSyncSuppressionTimerRef.current = null;
			suppressNextPlaybackSyncRef.current = false;
		}, 1500);
	}, [clearPlaybackSyncSuppression]);

	const consumePlaybackSyncSuppression = useCallback(() => {
		if (!suppressNextPlaybackSyncRef.current) {
			return false;
		}
		clearPlaybackSyncSuppression();
		return true;
	}, [clearPlaybackSyncSuppression]);

	const shouldSendPlaybackSync = useCallback(() => {
		if (awaitingInitialPlaybackSyncRef.current) {
			return false;
		}
		return !consumePlaybackSyncSuppression();
	}, [consumePlaybackSyncSuppression]);

	useEffect(() => {
		return () => clearPlaybackSyncSuppression();
	}, [clearPlaybackSyncSuppression]);

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
				awaitingInitialPlaybackSyncRef.current = true;
				send({ type: SyncTypes.NewPlayer });
				sendSettings();
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
								updatePfp(state.firedBy.profileId || state.firedBy.id, state.timestamp);
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
							if (roomPlayersRef.current.length > 0) {
								const { left, joined } = getLeftAndJoined(
									roomPlayersRef.current,
									state.players,
									playerId
								);
								const playerEvents = [
									...left.map((player) => ({
										...state,
										type: SyncTypes.PlayerLeft,
										firedBy: player
									})),
									...joined.map((player) => ({
										...state,
										type: SyncTypes.PlayerJoined,
										firedBy: player
									}))
								];
								if (playerEvents.length > 0) {
									setControlsToDisplay((controls) => [...controls, ...playerEvents]);
								}
							}
							roomPlayersRef.current = state.players;
							setRoomPlayers(state.players);
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
							awaitingInitialPlaybackSyncRef.current = false;
							if (state.paused === true && player.paused === false) {
								armPlaybackSyncSuppression();
								Promise.resolve(player.pause()).catch((error) => {
									clearPlaybackSyncSuppression();
									console.warn('Unable to sync remote pause', error);
								});
								persistControlState(state);
							} else if (
								state.paused === false &&
								player.paused === true &&
								(!inBgRef.current || (inBgRef.current && roomPlayersCountRef.current > 1))
							) {
								const playFromRemoteSync = () => {
									armPlaybackSyncSuppression();
									Promise.resolve(player.play()).catch((error) => {
										clearPlaybackSyncSuppression();
										console.warn('Unable to sync remote play', error);
									});
								};
								if (player.state.canPlay) {
									playFromRemoteSync();
								} else {
									player.canPlayQueue.enqueue('remote-pause-sync-play', playFromRemoteSync);
								}
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
								case BroadcastTypes.VoiceSignal:
									void handleVoiceBroadcast(state.firedBy?.id, broadcast);
									break;
								case BroadcastTypes.SoundEffect:
									playSoundEffect(broadcast.soundEffect?.id);
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
				awaitingInitialPlaybackSyncRef.current = false;
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
			updatePfp,
			handleVoiceBroadcast,
			playSoundEffect,
			armPlaybackSyncSuppression,
			clearPlaybackSyncSuppression
		]
	);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	const startWatchRoomConnection = useCallback(() => {
		reconnectAttemptRef.current = 0;
		const socket = socketRef.current;
		if (
			!socket ||
			(socket.readyState !== WebSocket.CONNECTING && socket.readyState !== WebSocket.OPEN)
		) {
			awaitingInitialPlaybackSyncRef.current = true;
		}
		interactedRef.current = true;
		setInteracted(true);
		void joinVoice();
		connect(true);
	}, [connect, joinVoice, setInteracted]);

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
		const applyInitialVolume = () => {
			volumeRestoringRef.current = true;
			restorePlayerVolume(player, initialVolume);
			volumeInitializedRef.current = true;
			window.setTimeout(() => {
				volumeRestoringRef.current = false;
			}, 0);
		};
		if (!volumeInitializedRef.current) {
			applyInitialVolume();
		}
		const playerUnsubscribe = player.subscribe?.(
			({ controlsVisible }: { controlsVisible: boolean }) => {
				setControlsShowing(controlsVisible);
			}
		);
		const playerCanPlayUnsubscribe = player.subscribe?.(({ canPlay }: { canPlay: boolean }) => {
			playerCanPlayRef.current = canPlay;
			setPlayerCanPlay(canPlay);
			if (canPlay && interactedRef.current && !socketRef.current) {
				connectRef.current?.();
			}
			if (canPlay && !volumeCanPlayRestoredRef.current) {
				applyInitialVolume();
				volumeCanPlayRestoredRef.current = true;
			}
		});

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
				'.media-provider video'
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
			playerCanPlayRef.current = false;
			setPlayerCanPlay(false);
			playerUnsubscribe?.();
			playerCanPlayUnsubscribe?.();
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
		const playerNode = playerEl?.el;
		if (!playerNode || typeof MutationObserver === 'undefined') {
			return;
		}

		let animationFrame = 0;
		let observedLayout: Element | null = null;
		const layoutObserver = new MutationObserver(() => scheduleUpdate());

		const updateSmallLayout = () => {
			animationFrame = 0;
			const layout = playerNode.querySelector?.('.vds-video-layout') as HTMLElement | null;
			if (layout !== observedLayout) {
				layoutObserver.disconnect();
				observedLayout = layout;
				if (layout) {
					layoutObserver.observe(layout, {
						attributes: true,
						attributeFilter: ['data-sm', 'data-size']
					});
				}
			}
			const isSmallLayout = Boolean(layout?.hasAttribute('data-sm'));
			setPlayerSmallLayout(isSmallLayout);
		};

		function scheduleUpdate() {
			if (animationFrame) {
				return;
			}
			animationFrame = window.requestAnimationFrame(updateSmallLayout);
		}

		const playerObserver = new MutationObserver(() => scheduleUpdate());
		playerObserver.observe(playerNode, { childList: true, subtree: true });
		window.addEventListener('resize', scheduleUpdate);
		scheduleUpdate();

		return () => {
			if (animationFrame) {
				window.cancelAnimationFrame(animationFrame);
			}
			playerObserver.disconnect();
			layoutObserver.disconnect();
			window.removeEventListener('resize', scheduleUpdate);
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
		if (!profileId) {
			addSystemMessage('Avatar upload is not ready yet');
			input.value = '';
			return;
		}
		if (pfp.size > 12000000) {
			addSystemMessage('Avatar file is too large. Max size is 10MB');
			input.value = '';
			return;
		}
		const formData = new FormData();
		formData.append('pfp', pfp);
		try {
			const response = await fetch(joinBackendPath(backendBaseUrl, `/pfp/${profileId}`), {
				method: 'POST',
				body: formData
			});
			if (!response.ok) {
				throw new Error(`Avatar upload failed: ${response.status}`);
			}
			let avatarRevision: number | undefined;
			if (response.headers.get('content-type')?.includes('application/json')) {
				try {
					const payload = (await response.json()) as { revision?: number };
					avatarRevision = payload.revision;
				} catch (error) {
					console.warn('Avatar upload response did not include a revision', error);
				}
			}
			updatePfp(profileId, avatarRevision);
			addSystemMessage('Avatar updated');
		} catch (error) {
			console.error(error);
			addSystemMessage('Avatar upload failed. Please try another image');
		} finally {
			input.value = '';
		}
	}

	function handleNameBlur() {
		if (discord?.user) {
			send({
				type: SyncTypes.ProfileSync,
				name: displayName,
				profileId
			});
			return;
		}
		const nextName = name.trim();
		if (!nextName) {
			setName(lastSavedNameRef.current);
			addSystemMessage('Name cannot be empty');
			return;
		}
		if (nextName !== name) {
			setName(nextName);
		}
		send({
			type: SyncTypes.ProfileSync,
			name: nextName,
			profileId
		});
		window.localStorage.setItem('name', nextName);
		if (nextName !== lastSavedNameRef.current) {
			lastSavedNameRef.current = nextName;
			window.localStorage.removeItem(GENERATED_NAME_STORAGE_KEY);
			addSystemMessage(`Name updated: ${nextName}`);
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
		if (socketCommunicating || !playerCanPlayRef.current) {
			return;
		}
		startWatchRoomConnection();
	}

	const showJoinOverlay = !socketConnected;
	const mediaPlayerClassName = `media-player relative w-full bg-slate-900 ${discord ? 'h-[100dvh]' : 'aspect-video'} ${playerEl && !playerEl.paused && chatFocusedSecs > hideControlsOnChatFocused ? 'chat-controls-hidden' : ''}`;
	const renderControlsChat = (mobileLayout: boolean, suffix: string) => (
		<div
			className="player-chat-control"
			data-player-chat-mount="true"
			data-mobile-layout={mobileLayout ? 'true' : 'false'}
		>
			<Chatbox
				send={send}
				chatFocused={chatFocused}
				focusByShortcut
				controlsShowing={null}
				className="chat-pc"
				inputId={`chat-pc-input-${suffix}`}
				formId={`chat-pc-form-${suffix}`}
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
	);

	return (
		<>
			{voice.remoteAudioStreams.map(({ id, stream }) => (
				<RemoteVoiceAudio key={id} stream={stream} deafened={voice.deafened} />
			))}
			<div className="relative w-full">
				<div
					className={`transition-[filter,opacity] duration-300 ${
						showJoinOverlay ? 'pointer-events-none blur-sm' : 'blur-0'
					}`}
				>
					{mounted ? (
						<MediaPlayer
							className={mediaPlayerClassName}
							src={videoSrc?.src || undefined}
							title={job.Input}
							artist="Let's watch anime!"
							controlsDelay={1500}
							crossOrigin
							keyShortcuts={PLAYER_KEY_SHORTCUTS}
							ref={setPlayerElement}
							muted={playerMuted}
							playsInline
							volume={playerVolume}
							onMediaPlayRequest={() => {
								startWatchRoomConnection();
							}}
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
								if (shouldSendPlaybackSync()) {
									send({ paused: true, type: SyncTypes.PauseSync });
								}
								setCurrentlyWatching((value) => (value ? { ...value, paused: true } : null));
							}}
							onPlay={() => {
								supRef.current?.playHandler();
								if (supRef.current) {
									supPlayingRef.current = true;
								}
								startWatchRoomConnection();
								if (shouldSendPlaybackSync() && interactedRef.current) {
									send({ paused: false, type: SyncTypes.PauseSync });
								}
								setCurrentlyWatching((value) => (value ? { ...value, paused: false } : null));
							}}
							onVolumeChange={({ muted, volume }: { muted: boolean; volume: number }) => {
								if (!volumeInitializedRef.current || volumeRestoringRef.current) {
									return;
								}
								setPlayerVolume(normalizePlayerVolume(volume));
								setPlayerMuted(muted);
								savePlayerVolume(volume, muted);
							}}
						>
							<MediaProvider className="media-provider h-full w-full">
								<Poster className="vds-poster" src={data.preview} alt="" />
								<canvas ref={canvasRef} id="sub-canvas" className="pointer-events-none absolute" />
							</MediaProvider>
							<DefaultVideoLayout
								colorScheme={theme}
								icons={defaultLayoutIcons}
								thumbnails={thumbnailVttSrc}
								slots={{
									largeLayout: {
										beforeCaptionButton: renderControlsChat(false, 'large')
									},
									smallLayout: {
										beforeCaptionButton: renderControlsChat(true, 'small')
									}
								}}
							/>
						</MediaPlayer>
					) : (
						<div className={mediaPlayerClassName} />
					)}
				</div>

				<div
					className="pointer-events-none absolute inset-0 z-50 flex gap-1"
					id="chat-overlay"
					style={chatHidden ? { display: 'none' } : undefined}
				>
					<Chats
						controlsShowing={controlsShowing && playerSmallLayout}
						messagesToDisplay={messagesToDisplay}
						historicalPlayers={historicalPlayers}
						staticBaseUrl={data.staticBaseUrl}
					/>
				</div>
				<AnimatePresence>
					{showJoinOverlay ? (
						<motion.div
							key="join-watch-room-overlay"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.2, ease: 'easeOut' }}
							className="absolute inset-0 z-40 flex items-center justify-center bg-black/10 px-4"
						>
							<ConnectButton
								socketCommunicating={socketCommunicating}
								interacted={interacted}
								exited={exited}
								disabled={!playerCanPlay}
								className="border-white/35 !bg-white/10 px-5 py-5 !text-white shadow-xl shadow-black/20 backdrop-blur-md hover:!bg-white/15 hover:!text-white"
								onClick={handleJoinWatchRoom}
							/>
						</motion.div>
					) : null}
				</AnimatePresence>
			</div>

			<div
				className="flex w-full flex-col gap-4 p-4 font-semibold"
				style={!discord ? { minHeight: 'calc(100dvh - min(100dvh, 56.25vw))' } : undefined}
			>
				<div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-2">
					<div className="flex shrink-0 justify-start">
						<VoiceControls voice={voice} />
					</div>
					<div className="flex shrink-0 items-center justify-end gap-2">
						<Tooltip.Provider delayDuration={0}>
							<Tooltip.Root>
								<Tooltip.Trigger asChild>
									<Button
										variant={theme === 'dark' ? 'outline' : 'default'}
										className="h-10 px-3 max-[380px]:px-2"
										onClick={handleCopyRoomLink}
									>
										{copiedRoomLink ? (
											<>
												<IconCheck className="mr-2 max-sm:hidden" size={16} stroke={2} />
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
										className="h-10 w-10 p-1"
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
					</div>
				</div>

				<div className="mx-auto flex w-full max-w-[90rem] items-center gap-2">
					<Chatbox
						send={send}
						chatFocused={chatFocused}
						controlsShowing={null}
						className="w-full min-w-0"
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

				<div className="mb-3 flex flex-wrap justify-center gap-4 pt-2 sm:pt-3">
					{displayedRoomPlayers.map((player) => {
						const isCurrentUser = player.id === playerId;
						const playerProfileId = player.profileId || player.id;
						const isSpeaking = speakingPlayerIds.has(player.id);
						const playerMuted = isCurrentUser
							? !voice.desiredJoined || voice.status === 'listen-only' || voice.muted
							: (voice.peerMuted[player.id] ?? true);
						const playerBadge = (
							<Button
								variant="outline"
								className={`group relative flex h-auto gap-2 overflow-visible rounded-full rounded-l-full rounded-r-full border-2 py-0 pl-0 pr-4 transition-[background-color,border-color,box-shadow] duration-200 ${
									isSpeaking
										? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_18px_rgba(16,185,129,0.28)]'
										: 'border-input'
								} ${isCurrentUser ? '' : 'cursor-default'}`}
							>
								<span className="relative mr-0.5 shrink-0">
									<Pfp
										className="h-12 w-12"
										id={playerProfileId}
										discordUser={historicalPlayers[player.id]?.discordUser ?? player.discordUser}
										staticBaseUrl={data.staticBaseUrl}
									/>
									<span
										aria-label={playerMuted ? `${player.name} muted` : `${player.name} unmuted`}
										className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-white shadow-[0_0.35rem_1rem_rgba(0,0,0,0.24)] transition-colors ${
											playerMuted ? 'bg-rose-500' : 'bg-emerald-500'
										}`}
									>
										{playerMuted ? (
											<IconMicrophoneOff size={12} stroke={2.15} />
										) : (
											<IconMicrophone size={12} stroke={2.15} />
										)}
									</span>
								</span>
								<span className="player-status-text flex flex-col items-center justify-center gap-0.5 font-semibold">
									<span className="flex w-24 items-center justify-center gap-1 overflow-hidden sm:w-28">
										<span className="min-w-0 overflow-hidden text-ellipsis font-bold">
											{player.name}
										</span>
										{isCurrentUser ? (
											<span className="shrink-0 rounded-[0.25rem] border border-border/70 bg-muted/70 px-1 text-[0.55rem] font-extrabold leading-3 text-muted-foreground">
												You
											</span>
										) : null}
									</span>
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
								{isCurrentUser ? (
									<span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:rotate-45 group-focus-visible:scale-110 group-focus-visible:rotate-45">
										<IconSettings2 size={13} stroke={2} />
									</span>
								) : null}
							</Button>
						);
						if (!isCurrentUser) {
							return <div key={player.id}>{playerBadge}</div>;
						}
						return (
							<Dialog.Root
								key={player.id}
								onOpenChange={(open) => {
									if (!open) {
										handleNameBlur();
									}
								}}
							>
								<Dialog.Trigger asChild>{playerBadge}</Dialog.Trigger>
								<Dialog.Content className="max-w-sm gap-4">
									<Dialog.Title className="text-lg font-bold">Profile Settings</Dialog.Title>
									<Dialog.Description className="sr-only">
										Change your display name and profile picture.
									</Dialog.Description>
									<div className="flex items-center gap-3">
										<label className="custom-file-upload shrink-0">
											<Pfp
												id={profileId || playerProfileId}
												className="h-14 w-14"
												discordUser={discord?.user}
												staticBaseUrl={data.staticBaseUrl}
											/>
											<input
												accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
												onChange={handleAvatarChange}
												type="file"
											/>
										</label>
										<div className="min-w-0 flex-1">
											<label className="mb-1 block text-xs font-bold text-muted-foreground">
												Username
											</label>
											<Input
												disabled={discord?.user !== undefined}
												onBlur={handleNameBlur}
												value={displayName}
												onChange={(event) => setName(event.target.value)}
												type="text"
												className="h-10 min-w-0 focus-visible:ring-transparent"
												placeholder="Name"
											/>
										</div>
									</div>
								</Dialog.Content>
							</Dialog.Root>
						);
					})}
				</div>

				<Card className="mt-auto w-full max-w-[90rem] self-center">
					<CardHeader className="max-sm:pb-0 max-sm:pl-4 max-sm:pr-4 max-sm:pt-4">
						<motion.div
							layout
							className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
							transition={{ duration: 0.24, ease: 'easeOut' }}
						>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<CardTitle>Media</CardTitle>
							</div>
							<div className="flex flex-wrap items-center gap-2 sm:justify-end">
								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												type="button"
												variant="outline"
												className="h-auto min-h-9 gap-2 px-3 py-2"
												onClick={() => updateYouTubeState({ open: true })}
											>
												<IconBrandYoutubeFilled className="text-red-600" size={18} />
												<span>YouTube</span>
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											<p>Open synced YouTube tab</p>
										</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger asChild>
										<Button
											variant={theme === 'dark' ? 'outline' : 'default'}
											className="h-auto min-h-9 max-w-full justify-start gap-2 px-3 py-2 text-left sm:max-w-[24rem]"
										>
											<IconSettings2 className="shrink-0 max-sm:hidden" size={16} stroke={2} />
											<span className="flex min-w-0 flex-col items-start gap-0.5">
												<span className="leading-none">Video Settings</span>
												<span className="block max-w-full truncate text-xs leading-none opacity-75">
													{videoSettingsSummary}
												</span>
											</span>
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content className="w-56">
										<DropdownMenu.Label className="flex items-center justify-between gap-3">
											<span>Video Settings</span>
											<span className="truncate text-xs font-medium text-muted-foreground">
												{job.ExtractedQuality}
											</span>
										</DropdownMenu.Label>
										<DropdownMenu.Separator />
										<DropdownMenu.Group>
											{audiosExistForCodec(job, videoSrc?.sCodec || '') ? (
												<DropdownMenu.RadioGroup value={effectiveAudio} onValueChange={changeAudio}>
													{job.MappedAudio[videoSrc?.sCodec || '']?.map((stream) => {
														const curr = `${stream.Index}-${stream.Language}`;
														return (
															<DropdownMenu.RadioItem key={curr} value={curr}>
																{formatPair(stream)} ({stream.Index})
															</DropdownMenu.RadioItem>
														);
													})}
												</DropdownMenu.RadioGroup>
											) : null}
										</DropdownMenu.Group>
										<DropdownMenu.Separator />
										<DropdownMenu.Group>
											<DropdownMenu.RadioGroup value={selectedCodec} onValueChange={changeCodec}>
												<DropdownMenu.RadioItem value="auto">
													Auto {autoCodec}
												</DropdownMenu.RadioItem>
												{job.EncodedCodecs.map((codec) => (
													<DropdownMenu.RadioItem key={codec} value={codec}>
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
						</motion.div>
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
			</div>

			<YouTubeFloatingTab
				key={youtubeRoomId}
				roomId={youtubeRoomId}
				state={youtubeState}
				onStateChange={updateYouTubeState}
			/>

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
