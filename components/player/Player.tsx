'use client';

import {
	type ChangeEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
	LibASSTextRenderer,
	MediaPlayer,
	MediaProvider,
	Menu,
	Poster,
	TextTrack,
	useMediaState,
	type LibASSConfig,
	type LibASSConstructor,
	type MediaKeyShortcuts,
	type MediaPlayerInstance,
	type MediaPlayerQuery,
	type MediaProviderInstance
} from '@vidstack/react';
import {
	DefaultMenuButton,
	DefaultMenuRadioGroup,
	DefaultMenuSection,
	DefaultVideoLayout,
	defaultLayoutIcons
} from '@vidstack/react/player/layouts/default';
import {
	IconBrandYoutubeFilled,
	IconCheck,
	IconChess,
	IconHeadphones,
	IconHeadphonesOff,
	IconMicrophone,
	IconMicrophoneOff,
	IconMoon,
	IconPlayerPauseFilled,
	IconPlayerPlayFilled,
	IconRefresh,
	IconSettings2,
	IconSun,
	IconTableExport,
	IconVolume
} from '@tabler/icons-react';
import { useAppState } from '@/lib/app-state';
import { useTheme } from '@/lib/theme';
import { createNotificationAudioUrl } from '@/lib/player/notification-audio';
import { getSoundEffect } from '@/lib/player/sound-effects';
import {
	CHESS_NOTIFICATION_SOUND_IDS,
	type ChessNotificationSoundId
} from '@/lib/player/chess-notifications';
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
	getSubtitleTypeRank,
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
	type LibraryJob,
	type Player as RoomPlayer,
	type PlayerStatus,
	type SendPayload,
	type ServerData,
	type SoundEffectPayload,
	type Stream,
	type ChessBoardTheme,
	type ChessClockSyncState,
	type ChessDrawOfferSyncState,
	type ChessMoveSyncState,
	type ChessPieceSet,
	type ChessPlayerSyncState,
	type ChessResultSyncState,
	type ChessSettingsSyncState,
	type ChessSoundEffectContext,
	type ChessTabPhase,
	type ChessTabSyncState,
	type ChessSyncState,
	type YouTubeTabSyncState,
	type YouTubeSyncState
} from '@/lib/player/t';
import SUPtitles from '@/lib/suptitles/suptitles';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import * as Dialog from '@/components/ui/dialog';
import * as Tooltip from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Chatbox } from '@/components/player/Chatbox';
import { Pfp } from '@/components/player/Pfp';
import { ConnectButton } from '@/components/player/ConnectButton';
import { MediaSelection, type MediaSelectionHandle } from '@/components/player/MediaSelection';
import { MoveToast } from '@/components/player/MoveToast';
import { Chats } from '@/components/player/Chats';
import { useVoiceChat } from '@/components/player/useVoiceChat';
import { YouTubeFloatingTab } from '@/components/player/YouTubeFloatingTab';
import { ChessFloatingTab } from '@/components/player/ChessFloatingTab';
import { CottageGame, CottageGamePlaceholder } from '@/components/player/CottageGame';
import { fetchJobs, joinBackendPath, updateRoomRecord } from '@/lib/player/data';

type VideoSource = {
	src: string;
	type: 'video/mp4';
	codec: string;
	sCodec: string;
	audio: string;
};

type MoveToastState = {
	seconds: number;
	firedBy?: RoomPlayer;
	job: LibraryJob | undefined;
};

type LocalSystemMessage = Chat & {
	isSystem: true;
};

type SubtitleTrackFormat = 'ass' | 'srt' | 'sup' | 'vtt';

type SubtitleTrackInfo = {
	src: string;
	label: string;
	kind: 'subtitles';
	type: SubtitleTrackFormat;
	language: string;
	default: boolean;
	format: SubtitleTrackFormat;
};

type SelectedSubtitleTrack = Pick<SubtitleTrackInfo, 'format' | 'label' | 'language' | 'src'> & {
	mode?: TextTrackMode;
};

const PLAYER_VOLUME_STORAGE_KEY = 'volume';
const DEFAULT_PLAYER_VOLUME = 1;
const REMOTE_MIC_VOLUME_STORAGE_KEY = 'remoteMicVolumes';
const DEFAULT_REMOTE_MIC_VOLUME = 1;
const MAX_REMOTE_MIC_VOLUME = 5;
const MAX_REMOTE_MIC_VOLUME_PERCENT = MAX_REMOTE_MIC_VOLUME * 100;
const SUBTITLE_LANGUAGE_STORAGE_KEY = 'subtitleLanguage';
const ROOM_TIME_SYNC_THRESHOLD_SECONDS = 6;
const AUDIO_LANGUAGE_PRIORITY = ['jpn', 'eng', 'chi'];
const SUBTITLE_LANGUAGE_PRIORITY = ['en'];

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

function isSmallPlayerLayout(width: number, height: number) {
	return width < 576 || height < 380;
}

const PLAYER_SMALL_LAYOUT_QUERY: MediaPlayerQuery = ({ width, height }) =>
	isSmallPlayerLayout(width, height);

function formatDuration(seconds: number) {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return '0 seconds';
	}
	const rounded = Math.ceil(seconds);
	if (rounded < 60) {
		return `${rounded} second${rounded === 1 ? '' : 's'}`;
	}
	const minutes = Math.floor(rounded / 60);
	const remainingSeconds = rounded % 60;
	return `${minutes} minute${minutes === 1 ? '' : 's'}${
		remainingSeconds > 0 ? ` ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}` : ''
	}`;
}

function getCachePruneErrorMessage(payload: CachePruneResponse, status: number) {
	const cooldownSeconds = payload.cooldownSeconds ?? payload.backend?.cooldownSeconds;
	if (cooldownSeconds) {
		return `Cache prune is on cooldown. Try again in ${formatDuration(cooldownSeconds)}.`;
	}
	if (payload.error) {
		return `Cache prune failed: ${payload.error}`;
	}
	if (payload.backend?.error) {
		return `Cache prune failed: ${payload.backend.error}`;
	}
	return `Cache prune failed with HTTP ${status}.`;
}

const DEFAULT_YOUTUBE_SYNC_STATE: YouTubeSyncState = {
	tabs: [],
	updatedAt: 0
};

const DEFAULT_CHESS_SETTINGS: ChessSettingsSyncState = {
	pieceSet: 'classic',
	boardTheme: 'green',
	timed: true,
	minutes: 10,
	incrementSeconds: 0
};
const DEFAULT_CHESS_SYNC_STATE: ChessSyncState = {
	tabs: [],
	updatedAt: 0
};
const DEFAULT_CHESS_FEN = 'start';
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_TAB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CHESS_TAB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CHESS_SQUARE_PATTERN = /^[a-h][1-8]$/;
const MAX_YOUTUBE_TABS = 12;
const MAX_CHESS_TABS = 64;
const MAX_CHESS_MOVES = 600;
const CONTROL_MESSAGE_TTL_MS = 8000;
const MAX_CONTROL_MESSAGES = 40;

type CachePruneResponse = {
	ok?: boolean;
	cooldownSeconds?: number;
	backend?: {
		ok?: boolean;
		cooldownSeconds?: number;
		prunedAt?: number;
		error?: string;
	};
	error?: string;
};

function createDefaultYouTubeTab(id: string): YouTubeTabSyncState {
	return {
		id,
		open: true,
		url: '',
		videoId: '',
		time: 0,
		paused: true,
		playbackRate: 1,
		updatedAt: 0
	};
}

function normalizeYouTubeTabSyncState(
	state: Partial<YouTubeTabSyncState> | null | undefined,
	fallbackId = randomString(10)
): YouTubeTabSyncState | null {
	const id =
		typeof state?.id === 'string' && YOUTUBE_TAB_ID_PATTERN.test(state.id) ? state.id : fallbackId;
	if (!YOUTUBE_TAB_ID_PATTERN.test(id)) {
		return null;
	}
	const playbackRate =
		typeof state?.playbackRate === 'number' && Number.isFinite(state.playbackRate)
			? Math.max(0.25, Math.min(4, state.playbackRate))
			: 1;
	const videoId =
		typeof state?.videoId === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(state.videoId)
			? state.videoId
			: '';
	return {
		id,
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

function normalizeYouTubeSyncState(state: Partial<YouTubeSyncState> | null | undefined) {
	const rawTabs = Array.isArray(state?.tabs) ? state.tabs : [];
	const tabs: YouTubeTabSyncState[] = [];
	const seen = new Set<string>();
	for (const rawTab of rawTabs) {
		if (tabs.length >= MAX_YOUTUBE_TABS) {
			break;
		}
		const tab = normalizeYouTubeTabSyncState(rawTab);
		if (!tab || seen.has(tab.id)) {
			continue;
		}
		seen.add(tab.id);
		tabs.push(tab);
	}

	if (rawTabs.length === 0 && state && 'open' in state) {
		const legacyTab = normalizeYouTubeTabSyncState(state as Partial<YouTubeTabSyncState>, 'legacy');
		if (legacyTab) {
			tabs.push(legacyTab);
		}
	}

	return {
		tabs,
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
	if (typeof window === 'undefined' || !storageKey) {
		return;
	}
	window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function isMeaningfulYouTubeState(state: YouTubeSyncState) {
	return state.tabs.some((tab) => tab.open || tab.videoId !== '' || tab.url !== '');
}

function getDefaultChessClocks(settings: ChessSettingsSyncState): ChessClockSyncState {
	const duration = settings.minutes * 60_000;
	return { w: duration, b: duration, lastTickAt: 0 };
}

function createDefaultChessTab(
	id: string,
	player: ChessPlayerSyncState | null = null
): ChessTabSyncState {
	return {
		id,
		open: true,
		phase: 'setup',
		settings: DEFAULT_CHESS_SETTINGS,
		white: player,
		black: null,
		fen: DEFAULT_CHESS_FEN,
		moves: [],
		clocks: getDefaultChessClocks(DEFAULT_CHESS_SETTINGS),
		result: null,
		closeRequest: null,
		drawOffer: null,
		updatedAt: 0
	};
}

function normalizeChessPlayer(
	player: Partial<ChessPlayerSyncState> | null | undefined
): ChessPlayerSyncState | null {
	if (!player || typeof player.id !== 'string' || !CHESS_TAB_ID_PATTERN.test(player.id)) {
		return null;
	}
	const name =
		typeof player.name === 'string' && player.name.trim() ? player.name.trim() : 'Player';
	const profileId =
		typeof player.profileId === 'string' && CHESS_TAB_ID_PATTERN.test(player.profileId)
			? player.profileId
			: undefined;
	return {
		id: player.id,
		name: name.slice(0, 80),
		...(profileId ? { profileId } : {})
	};
}

function normalizeChessSettings(
	settings: Partial<ChessSettingsSyncState> | null | undefined
): ChessSettingsSyncState {
	const pieceSet: ChessPieceSet =
		settings?.pieceSet === 'classic' ||
		settings?.pieceSet === 'pixel' ||
		settings?.pieceSet === 'pixel-wood' ||
		settings?.pieceSet === 'pixel-simple'
			? settings.pieceSet
			: DEFAULT_CHESS_SETTINGS.pieceSet;
	const boardTheme: ChessBoardTheme =
		settings?.boardTheme === 'blue' || settings?.boardTheme === 'walnut'
			? settings.boardTheme
			: DEFAULT_CHESS_SETTINGS.boardTheme;
	const minutes =
		typeof settings?.minutes === 'number' && Number.isFinite(settings.minutes)
			? Math.max(1, Math.min(180, Math.round(settings.minutes)))
			: DEFAULT_CHESS_SETTINGS.minutes;
	const incrementSeconds =
		typeof settings?.incrementSeconds === 'number' && Number.isFinite(settings.incrementSeconds)
			? Math.max(0, Math.min(120, Math.round(settings.incrementSeconds)))
			: DEFAULT_CHESS_SETTINGS.incrementSeconds;
	return {
		pieceSet,
		boardTheme,
		timed: settings?.timed === false ? false : true,
		minutes,
		incrementSeconds
	};
}

function normalizeChessClocks(
	clocks: Partial<ChessClockSyncState> | null | undefined,
	settings: ChessSettingsSyncState
): ChessClockSyncState {
	const defaults = getDefaultChessClocks(settings);
	const maxClockMs = 24 * 60 * 60 * 1000;
	return {
		w:
			typeof clocks?.w === 'number' && Number.isFinite(clocks.w)
				? Math.max(0, Math.min(maxClockMs, clocks.w))
				: defaults.w,
		b:
			typeof clocks?.b === 'number' && Number.isFinite(clocks.b)
				? Math.max(0, Math.min(maxClockMs, clocks.b))
				: defaults.b,
		lastTickAt:
			typeof clocks?.lastTickAt === 'number' && Number.isFinite(clocks.lastTickAt)
				? Math.max(0, clocks.lastTickAt)
				: 0
	};
}

function normalizeChessMove(
	move: Partial<ChessMoveSyncState> | null | undefined
): ChessMoveSyncState | null {
	if (
		!move ||
		typeof move.from !== 'string' ||
		typeof move.to !== 'string' ||
		!CHESS_SQUARE_PATTERN.test(move.from) ||
		!CHESS_SQUARE_PATTERN.test(move.to)
	) {
		return null;
	}
	const promotion =
		move.promotion === 'q' ||
		move.promotion === 'r' ||
		move.promotion === 'b' ||
		move.promotion === 'n'
			? move.promotion
			: undefined;
	const san = typeof move.san === 'string' ? move.san.slice(0, 32) : '';
	return {
		from: move.from,
		to: move.to,
		...(promotion ? { promotion } : {}),
		san
	};
}

function normalizeChessResult(
	result: Partial<ChessResultSyncState> | null | undefined
): ChessResultSyncState | null {
	if (!result) {
		return null;
	}
	const winner =
		result.winner === 'w' || result.winner === 'b' || result.winner === 'draw' ? result.winner : '';
	return {
		winner,
		reason: typeof result.reason === 'string' ? result.reason.slice(0, 40) : '',
		message: typeof result.message === 'string' ? result.message.slice(0, 160) : ''
	};
}

function resolveBroadcastSoundEffectId(
	soundEffect: SoundEffectPayload | undefined,
	playerId: string
) {
	if (!soundEffect) {
		return undefined;
	}
	if (
		(soundEffect.id !== CHESS_NOTIFICATION_SOUND_IDS.gameOver &&
			soundEffect.id !== CHESS_NOTIFICATION_SOUND_IDS.checkmate) ||
		!soundEffect.chess
	) {
		return soundEffect.id;
	}
	if (soundEffect.chess.reason === 'checkmate') {
		return CHESS_NOTIFICATION_SOUND_IDS.checkmate;
	}
	const playerColor =
		soundEffect.chess.whiteId === playerId
			? 'w'
			: soundEffect.chess.blackId === playerId
				? 'b'
				: null;
	if (!playerColor) {
		return CHESS_NOTIFICATION_SOUND_IDS.spectatorGameOver;
	}
	if (soundEffect.chess.winner === 'draw') {
		return CHESS_NOTIFICATION_SOUND_IDS.draw;
	}
	return soundEffect.chess.winner === playerColor
		? CHESS_NOTIFICATION_SOUND_IDS.win
		: CHESS_NOTIFICATION_SOUND_IDS.lose;
}

function normalizeChessCloseRequest(
	request: Partial<NonNullable<ChessTabSyncState['closeRequest']>> | null | undefined
): ChessTabSyncState['closeRequest'] {
	if (!request) {
		return null;
	}
	const requestedBy = normalizeChessPlayer(request.requestedBy);
	if (!requestedBy) {
		return null;
	}
	const requestedAt =
		typeof request.requestedAt === 'number' && Number.isFinite(request.requestedAt)
			? Math.max(0, request.requestedAt)
			: Date.now();
	const expiresAt =
		typeof request.expiresAt === 'number' && Number.isFinite(request.expiresAt)
			? Math.max(requestedAt + 1000, request.expiresAt)
			: requestedAt + 60_000;
	return { requestedBy, requestedAt, expiresAt };
}

function normalizeChessDrawOffer(
	offer: Partial<ChessDrawOfferSyncState> | null | undefined
): ChessDrawOfferSyncState | null {
	if (!offer) {
		return null;
	}
	const offeredBy = normalizeChessPlayer(offer.offeredBy);
	if (!offeredBy) {
		return null;
	}
	return {
		offeredBy,
		offeredAt:
			typeof offer.offeredAt === 'number' && Number.isFinite(offer.offeredAt)
				? Math.max(0, offer.offeredAt)
				: 0
	};
}

function normalizeChessTabSyncState(
	state: Partial<ChessTabSyncState> | null | undefined,
	fallbackId = randomString(10)
): ChessTabSyncState | null {
	const id =
		typeof state?.id === 'string' && CHESS_TAB_ID_PATTERN.test(state.id) ? state.id : fallbackId;
	if (!CHESS_TAB_ID_PATTERN.test(id)) {
		return null;
	}
	const settings = normalizeChessSettings(state?.settings);
	const phase: ChessTabPhase =
		state?.phase === 'playing' || state?.phase === 'ended' ? state.phase : 'setup';
	const white = normalizeChessPlayer(state?.white);
	const black = normalizeChessPlayer(state?.black);
	const moves = Array.isArray(state?.moves)
		? state.moves
				.map((move) => normalizeChessMove(move))
				.filter((move) => Boolean(move))
				.slice(0, MAX_CHESS_MOVES)
		: [];
	return {
		id,
		open: Boolean(state?.open),
		phase,
		settings,
		white,
		black: white && black?.id === white.id ? null : black,
		fen: typeof state?.fen === 'string' && state.fen.trim() ? state.fen : DEFAULT_CHESS_FEN,
		moves: moves as ChessMoveSyncState[],
		clocks: normalizeChessClocks(state?.clocks, settings),
		result: normalizeChessResult(state?.result),
		closeRequest: normalizeChessCloseRequest(state?.closeRequest),
		drawOffer: phase === 'playing' ? normalizeChessDrawOffer(state?.drawOffer) : null,
		updatedAt:
			typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0
	};
}

function normalizeChessSyncState(state: Partial<ChessSyncState> | null | undefined) {
	const rawTabs = Array.isArray(state?.tabs) ? state.tabs : [];
	const tabs: ChessTabSyncState[] = [];
	const seen = new Set<string>();
	for (const rawTab of rawTabs) {
		if (tabs.length >= MAX_CHESS_TABS) {
			break;
		}
		const tab = normalizeChessTabSyncState(rawTab);
		if (!tab || seen.has(tab.id)) {
			continue;
		}
		seen.add(tab.id);
		tabs.push(tab);
	}
	return {
		tabs,
		updatedAt:
			typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0
	};
}

function readStoredChessSyncState(storageKey: string): ChessSyncState {
	if (typeof window === 'undefined') {
		return DEFAULT_CHESS_SYNC_STATE;
	}
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (!stored) {
			return DEFAULT_CHESS_SYNC_STATE;
		}
		return normalizeChessSyncState(JSON.parse(stored) as Partial<ChessSyncState>);
	} catch {
		return DEFAULT_CHESS_SYNC_STATE;
	}
}

function saveStoredChessSyncState(storageKey: string, state: ChessSyncState) {
	if (typeof window === 'undefined' || !storageKey) {
		return;
	}
	window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function isMeaningfulChessState(state: ChessSyncState) {
	return state.tabs.some((tab) => tab.open || tab.phase !== 'setup' || tab.moves.length > 0);
}

function normalizePlayerVolume(volume: number): number {
	if (!Number.isFinite(volume)) {
		return DEFAULT_PLAYER_VOLUME;
	}
	return Math.min(1, Math.max(0, volume));
}

function normalizeRemoteMicVolume(volume: number): number {
	if (!Number.isFinite(volume)) {
		return DEFAULT_REMOTE_MIC_VOLUME;
	}
	return Math.min(MAX_REMOTE_MIC_VOLUME, Math.max(0, volume));
}

function readStoredRemoteMicVolumes() {
	if (typeof window === 'undefined') {
		return {};
	}

	const stored = window.localStorage.getItem(REMOTE_MIC_VOLUME_STORAGE_KEY);
	if (!stored) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stored);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}

	const volumes: Record<string, number> = {};
	for (const [playerId, volume] of Object.entries(parsed)) {
		if (!playerId) {
			continue;
		}
		const normalized = normalizeRemoteMicVolume(Number(volume));
		if (normalized !== DEFAULT_REMOTE_MIC_VOLUME) {
			volumes[playerId] = normalized;
		}
	}
	return volumes;
}

function saveRemoteMicVolume(playerId: string, volume: number) {
	if (typeof window === 'undefined' || !playerId) {
		return;
	}

	const normalized = normalizeRemoteMicVolume(volume);
	const volumes = readStoredRemoteMicVolumes();
	if (normalized === DEFAULT_REMOTE_MIC_VOLUME) {
		delete volumes[playerId];
	} else {
		volumes[playerId] = normalized;
	}

	if (Object.keys(volumes).length === 0) {
		window.localStorage.removeItem(REMOTE_MIC_VOLUME_STORAGE_KEY);
		return;
	}
	window.localStorage.setItem(REMOTE_MIC_VOLUME_STORAGE_KEY, JSON.stringify(volumes));
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

function getStreamAudioValue(stream: Stream) {
	return `${stream.Index}-${stream.Language}`;
}

function pickPriorityAudioStream(streams: Stream[]) {
	for (const language of AUDIO_LANGUAGE_PRIORITY) {
		const stream = streams.find((candidate) => candidate.Language === language);
		if (stream) {
			return stream;
		}
	}
	return streams[0] ?? null;
}

function getSubtitleLanguage(stream: Stream) {
	return languageSrcMap[stream.Language] || stream.Language;
}

function getSubtitleLanguageBase(language: string) {
	return language.split('-')[0]?.toLowerCase() || language.toLowerCase();
}

function isSameSubtitleLanguage(a: string, b: string) {
	return a === b || getSubtitleLanguageBase(a) === getSubtitleLanguageBase(b);
}

function readStoredSubtitleLanguage() {
	if (typeof window === 'undefined') {
		return null;
	}
	return window.localStorage.getItem(SUBTITLE_LANGUAGE_STORAGE_KEY);
}

function saveStoredSubtitleLanguage(language: string) {
	if (typeof window === 'undefined' || !language) {
		return;
	}
	window.localStorage.setItem(SUBTITLE_LANGUAGE_STORAGE_KEY, language);
}

function pickPrioritySubtitleStreamByLanguage(streams: Stream[], storedLanguage: string | null) {
	if (storedLanguage) {
		const storedMatch = streams.find((stream) =>
			isSameSubtitleLanguage(getSubtitleLanguage(stream), storedLanguage)
		);
		if (storedMatch) {
			return storedMatch;
		}
	}

	for (const language of SUBTITLE_LANGUAGE_PRIORITY) {
		const priorityMatch = streams.find(
			(stream) => getSubtitleLanguageBase(getSubtitleLanguage(stream)) === language
		);
		if (priorityMatch) {
			return priorityMatch;
		}
	}

	return streams[0] ?? null;
}

function pickPrioritySubtitleStream(streams: Stream[], storedLanguage: string | null) {
	const streamsByTypeRank = new Map<number, Stream[]>();

	for (const stream of streams) {
		const typeRank = getSubtitleTypeRank(stream);
		const rankedStreams = streamsByTypeRank.get(typeRank);
		if (rankedStreams) {
			rankedStreams.push(stream);
		} else {
			streamsByTypeRank.set(typeRank, [stream]);
		}
	}

	for (const typeRank of [...streamsByTypeRank.keys()].sort((a, b) => a - b)) {
		const priorityMatch = pickPrioritySubtitleStreamByLanguage(
			streamsByTypeRank.get(typeRank) ?? [],
			storedLanguage
		);
		if (priorityMatch) {
			return priorityMatch;
		}
	}

	return streams[0] ?? null;
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

function getChapterTimeSeconds(chapter: Job['Chapters'][number], key: 'start' | 'end') {
	const textValue = key === 'start' ? chapter.start_time : chapter.end_time;
	const parsedTextValue = Number.parseFloat(textValue ?? '');
	if (Number.isFinite(parsedTextValue)) {
		return parsedTextValue;
	}

	const rawValue = chapter[key];
	if (!Number.isFinite(rawValue)) {
		return null;
	}

	const timeBaseMatch = chapter.time_base?.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
	if (timeBaseMatch) {
		const numerator = Number.parseFloat(timeBaseMatch[1]);
		const denominator = Number.parseFloat(timeBaseMatch[2]);
		if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
			return rawValue * (numerator / denominator);
		}
	}

	return Math.abs(rawValue) > 24 * 60 * 60 ? rawValue / 1_000_000_000 : rawValue;
}

function getPlayerVideoElement(player: MediaPlayerInstance | null) {
	if (!player) {
		return null;
	}
	try {
		const provider = player.provider;
		const providerVideo = provider && 'video' in provider ? (provider.video as unknown) : null;
		if (typeof HTMLVideoElement !== 'undefined' && providerVideo instanceof HTMLVideoElement) {
			return providerVideo;
		}
	} catch {
		// Vidstack can briefly expose a torn-down provider while media is switching.
	}
	try {
		return (player.el?.querySelector?.('video') as HTMLVideoElement | null) ?? null;
	} catch {
		return null;
	}
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

	let playerTextTracks: any = null;
	try {
		playerTextTracks = player?.textTracks;
	} catch {
		playerTextTracks = null;
	}

	const directSelected = selectedFromVidstackTrack(playerTextTracks?.selected, tracks);
	if (directSelected) {
		return directSelected;
	}

	const showingTrack = toArray(playerTextTracks).find((track) => track?.mode === 'showing');
	const selectedFromList = selectedFromVidstackTrack(showingTrack, tracks);
	if (selectedFromList) {
		return selectedFromList;
	}

	if (!video?.textTracks) {
		return null;
	}
	const nativeShowing = Array.from(video.textTracks).find((track) => track.mode === 'showing');
	if (!nativeShowing) {
		return null;
	}
	const matchingTrack = findSubtitleTrack(tracks, nativeShowing);
	return matchingTrack ? { ...matchingTrack, mode: nativeShowing.mode } : null;
}

function areDiscordUsersEqual(
	a: Discord['user'] | null | undefined,
	b: Discord['user'] | null | undefined
) {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.id === b.id &&
		a.username === b.username &&
		a.discriminator === b.discriminator &&
		a.avatar === b.avatar &&
		a.global_name === b.global_name &&
		a.public_flags === b.public_flags
	);
}

function areRoomPlayersEqual(a: RoomPlayer[], b: RoomPlayer[]) {
	if (a === b) {
		return true;
	}
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		const left = a[i];
		const right = b[i];
		if (
			left.id !== right.id ||
			left.profileId !== right.profileId ||
			left.name !== right.name ||
			left.time !== right.time ||
			left.paused !== right.paused ||
			left.inBg !== right.inBg ||
			left.audio !== right.audio ||
			left.codec !== right.codec ||
			left.subtitle !== right.subtitle ||
			!areDiscordUsersEqual(left.discordUser, right.discordUser)
		) {
			return false;
		}
	}
	return true;
}

function areHistoricalPlayersEqual(current: RoomPlayer | undefined, next: RoomPlayer) {
	return Boolean(
		current &&
		current.name === next.name &&
		current.profileId === next.profileId &&
		areDiscordUsersEqual(current.discordUser, next.discordUser)
	);
}

function appendControlMessages(
	current: SendPayload[],
	incoming: SendPayload | SendPayload[],
	now = Date.now()
) {
	const messages = Array.isArray(incoming) ? incoming : [incoming];
	return [...current, ...messages]
		.filter((message) => now - message.timestamp < CONTROL_MESSAGE_TTL_MS)
		.slice(-MAX_CONTROL_MESSAGES);
}

function getLatestMessageTimestamp(messages: Chat[]) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (!messages[i].isStateUpdate) {
			return messages[i].timestamp;
		}
	}
	return 0;
}

function appendRoomChatMessage(current: Chat[], message: Chat) {
	return [...current, message].slice(-MAX_ROOM_MESSAGES);
}

function mergeRoomPlayerStatuses(players: RoomPlayer[], statuses: PlayerStatus[]) {
	if (statuses.length === 0 || players.length === 0) {
		return players;
	}
	const statusById = new Map(statuses.map((status) => [status.id, status]));
	let changed = false;
	const next = players.map((player) => {
		const status = statusById.get(player.id);
		if (!status) {
			return player;
		}
		if (
			player.time === status.time &&
			player.paused === status.paused &&
			player.inBg === status.inBg &&
			player.lastSeen === status.lastSeen
		) {
			return player;
		}
		changed = true;
		return {
			...player,
			time: status.time,
			paused: status.paused,
			inBg: status.inBg,
			lastSeen: status.lastSeen
		};
	});
	return changed ? next : players;
}

const GENERATED_NAME_STORAGE_KEY = 'generatedName';
const MAX_ROOM_MESSAGES = 200;
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

function RemoteVoiceAudio({
	stream,
	deafened,
	volume
}: {
	stream: MediaStream;
	deafened: boolean;
	volume: number;
}) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const gainRef = useRef<GainNode | null>(null);
	const normalizedVolume = normalizeRemoteMicVolume(volume);
	const canUseGain = typeof AudioContext !== 'undefined';
	const shouldUseGain = canUseGain && normalizedVolume > 1 && !deafened;

	useEffect(() => {
		if (!audioRef.current || audioRef.current.srcObject === stream) {
			return;
		}
		audioRef.current.srcObject = stream;
	}, [stream]);

	useEffect(() => {
		if (!audioRef.current) {
			return;
		}
		audioRef.current.muted = deafened || shouldUseGain;
	}, [deafened, shouldUseGain]);

	useEffect(() => {
		if (!shouldUseGain) {
			sourceRef.current?.disconnect();
			gainRef.current?.disconnect();
			sourceRef.current = null;
			gainRef.current = null;
			if (audioContextRef.current) {
				void audioContextRef.current.close().catch(() => {});
				audioContextRef.current = null;
			}
			return;
		}

		const context = audioContextRef.current ?? new AudioContext();
		audioContextRef.current = context;
		void context.resume().catch(() => {});
		const source = context.createMediaStreamSource(stream);
		const gain = context.createGain();
		gain.gain.value = DEFAULT_REMOTE_MIC_VOLUME;
		source.connect(gain);
		gain.connect(context.destination);
		sourceRef.current = source;
		gainRef.current = gain;

		return () => {
			source.disconnect();
			gain.disconnect();
			if (sourceRef.current === source) {
				sourceRef.current = null;
			}
			if (gainRef.current === gain) {
				gainRef.current = null;
			}
		};
	}, [shouldUseGain, stream]);

	useEffect(() => {
		if (gainRef.current) {
			gainRef.current.gain.value = normalizedVolume;
		}
		if (audioRef.current) {
			audioRef.current.volume = Math.min(1, normalizedVolume);
		}
	}, [normalizedVolume]);

	useEffect(() => {
		return () => {
			sourceRef.current?.disconnect();
			gainRef.current?.disconnect();
			void audioContextRef.current?.close().catch(() => {});
		};
	}, []);

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
		let textTracks: any = null;
		try {
			textTracks = player?.textTracks;
		} catch {
			textTracks = null;
		}
		if (textTracks?.add) {
			return textTracks;
		}
		await new Promise((resolve) => window.setTimeout(resolve, 50));
	}
	return null;
}

type JASSUBRendererConfig = LibASSConfig & {
	wasmUrl: string;
	modernWasmUrl: string;
	legacyWasmUrl: string;
};

type JASSUBManagedInstance = {
	freeTrack: () => void;
	setTrackByUrl?: (url: string) => void | Promise<void>;
	destroy?: () => void | Promise<void>;
	ready?: Promise<void>;
};

const JASSUB_SCRIPT_URL = '/scripts/jassub.es.js';
const EMPTY_ASS_TRACK = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
let assRendererModulePromise: Promise<{ default: LibASSConstructor }> | null = null;

function withManagedAssRendererCleanup(Constructor: LibASSConstructor): LibASSConstructor {
	const ManagedLibASS = function (config: ConstructorParameters<LibASSConstructor>[0]) {
		const configWithInitialTrack = {
			...config,
			...(!config?.subUrl && !(config as { subContent?: string } | undefined)?.subContent
				? { subContent: EMPTY_ASS_TRACK }
				: {})
		} as ConstructorParameters<LibASSConstructor>[0];
		const instance = new Constructor(configWithInitialTrack) as JASSUBManagedInstance;
		const freeTrack = instance.freeTrack.bind(instance);
		const setTrackByUrl = instance.setTrackByUrl?.bind(instance);
		let destroyed = false;
		let trackRequestId = 0;

		if (setTrackByUrl) {
			instance.setTrackByUrl = (url: string) => {
				const requestId = ++trackRequestId;
				void Promise.resolve(instance.ready)
					.then(() => {
						if (destroyed || requestId !== trackRequestId) {
							return;
						}
						return setTrackByUrl(url);
					})
					.catch((error) => {
						if (!destroyed) {
							console.warn('Unable to start ASS subtitle track', error);
						}
					});
			};
		}

		instance.freeTrack = () => {
			trackRequestId++;
			try {
				freeTrack();
			} catch {
				// JASSUB may already have lost its worker after a fast media switch.
			}
			if (destroyed) {
				return;
			}
			destroyed = true;
			try {
				void Promise.resolve(instance.destroy?.()).catch(() => undefined);
			} catch {
				// JASSUB may already be half-torn-down after a fast track switch.
			}
		};

		return instance;
	};

	return ManagedLibASS as unknown as LibASSConstructor;
}

function loadAssRendererModule() {
	assRendererModulePromise ??= Promise.resolve()
		.then(() => new URL(JASSUB_SCRIPT_URL, window.location.origin).toString())
		.then((scriptUrl) =>
			import(/* webpackIgnore: true */ scriptUrl).then((module) => ({
				default: withManagedAssRendererCleanup((module as { default: LibASSConstructor }).default)
			}))
		);
	return assRendererModulePromise;
}

function ignoreMediaRequestFailure(action: () => unknown) {
	try {
		void Promise.resolve(action()).catch(() => undefined);
	} catch {
		// Vidstack may throw synchronously when a provider capability is unavailable.
	}
}

function getSafePlayerCurrentTime(player: MediaPlayerInstance | null) {
	if (!player) {
		return null;
	}
	try {
		const time = player.currentTime;
		return Number.isFinite(time) ? time : null;
	} catch {
		return null;
	}
}

function getSafePlayerPaused(player: MediaPlayerInstance | null) {
	if (!player) {
		return null;
	}
	try {
		return player.paused === true;
	} catch {
		return null;
	}
}

function getSafePlayerCanPlay(player: MediaPlayerInstance | null) {
	if (!player) {
		return false;
	}
	try {
		return player.state.canPlay === true;
	} catch {
		return false;
	}
}

function setSafePlayerCurrentTime(player: MediaPlayerInstance | null, time: number) {
	if (!player || !Number.isFinite(time)) {
		return false;
	}
	try {
		player.currentTime = time;
		return true;
	} catch (error) {
		console.warn('Unable to sync remote time', error);
		return false;
	}
}

type RemotePlaybackSync = {
	time?: number;
	paused?: boolean;
};

type PendingRemotePlaybackSync = RemotePlaybackSync & {
	roomId: string;
	mediaId: string;
};

export function Player({
	data,
	onRoomMediaChanged
}: {
	data: ServerData;
	onRoomMediaChanged?: (mediaId: string, mediaUpdated?: number) => void | Promise<void>;
}) {
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
	const chessSocketRef = useRef<WebSocket | null>(null);
	const pendingChessStateRef = useRef<ChessSyncState | null>(null);
	const pendingMediaSwitchRef = useRef<string | null>(null);
	const youtubeStateRef = useRef<YouTubeSyncState>(DEFAULT_YOUTUBE_SYNC_STATE);
	const youtubeStateStorageKeyRef = useRef('');
	const chessStateRef = useRef<ChessSyncState>(DEFAULT_CHESS_SYNC_STATE);
	const chessStateStorageKeyRef = useRef('');
	const connectRef = useRef<((_forceInteracted?: boolean) => void) | null>(null);
	const roomMediaCheckRef = useRef<Promise<boolean> | null>(null);
	const profileSyncedRef = useRef(false);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const mediaSelectionRef = useRef<MediaSelectionHandle | null>(null);
	const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
	const soundEffectAudioByPlayerRef = useRef<Record<string, HTMLAudioElement>>({});
	const soundEffectBadgeTimersRef = useRef<Record<string, number>>({});
	const supRef = useRef<SUPtitles | null>(null);
	const supPlayingRef = useRef(false);
	const subtitleTracksRef = useRef<SubtitleTrackInfo[]>([]);
	const selectedSubtitleTrackRef = useRef<SelectedSubtitleTrack | null>(null);
	const prevTrackSrcRef = useRef<string | null>('');
	const lastTickedRef = useRef(0);
	const roomPlayersCountRef = useRef(0);
	const roomPlayersRef = useRef<RoomPlayer[]>([]);
	const lastSentTimeRef = useRef(-100);
	const suppressNextPlaybackSyncRef = useRef(false);
	const awaitingInitialPlaybackSyncRef = useRef(false);
	const pendingRemotePlaybackSyncRef = useRef<PendingRemotePlaybackSync | null>(null);
	const inBgRef = useRef(false);
	const exitedRef = useRef(false);
	const interactedRef = useRef(interacted);
	const playerCanPlayRef = useRef(false);
	const controlsShowingRef = useRef(false);
	const chatFocusedSecsRef = useRef(0);
	const volumeInitializedRef = useRef(false);
	const volumeRestoringRef = useRef(false);
	const volumeCanPlayRestoredRef = useRef(false);
	const playbackSyncSuppressionTimerRef = useRef<number | null>(null);
	const [mounted, setMounted] = useState(false);
	const [playerEl, setPlayerEl] = useState<MediaPlayerInstance | null>(null);
	const [mediaProviderEl, setMediaProviderEl] = useState<MediaProviderInstance | null>(null);
	const [socketConnected, setSocketConnected] = useState(false);
	const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
	const [historicalPlayers, setHistoricalPlayers] = useState<Record<string, RoomPlayer>>({});
	const [roomMessages, setRoomMessages] = useState<Chat[]>([]);
	const [localSystemMessages, setLocalSystemMessages] = useState<LocalSystemMessage[]>([]);
	const [controlsToDisplay, setControlsToDisplay] = useState<SendPayload[]>([]);
	const [soundEffectPlayerIds, setSoundEffectPlayerIds] = useState<Set<string>>(() => new Set());
	const [remoteMicVolumes, setRemoteMicVolumes] = useState<Record<string, number>>(
		readStoredRemoteMicVolumes
	);
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
	const controlsShowing = useMediaState('controlsVisible', playerElementRef);
	const playerCanPlay = useMediaState('canPlay', playerElementRef);
	const playerWidth = useMediaState('width', playerElementRef);
	const playerHeight = useMediaState('height', playerElementRef);
	const playerSmallLayout = isSmallPlayerLayout(playerWidth, playerHeight);
	const [playerVolume, setPlayerVolume] = useState(initialVolume);
	const [playerMuted, setPlayerMuted] = useState(initialVolume === 0);
	const [renderNow, setRenderNow] = useState(0);
	const staticBaseUrl = data.staticBaseUrl;
	const backendBaseUrl = data.backendBaseUrl;
	const BASE_STATIC = `${staticBaseUrl}/${job.Id}`;
	const assRendererConfig = useMemo<JASSUBRendererConfig>(() => {
		const fallbackFontUrls = new Set<string>();
		const availableFonts: Record<string, string> = {};

		for (const [family, filename] of [defaultFallback, ...Object.values(fallbackFontsMap)]) {
			if (!family || !filename) {
				continue;
			}
			const fontUrl = getPublicAssetUrl(filename);
			availableFonts[family.toLowerCase()] = fontUrl;
			fallbackFontUrls.add(fontUrl);
		}

		const attachmentFonts =
			job.Streams?.filter(
				(stream) =>
					stream.CodecType === 'attachment' &&
					typeof stream.Location === 'string' &&
					(/\.(otf|ttf)$/i.test(stream.Location) ||
						stream.Location.toLowerCase().includes('.otf') ||
						stream.Location.toLowerCase().includes('.ttf'))
			).map((stream) => `${BASE_STATIC}/${stream.Location}`) ?? [];

		return {
			workerUrl: getPublicAssetUrl('jassub-worker.js'),
			wasmUrl: getPublicAssetUrl('jassub-worker.wasm'),
			modernWasmUrl: getPublicAssetUrl('jassub-worker-modern.wasm'),
			legacyWasmUrl: getPublicAssetUrl('jassub-worker.wasm.js'),
			fallbackFont: defaultFallback[0].toLowerCase(),
			availableFonts,
			fonts: Array.from(new Set([...attachmentFonts, ...fallbackFontUrls])),
			useLocalFonts: false
		};
	}, [BASE_STATIC, job.Streams]);
	const thumbnailVttSrc = useMemo(() => {
		if (typeof window === 'undefined') {
			return null;
		}
		return new URL(`${BASE_STATIC}/storyboard.vtt`, window.location.origin).toString();
	}, [BASE_STATIC]);
	const [tickedSecsAgo, setTickedSecsAgo] = useState(-1);
	const [chatFocusedSecs, setChatFocusedSecs] = useState(0);
	const posterSrc = data.preview;
	const room = data.roomId;
	const currentRoomRef = useRef(room);
	const currentMediaIdRef = useRef(job.Id);
	const youtubeRoomId = room;
	const youtubeSyncRoom = `youtube:${youtubeRoomId}`;
	const youtubeStateStorageKey = `sparkle:youtube-sync-state:${youtubeRoomId}`;
	const [youtubeState, setYoutubeState] = useState<YouTubeSyncState>(DEFAULT_YOUTUBE_SYNC_STATE);
	const chessRoomId = room;
	const chessSyncRoom = `chess:${chessRoomId}`;
	const chessStateStorageKey = `sparkle:chess-sync-state:${chessRoomId}`;
	const [chessState, setChessState] = useState<ChessSyncState>(DEFAULT_CHESS_SYNC_STATE);

	useLayoutEffect(() => {
		currentRoomRef.current = room;
		currentMediaIdRef.current = job.Id;
	}, [job.Id, room]);

	const discord = discordAuth as Discord | null;
	const discordUser = discord?.user;
	const discordUserId = discordUser?.id || '';
	const isDiscordActivityFrame = searchParams.has('frame_id') || searchParams.has('instance_id');
	const displayName = discordUser ? getName(discordUser) || '' : name;
	const voiceSupported = !isDiscordActivityFrame && !discordUser;
	const socketCommunicating = socketConnected && tickedSecsAgo >= 0 && tickedSecsAgo < 5;
	const currentChessPlayer = useMemo<ChessPlayerSyncState | null>(() => {
		if (!playerId) {
			return null;
		}
		return {
			id: playerId,
			name: displayName || 'You',
			...(profileId ? { profileId } : {})
		};
	}, [displayName, playerId, profileId]);
	const currentCottagePlayer = currentChessPlayer;
	const videoSrc = useMemo<VideoSource | null>(() => {
		const encodedCodecs = job.EncodedCodecs || [];
		const autoCodec =
			supportedCodecs.find((codec) => encodedCodecs.includes(codec)) || encodedCodecs[0];
		const effectiveCodec = selectedCodec === 'auto' ? autoCodec : selectedCodec;
		if (!effectiveCodec) {
			return null;
		}
		const audioStreams = job.MappedAudio[effectiveCodec] ?? [];
		let stream = audioStreams.find((candidate) => getStreamAudioValue(candidate) === selectedAudio);
		if (!stream) {
			stream = pickPriorityAudioStream(audioStreams);
		}
		const effectiveAudio = stream ? getStreamAudioValue(stream) : selectedAudio;
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
	const playerSrcUrl = videoSrc?.src ?? '';
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
	const videoSettingsCodecHeader = ['Codec', job.ExtractedQuality].filter(Boolean).join(' • ');
	const videoSettingsAudioOptions =
		videoSrc?.sCodec && audiosExistForCodec(job, videoSrc.sCodec)
			? (job.MappedAudio[videoSrc.sCodec] ?? []).map((stream) => {
					const value = getStreamAudioValue(stream);
					return {
						label: `${formatPair(stream)} (${stream.Index})`,
						value
					};
				})
			: [];
	const videoSettingsCodecOptions = [
		{
			label: `Auto ${autoCodec}`.trim(),
			value: 'auto'
		},
		...job.EncodedCodecs.map((codec) => ({
			label: `${codecDisplayMap[codec] ?? codec}${formatMbps(job, codec)}${
				supportedCodecs.includes(codec) ? '' : ' (unsupported)'
			}`,
			value: codec
		}))
	];
	const chatHidden = chatLayout === 'hide';
	const setPlayerElement = useCallback((element: MediaPlayerInstance | null) => {
		if (element !== playerElementRef.current) {
			volumeInitializedRef.current = false;
			volumeRestoringRef.current = false;
			volumeCanPlayRestoredRef.current = false;
		}
		if (!element) {
			playerCanPlayRef.current = false;
		}
		playerElementRef.current = element;
		setPlayerEl(element);
	}, []);

	const restoreInitialVolume = useCallback(
		(player: MediaPlayerInstance) => {
			volumeRestoringRef.current = true;
			restorePlayerVolume(player, initialVolume);
			volumeInitializedRef.current = true;
			window.setTimeout(() => {
				volumeRestoringRef.current = false;
			}, 0);
		},
		[initialVolume]
	);

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
				mediaSec: getSafePlayerCurrentTime(playerElementRef.current) ?? 0,
				isStateUpdate: true,
				isSystem: true,
				timeStr: ''
			}
		]);
	}, []);

	const handleChatCommand = useCallback(
		async (message: string) => {
			if (message.trim().toLowerCase() !== '/prune') {
				return false;
			}

			try {
				const response = await fetch('/api/cache/prune', {
					method: 'POST',
					cache: 'no-store'
				});
				const payload = (await response.json().catch(() => ({}))) as CachePruneResponse;
				if (!response.ok || payload.ok === false) {
					addSystemMessage(getCachePruneErrorMessage(payload, response.status));
					return true;
				}
				addSystemMessage('Cache pruned successfully.');
			} catch (error) {
				addSystemMessage(
					`Cache prune failed: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
			return true;
		},
		[addSystemMessage]
	);

	const refreshRoomMedia = useCallback(async () => {
		if (roomMediaCheckRef.current) {
			return roomMediaCheckRef.current;
		}

		const check = (async () => {
			try {
				const response = await fetch(
					joinBackendPath(backendBaseUrl, `/rooms/${encodeURIComponent(room)}`),
					{ cache: 'no-store' }
				);
				if (response.status === 404) {
					router.replace('/');
					return true;
				}
				if (!response.ok) {
					throw new Error(`Room media check failed: ${response.status}`);
				}
				const record = (await response.json()) as { mediaId?: string; mediaUpdated?: number };
				if (record.mediaId && record.mediaId !== job.Id) {
					await onRoomMediaChanged?.(record.mediaId, record.mediaUpdated);
					return true;
				}
			} catch (error) {
				console.warn('Unable to refresh room media', error);
			} finally {
				roomMediaCheckRef.current = null;
			}
			return false;
		})();

		roomMediaCheckRef.current = check;
		return check;
	}, [backendBaseUrl, job.Id, onRoomMediaChanged, room, router]);

	const pulseSoundEffectBadge = useCallback((playerId: string | undefined) => {
		if (!playerId) {
			return;
		}

		const existingTimer = soundEffectBadgeTimersRef.current[playerId];
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		setSoundEffectPlayerIds((prev) => {
			const next = new Set(prev);
			next.add(playerId);
			return next;
		});

		soundEffectBadgeTimersRef.current[playerId] = window.setTimeout(() => {
			delete soundEffectBadgeTimersRef.current[playerId];
			setSoundEffectPlayerIds((prev) => {
				if (!prev.has(playerId)) {
					return prev;
				}
				const next = new Set(prev);
				next.delete(playerId);
				return next;
			});
		}, 1800);
	}, []);

	const playSoundEffect = useCallback((id: string | undefined, playerId: string | undefined) => {
		const effect = getSoundEffect(id);
		if (!effect) {
			return;
		}

		const audioKey = playerId || '__unknown__';
		const previous = soundEffectAudioByPlayerRef.current[audioKey];
		if (previous) {
			previous.pause();
			previous.currentTime = 0;
		}

		const audio = new Audio(effect.src);
		audio.preload = 'auto';
		audio.volume = 0.72;
		soundEffectAudioByPlayerRef.current[audioKey] = audio;
		audio.onended = () => {
			if (soundEffectAudioByPlayerRef.current[audioKey] === audio) {
				delete soundEffectAudioByPlayerRef.current[audioKey];
			}
		};
		audio.play().catch((error) => {
			console.warn('Unable to play sound effect', error);
			if (soundEffectAudioByPlayerRef.current[audioKey] === audio) {
				delete soundEffectAudioByPlayerRef.current[audioKey];
			}
		});
	}, []);

	const messagesToDisplay = useMemo(() => {
		let nextMessages = [
			...roomMessages
				.filter((message) => renderNow - message.timestamp < 140000)
				.map((message) => ({ ...message, timeStr: '' })),
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
					mediaSec: getSafePlayerCurrentTime(playerEl) ?? 0,
					isStateUpdate: true,
					timeStr: ''
				});
			}
		}
		nextMessages.sort((a, b) => a.timestamp - b.timestamp);
		let prevTimeStr = '';
		for (let i = 0; i < nextMessages.length; i++) {
			const currTimeStr = new Date(nextMessages[i].timestamp).toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false
			});
			const timeStr = prevTimeStr === currTimeStr ? '' : currTimeStr;
			nextMessages[i] = { ...nextMessages[i], timeStr };
			if (timeStr) {
				prevTimeStr = timeStr;
			}
		}
		return nextMessages;
	}, [controlsToDisplay, localSystemMessages, playerEl, renderNow, roomMessages]);

	useEffect(() => {
		const timer = window.setTimeout(() => setMounted(true), 0);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		return () => {
			for (const audio of Object.values(soundEffectAudioByPlayerRef.current)) {
				audio.pause();
			}
			soundEffectAudioByPlayerRef.current = {};
			for (const timer of Object.values(soundEffectBadgeTimersRef.current)) {
				window.clearTimeout(timer);
			}
			soundEffectBadgeTimersRef.current = {};
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
			thumbnail: posterSrc,
			timeEntered: Date.now(),
			paused: true,
			totalDuration: 0,
			duration: 0,
			roomPlayers: 1
		});
		if (discord) {
			setInteracted(true);
		}
	}, [discord, job.Id, job.Title, posterSrc, setCurrentlyWatching, setInteracted]);

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
			if (discordUser) {
				const nextName = getName(discordUser) || '';
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
	}, [discordUser, name]);

	useEffect(() => {
		if (discordUser || typeof window === 'undefined' || !name) {
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
	}, [addSystemMessage, discordUser, name]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const timer = window.setTimeout(() => {
			if (discordUserId) {
				window.sessionStorage.setItem('playerId', discordUserId);
				setProfileId(discordUserId);
				setPlayerId(discordUserId);
				return;
			}
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
	}, [discordUserId]);

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
			window.localStorage.removeItem('sAudio');
			const codecToUse =
				selectedCodec === 'auto'
					? supportedCodecs.find((codec) => job.EncodedCodecs?.includes(codec)) ||
						job.EncodedCodecs?.[0]
					: selectedCodec;
			const streams = codecToUse ? (job.MappedAudio[codecToUse] ?? []) : [];
			const nextStream = pickPriorityAudioStream(streams);
			const nextAudio = nextStream ? getStreamAudioValue(nextStream) : '1-jpn';
			setSelectedAudio(nextAudio);
		}, 0);
		return () => window.clearTimeout(timer);
	}, [job.EncodedCodecs, job.MappedAudio, selectedCodec, supportedCodecs]);

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

	const sendChessNotification = useCallback(
		(soundId: ChessNotificationSoundId, chess?: ChessSoundEffectContext) => {
			send({
				type: SyncTypes.BroadcastSync,
				broadcast: {
					type: BroadcastTypes.SoundEffect,
					soundEffect: {
						id: soundId,
						...(chess ? { chess } : {})
					}
				}
			});
		},
		[send]
	);

	const sendProfile = useCallback(() => {
		if (displayName === '' || !profileId || socketRef.current?.readyState !== WebSocket.OPEN) {
			return false;
		}
		send({
			name: displayName,
			profileId,
			type: SyncTypes.ProfileSync,
			discordUser
		});
		return true;
	}, [discordUser, displayName, profileId, send]);

	const sendSettings = useCallback(() => {
		const selectedTrack = getSelectedSubtitleTrack(
			playerEl,
			getPlayerVideoElement(playerEl),
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

	useEffect(() => {
		if (!mediaProviderEl || !playerEl || !playerSrcUrl) {
			return;
		}
		const animationFrame = window.requestAnimationFrame(() => {
			const videoElement = getPlayerVideoElement(playerEl);
			if (videoElement) {
				mediaProviderEl.load(videoElement);
			}
		});
		return () => window.cancelAnimationFrame(animationFrame);
	}, [mediaProviderEl, playerEl, playerSrcUrl]);

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
		(tabId: string, patch: Partial<YouTubeTabSyncState>) => {
			const timestamp = Date.now();
			const current = youtubeStateRef.current;
			const existingTab =
				current.tabs.find((tab) => tab.id === tabId) ?? createDefaultYouTubeTab(tabId);
			const nextTab = normalizeYouTubeTabSyncState(
				{
					...existingTab,
					...patch,
					id: tabId,
					updatedAt: timestamp
				},
				tabId
			);
			if (!nextTab) {
				return;
			}
			const nextTabs = [...current.tabs.filter((tab) => tab.id !== tabId), nextTab].slice(
				-MAX_YOUTUBE_TABS
			);
			const nextState = normalizeYouTubeSyncState({
				tabs: nextTabs,
				updatedAt: timestamp
			});
			applyYouTubeState(nextState);
			sendYouTubeSnapshot(nextState);
		},
		[applyYouTubeState, sendYouTubeSnapshot]
	);

	const openNewYouTubeTab = useCallback(() => {
		if (!socketConnected) {
			return;
		}
		const id = randomString(10);
		updateYouTubeState(id, createDefaultYouTubeTab(id));
	}, [socketConnected, updateYouTubeState]);

	useEffect(() => {
		youtubeStateStorageKeyRef.current = youtubeStateStorageKey;
		const stored = readStoredYouTubeSyncState(youtubeStateStorageKey);
		const timer = window.setTimeout(() => {
			applyYouTubeState(stored);
			pendingYouTubeStateRef.current = null;
		}, 0);
		return () => window.clearTimeout(timer);
	}, [applyYouTubeState, youtubeStateStorageKey]);

	useEffect(() => {
		if (!playerId || !socketConnected) {
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
				if (incoming.updatedAt < current.updatedAt) {
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
	}, [
		applyYouTubeState,
		backendBaseUrl,
		playerId,
		sendYouTubeSnapshot,
		socketConnected,
		youtubeSyncRoom
	]);

	const applyChessState = useCallback((nextState: ChessSyncState) => {
		const normalized = normalizeChessSyncState(nextState);
		chessStateRef.current = normalized;
		setChessState(normalized);
		saveStoredChessSyncState(chessStateStorageKeyRef.current, normalized);
	}, []);

	const sendChessSnapshot = useCallback((nextState: ChessSyncState, queue = true) => {
		const socket = chessSocketRef.current;
		if (queue) {
			pendingChessStateRef.current = nextState;
		}
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(
			JSON.stringify({
				type: SyncTypes.ChessSync,
				chess: nextState
			})
		);
		if (pendingChessStateRef.current === nextState) {
			pendingChessStateRef.current = null;
		}
	}, []);

	const updateChessState = useCallback(
		(tabId: string, patch: Partial<ChessTabSyncState>) => {
			const timestamp = Date.now();
			const current = chessStateRef.current;
			const existingTab =
				current.tabs.find((tab) => tab.id === tabId) ??
				createDefaultChessTab(tabId, currentChessPlayer);
			const nextTabs =
				patch.open === false
					? current.tabs.filter((tab) => tab.id !== tabId)
					: [
							...current.tabs.filter((tab) => tab.id !== tabId),
							normalizeChessTabSyncState(
								{
									...existingTab,
									...patch,
									id: tabId,
									updatedAt: timestamp
								},
								tabId
							)
						].filter((tab): tab is ChessTabSyncState => Boolean(tab));
			const nextState = normalizeChessSyncState({
				tabs: nextTabs.slice(-MAX_CHESS_TABS),
				updatedAt: timestamp
			});
			applyChessState(nextState);
			sendChessSnapshot(nextState);
		},
		[applyChessState, currentChessPlayer, sendChessSnapshot]
	);

	const openNewChessTab = useCallback(() => {
		if (!socketConnected || !currentChessPlayer) {
			return;
		}
		const id = randomString(10);
		updateChessState(id, createDefaultChessTab(id, currentChessPlayer));
	}, [currentChessPlayer, socketConnected, updateChessState]);

	useEffect(() => {
		chessStateStorageKeyRef.current = chessStateStorageKey;
		const stored = readStoredChessSyncState(chessStateStorageKey);
		const timer = window.setTimeout(() => {
			applyChessState(stored);
			pendingChessStateRef.current = null;
		}, 0);
		return () => window.clearTimeout(timer);
	}, [applyChessState, chessStateStorageKey]);

	useEffect(() => {
		if (!playerId || !socketConnected) {
			return;
		}

		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;
		let disposed = false;
		const playerChessId = `${playerId}-chess`;
		const socketUrl = getBackendWebSocketUrl(
			backendBaseUrl,
			`/sync/${encodeURIComponent(chessSyncRoom)}/${encodeURIComponent(playerChessId)}`
		);

		const clearReconnectTimer = () => {
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const connectChessSocket = () => {
			if (disposed) {
				return;
			}
			const existingSocket = chessSocketRef.current;
			if (
				existingSocket &&
				(existingSocket.readyState === WebSocket.CONNECTING ||
					existingSocket.readyState === WebSocket.OPEN)
			) {
				return;
			}
			clearReconnectTimer();
			const socket = new WebSocket(socketUrl);
			chessSocketRef.current = socket;

			socket.onopen = () => {
				if (chessSocketRef.current !== socket) {
					socket.close();
					return;
				}
				reconnectAttempt = 0;
				const pendingState = pendingChessStateRef.current;
				if (pendingState) {
					socket.send(JSON.stringify({ type: SyncTypes.ChessSync, chess: pendingState }));
					pendingChessStateRef.current = null;
				}
				socket.send(JSON.stringify({ type: SyncTypes.NewPlayer }));
			};

			socket.onmessage = (event: MessageEvent) => {
				if (chessSocketRef.current !== socket) {
					return;
				}
				const payload: SendPayload = JSON.parse(event.data);
				if (payload.type !== SyncTypes.ChessSync || !payload.chess) {
					return;
				}
				const incoming = normalizeChessSyncState(payload.chess);
				const current = chessStateRef.current;
				if (incoming.updatedAt === 0 && isMeaningfulChessState(current)) {
					sendChessSnapshot(current, false);
					return;
				}
				if (incoming.updatedAt < current.updatedAt) {
					return;
				}
				applyChessState(incoming);
			};

			socket.onerror = () => {
				if (chessSocketRef.current === socket) {
					socket.close();
				}
			};

			socket.onclose = () => {
				if (chessSocketRef.current !== socket) {
					return;
				}
				chessSocketRef.current = null;
				if (disposed) {
					return;
				}
				const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
				reconnectAttempt += 1;
				reconnectTimer = window.setTimeout(() => {
					reconnectTimer = null;
					connectChessSocket();
				}, delay);
			};
		};

		connectChessSocket();

		return () => {
			disposed = true;
			clearReconnectTimer();
			const socket = chessSocketRef.current;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				if (socket.readyState !== WebSocket.CLOSED) {
					socket.close();
				}
			}
			if (chessSocketRef.current === socket) {
				chessSocketRef.current = null;
			}
		};
	}, [
		applyChessState,
		backendBaseUrl,
		chessSyncRoom,
		playerId,
		sendChessSnapshot,
		socketConnected
	]);

	const voice = useVoiceChat({
		playerId,
		roomPlayers,
		socketCommunicating,
		disabled: !voiceSupported,
		send,
		addSystemMessage
	});
	const { handleVoiceBroadcast, join: joinVoice } = voice;
	const speakingPlayerIds = useMemo(() => new Set(voice.speakingIds), [voice.speakingIds]);
	const setRemoteMicVolume = useCallback((remotePlayerId: string, volume: number) => {
		const normalized = normalizeRemoteMicVolume(volume);
		setRemoteMicVolumes((prev) => {
			const current = prev[remotePlayerId] ?? DEFAULT_REMOTE_MIC_VOLUME;
			if (current === normalized) {
				return prev;
			}
			if (normalized === DEFAULT_REMOTE_MIC_VOLUME) {
				const next = { ...prev };
				delete next[remotePlayerId];
				return next;
			}
			return { ...prev, [remotePlayerId]: normalized };
		});
		saveRemoteMicVolume(remotePlayerId, normalized);
	}, []);
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
			discordUser
		};
		return [
			{ ...selfPlayer, name: selfPlayer.name || displayName || 'You' },
			...roomPlayers.filter((player) => player.id !== playerId)
		];
	}, [
		discordUser,
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

		const assRenderer = new LibASSTextRenderer(loadAssRendererModule, assRendererConfig);
		playerEl.textRenderers.add(assRenderer);

		return () => {
			playerEl.textRenderers.remove(assRenderer);
		};
	}, [assRendererConfig, playerEl]);

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
			const subtitleTracks: SubtitleTrackInfo[] = [];
			selectedSubtitleTrackRef.current = null;
			prevTrackSrcRef.current = '';
			if (job.Streams) {
				const sortedJob = { ...job, Streams: [...job.Streams] };
				sortedJob.Streams = sortTracks(sortedJob);
				const subtitleStreams = sortedJob.Streams.filter(
					(stream) => stream.CodecType === 'subtitle'
				);
				const defaultSubtitleStream = pickPrioritySubtitleStream(
					subtitleStreams,
					readStoredSubtitleLanguage()
				);
				for (const [, stream] of Object.entries(sortedJob.Streams)) {
					switch (stream.CodecType) {
						case 'subtitle':
							const src = `${BASE_STATIC}/${stream.Location}`;
							const format = getSubtitleFormat(src);
							const track: SubtitleTrackInfo = {
								src,
								label: formatPair(stream, true, true),
								kind: 'subtitles',
								type: format,
								language: getSubtitleLanguage(stream),
								default: stream === defaultSubtitleStream,
								format
							};
							subtitleTracks.push(track);
							if (format === 'sup') {
								textTracks.add(
									new TextTrack({
										id: src,
										label: track.label,
										kind: track.kind,
										language: track.language,
										default: track.default
									})
								);
							} else {
								textTracks.add(
									new TextTrack({
										src: track.src,
										label: track.label,
										kind: track.kind,
										type: format,
										language: track.language,
										default: track.default
									})
								);
							}
							break;
					}
				}
			}
			subtitleTracksRef.current = subtitleTracks;
			if (job.Chapters && job.Chapters.length > 0) {
				const track = new TextTrack({
					kind: 'chapters',
					language: 'en-US',
					type: 'vtt',
					default: true
				});
				for (const chapter of job.Chapters) {
					const start = getChapterTimeSeconds(chapter, 'start');
					const end = getChapterTimeSeconds(chapter, 'end');
					if (chapter.tags?.title && start != null && end != null && end - start > 2) {
						track.addCue(new VTTCue(start, end, chapter.tags.title));
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
		const currentTime = getSafePlayerCurrentTime(player);
		if (currentTime === null) {
			return;
		}
		const timeRounded = Math.ceil(currentTime);
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

	const queueRemotePlaybackSync = useCallback((sync: RemotePlaybackSync) => {
		const roomId = currentRoomRef.current;
		const mediaId = currentMediaIdRef.current;
		const pending = pendingRemotePlaybackSyncRef.current;
		const sameTarget = pending?.roomId === roomId && pending.mediaId === mediaId;
		pendingRemotePlaybackSyncRef.current = {
			...(sameTarget && pending ? pending : {}),
			...sync,
			roomId,
			mediaId
		};
	}, []);

	const applyRemotePlaybackSync = useCallback(
		(sync: RemotePlaybackSync | PendingRemotePlaybackSync) => {
			if (
				'roomId' in sync &&
				(sync.roomId !== currentRoomRef.current || sync.mediaId !== currentMediaIdRef.current)
			) {
				return true;
			}
			const player = playerElementRef.current;
			if (!player || !getPlayerVideoElement(player)) {
				queueRemotePlaybackSync(sync);
				return false;
			}

			let complete = true;
			if (typeof sync.time === 'number') {
				const currentTime = getSafePlayerCurrentTime(player);
				if (currentTime === null) {
					complete = false;
				} else if (Math.abs(currentTime - sync.time) > ROOM_TIME_SYNC_THRESHOLD_SECONDS) {
					complete = setSafePlayerCurrentTime(player, sync.time) && complete;
				}
			}

			if (typeof sync.paused === 'boolean') {
				const paused = getSafePlayerPaused(player);
				if (paused === null) {
					complete = false;
				} else if (sync.paused) {
					if (!paused) {
						armPlaybackSyncSuppression();
						Promise.resolve(player.pause()).catch((error) => {
							clearPlaybackSyncSuppression();
							console.warn('Unable to sync remote pause', error);
						});
					}
				} else if (!inBgRef.current || roomPlayersCountRef.current > 1) {
					if (paused) {
						if (getSafePlayerCanPlay(player)) {
							armPlaybackSyncSuppression();
							Promise.resolve(player.play()).catch((error) => {
								clearPlaybackSyncSuppression();
								console.warn('Unable to sync remote play', error);
							});
						} else {
							complete = false;
						}
					}
				}
			}

			if (!complete) {
				queueRemotePlaybackSync(sync);
			}
			return complete;
		},
		[armPlaybackSyncSuppression, clearPlaybackSyncSuppression, queueRemotePlaybackSync]
	);

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
				const pendingMediaID = pendingMediaSwitchRef.current;
				if (pendingMediaID && pendingMediaID !== job.Id) {
					pendingMediaSwitchRef.current = null;
					send({
						type: SyncTypes.BroadcastSync,
						broadcast: { type: BroadcastTypes.MoveTo, moveTo: pendingMediaID }
					});
				}
				updateLastTicked(true);
			};

			socket.onmessage = (event: MessageEvent) => {
				if (socketRef.current !== socket) {
					return;
				}
				let state: SendPayload;
				try {
					state = JSON.parse(event.data) as SendPayload;
				} catch (error) {
					console.warn('Ignoring malformed sync payload', error);
					return;
				}
				const broadcast = state.broadcast;
				const persistControlState = (payload: SendPayload) => {
					const isOwnPlaybackControl =
						(payload.type === SyncTypes.PauseSync || payload.type === SyncTypes.TimeSync) &&
						payload.firedBy?.id === playerId;
					if (payload.firedBy !== undefined && !isOwnPlaybackControl) {
						setControlsToDisplay((prev) => appendControlMessages(prev, payload));
					}
				};
				console.debug('received: ' + JSON.stringify(state));
				const initiateMoveTo = (jobs: LibraryJob[]) => {
					pendingRemotePlaybackSyncRef.current = null;
					const target = jobs.find((candidate) => candidate.Id === broadcast!.moveTo);
					if (roomPlayersCountRef.current === 1 && target?.Id) {
						void onRoomMediaChanged?.(target.Id, state.timestamp);
						return;
					}
					setMoveToast({
						seconds: moveSeconds,
						job: target,
						firedBy: state.firedBy
					});
					state.moveToText =
						target?.Title.title + (target?.Title?.episode ? ` ${target.Title.episode.se}` : '');
					setControlsToDisplay((prev) => appendControlMessages(prev, state));
				};
				switch (state.type) {
					case SyncTypes.PfpSync:
						if (state.firedBy?.id) {
							updatePfp(state.firedBy.profileId || state.firedBy.id, state.timestamp);
						}
						break;
					case SyncTypes.ChatSync:
						setRoomMessages((prev) => {
							if (state.chat) {
								const next = appendRoomChatMessage(prev, state.chat);
								if (next !== prev && inBgRef.current) {
									notificationAudioRef.current?.play().catch(() => {});
								}
								return next;
							}
							const chats = state.chats ?? [];
							if (
								inBgRef.current &&
								getLatestMessageTimestamp(prev) !== chats[chats.length - 1]?.timestamp
							) {
								notificationAudioRef.current?.play().catch(() => {});
							}
							return chats;
						});
						break;
					case SyncTypes.PlayersStatusSync: {
						const players = state.players;
						if (!players) {
							break;
						}
						reconnectAttemptRef.current = 0;
						roomPlayersCountRef.current = players.length;
						if (roomPlayersRef.current.length > 0) {
							const { left, joined } = getLeftAndJoined(roomPlayersRef.current, players, playerId);
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
								setControlsToDisplay((controls) => appendControlMessages(controls, playerEvents));
							}
						}
						roomPlayersRef.current = players;
						setRoomPlayers((current) =>
							areRoomPlayersEqual(current, players) ? current : players
						);
						setHistoricalPlayers((prev) => {
							let next = prev;
							for (const player of players) {
								if (!areHistoricalPlayersEqual(next[player.id], player)) {
									if (next === prev) {
										next = { ...prev };
									}
									next[player.id] = player;
								}
							}
							return next;
						});
						updateLastTicked(true, players.length);
						setCurrentlyWatching((value) => {
							if (value && value.roomPlayers !== players.length) {
								return { ...value, roomPlayers: players.length };
							}
							return value;
						});
						break;
					}
					case SyncTypes.PlayerStatusSync: {
						const playerStatuses = state.playerStatuses ?? [];
						const playersCount = state.playersCount ?? roomPlayersCountRef.current;
						reconnectAttemptRef.current = 0;
						roomPlayersCountRef.current = playersCount;
						setRoomPlayers((current) => {
							const next = mergeRoomPlayerStatuses(current, playerStatuses);
							roomPlayersRef.current = next;
							return next;
						});
						updateLastTicked(true, playersCount);
						setCurrentlyWatching((value) => {
							if (value && value.roomPlayers !== playersCount) {
								return { ...value, roomPlayers: playersCount };
							}
							return value;
						});
						break;
					}
					case SyncTypes.HeartbeatSync: {
						const playersCount = state.playersCount ?? roomPlayersCountRef.current;
						reconnectAttemptRef.current = 0;
						roomPlayersCountRef.current = playersCount;
						updateLastTicked(true, playersCount);
						break;
					}
					case SyncTypes.PauseSync:
						awaitingInitialPlaybackSyncRef.current = false;
						if (typeof state.paused === 'boolean') {
							applyRemotePlaybackSync({ paused: state.paused });
							persistControlState(state);
						}
						break;
					case SyncTypes.TimeSync:
						if (state.time !== undefined) {
							applyRemotePlaybackSync({ time: state.time });
							persistControlState(state);
						}
						break;
					case SyncTypes.BroadcastSync:
						switch (broadcast?.type) {
							case BroadcastTypes.MoveTo:
								if (broadcast.moveTo === '') {
									void onRoomMediaChanged?.('', state.timestamp);
									break;
								}
								mediaSelectionRef.current?.updateList(broadcast.moveTo, (jobs: LibraryJob[]) => {
									initiateMoveTo(jobs);
								});
								break;
							case BroadcastTypes.VoiceSignal:
								void handleVoiceBroadcast(state.firedBy?.id, broadcast);
								break;
							case BroadcastTypes.SoundEffect:
								playSoundEffect(
									resolveBroadcastSoundEffectId(broadcast.soundEffect, playerId),
									state.firedBy?.id
								);
								pulseSoundEffectBadge(state.firedBy?.id);
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
			job.Id,
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
			onRoomMediaChanged,
			playSoundEffect,
			pulseSoundEffectBadge,
			applyRemotePlaybackSync
		]
	);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	const startWatchRoomConnection = useCallback(() => {
		void refreshRoomMedia().then((changed) => {
			if (changed) {
				return;
			}
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
			if (voiceSupported) {
				void joinVoice();
			}
			connect(true);
		});
	}, [connect, joinVoice, refreshRoomMedia, setInteracted, voiceSupported]);

	const handleMoveToastMove = useCallback(async () => {
		if (moveToast?.job?.Id) {
			await onRoomMediaChanged?.(moveToast.job.Id);
		} else {
			await refreshRoomMedia();
		}
		setMoveToast(null);
	}, [moveToast, onRoomMediaChanged, refreshRoomMedia]);

	const switchRoomMedia = useCallback(
		async (id: string) => {
			if (id === job.Id) {
				return;
			}
			if (socketConnected && roomPlayersCountRef.current === 1) {
				try {
					const record = await updateRoomRecord(backendBaseUrl, room, id);
					await onRoomMediaChanged?.(id, record.mediaUpdated);
				} catch (error) {
					console.error(error);
					addSystemMessage('Unable to switch media. Please try again.');
				}
				return;
			}

			const socket = socketRef.current;
			pendingMediaSwitchRef.current = id;
			if (socket?.readyState === WebSocket.OPEN) {
				pendingMediaSwitchRef.current = null;
				send({
					type: SyncTypes.BroadcastSync,
					broadcast: { type: BroadcastTypes.MoveTo, moveTo: id }
				});
			} else {
				startWatchRoomConnection();
			}
		},
		[
			addSystemMessage,
			backendBaseUrl,
			job.Id,
			onRoomMediaChanged,
			room,
			send,
			socketConnected,
			startWatchRoomConnection
		]
	);

	useEffect(() => {
		if (!playerEl || !playerId || !interactedRef.current || !playerCanPlayRef.current) {
			return;
		}
		connect();
	}, [connect, interacted, playerEl, playerId]);

	useEffect(() => {
		profileSyncedRef.current = false;
	}, [discordUser, displayName, profileId]);

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

		const setSelectedSubtitleTrack = (
			track: any,
			mode?: TextTrackMode,
			options: { storeLanguage?: boolean } = {}
		) => {
			const nextTrack = selectedFromVidstackTrack(track, subtitleTracksRef.current);
			const nextMode = mode ?? track?.mode;
			selectedSubtitleTrackRef.current =
				nextTrack && (!nextMode || nextMode === 'showing') ? nextTrack : null;
			if (options.storeLanguage && selectedSubtitleTrackRef.current?.language) {
				saveStoredSubtitleLanguage(selectedSubtitleTrackRef.current.language);
			}
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
			let requestedTrack = null;
			try {
				requestedTrack =
					typeof detail.index === 'number' ? playerEl.textTracks?.[detail.index] : null;
			} catch {
				requestedTrack = null;
			}
			setSelectedSubtitleTrack(requestedTrack, detail.mode, { storeLanguage: true });
		};

		playerEl.addEventListener?.('text-track-change', handleTextTrackChange);
		playerEl.addEventListener?.('media-text-track-change-request', handleTextTrackChangeRequest);
		try {
			playerEl.textTracks?.addEventListener?.('mode-change', handleTextTrackChange);
		} catch {
			// Text tracks can disappear during provider teardown.
		}

		return () => {
			playerEl.removeEventListener?.('text-track-change', handleTextTrackChange);
			playerEl.removeEventListener?.(
				'media-text-track-change-request',
				handleTextTrackChangeRequest
			);
			try {
				playerEl.textTracks?.removeEventListener?.('mode-change', handleTextTrackChange);
			} catch {
				// Text tracks can disappear during provider teardown.
			}
		};
	}, [playerEl]);

	useEffect(() => {
		controlsShowingRef.current = controlsShowing;
	}, [controlsShowing]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		if (!volumeInitializedRef.current) {
			restoreInitialVolume(playerEl);
		}
	}, [playerEl, restoreInitialVolume]);

	useEffect(() => {
		playerCanPlayRef.current = playerCanPlay;
		if (!playerEl || !playerCanPlay) {
			return;
		}
		const pendingRemotePlaybackSync = pendingRemotePlaybackSyncRef.current;
		if (pendingRemotePlaybackSync) {
			pendingRemotePlaybackSyncRef.current = null;
			applyRemotePlaybackSync(pendingRemotePlaybackSync);
		}
		if (interactedRef.current && !socketRef.current) {
			connectRef.current?.();
		}
		if (!volumeCanPlayRestoredRef.current) {
			restoreInitialVolume(playerEl);
			volumeCanPlayRestoredRef.current = true;
		}
	}, [applyRemotePlaybackSync, playerCanPlay, playerEl, restoreInitialVolume]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		const player = playerEl;

		const visibilityChange = () => {
			const paused = getSafePlayerPaused(player);
			if (document.hidden) {
				send({ state: 'bg', type: SyncTypes.StateSync, paused: paused ?? true });
				inBgRef.current = true;
				if (paused === false) {
					ignoreMediaRequestFailure(() => player.enterPictureInPicture?.());
				}
			} else {
				void refreshRoomMedia();
				send({ state: 'fg', type: SyncTypes.StateSync, paused: paused ?? true });
				inBgRef.current = false;
				ignoreMediaRequestFailure(() => player.exitPictureInPicture?.());
			}
		};
		document.addEventListener('visibilitychange', visibilityChange);
		const mouseMove = () => {
			if (chatFocusedSecsRef.current !== 0) {
				chatFocusedSecsRef.current = 0;
				setChatFocusedSecs(0);
			}
		};
		document.addEventListener('mousemove', mouseMove);
		const mouseLeave = () => {
			if (getSafePlayerPaused(player) === false && controlsShowingRef.current) {
				player.controls.hide(0);
			}
		};
		player.el?.addEventListener('mouseleave', mouseLeave);

		const interval = window.setInterval(() => {
			const pendingRemotePlaybackSync = pendingRemotePlaybackSyncRef.current;
			if (pendingRemotePlaybackSync && playerCanPlayRef.current) {
				pendingRemotePlaybackSyncRef.current = null;
				applyRemotePlaybackSync(pendingRemotePlaybackSync);
			}
			updateTime();
			updateLastTicked();
			const videoElement = getPlayerVideoElement(player);
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
				canvasRef.current
					?.getContext('2d')
					?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
				send({ type: SyncTypes.SubtitleSwitch, subtitle: selectedTrack?.src });
				if (selectedTrack?.src && selectedTrack.format === 'sup') {
					fetch(selectedTrack.src)
						.then((response) => {
							if (!response.ok) {
								throw new Error(`Failed to load SUP subtitles: ${response.status}`);
							}
							return response.arrayBuffer();
						})
						.then((buffer) => {
							const file = new Uint8Array(buffer);
							if (
								prevTrackSrcRef.current !== selectedTrackSrc ||
								!canvasRef.current ||
								!document.contains(videoElement)
							) {
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
				if (chatFocusedSecsRef.current !== 0) {
					chatFocusedSecsRef.current = 0;
					setChatFocusedSecs(0);
				}
			}
		}, 1000);

		return () => {
			window.clearInterval(interval);
			document.removeEventListener('visibilitychange', visibilityChange);
			document.removeEventListener('mousemove', mouseMove);
			player.el?.removeEventListener('mouseleave', mouseLeave);
		};
	}, [
		applyRemotePlaybackSync,
		chatFocused,
		playerEl,
		refreshRoomMedia,
		send,
		updateLastTicked,
		updateTime
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
		if (discordUser) {
			send({
				type: SyncTypes.ProfileSync,
				name: displayName,
				profileId,
				discordUser
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
		const link = new URL(
			`/${encodeURIComponent(currentRoomRef.current)}/media/${encodeURIComponent(currentMediaIdRef.current)}`,
			window.location.origin
		).toString();
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
	const mediaPlayerClassName = `media-player relative w-full bg-slate-900 ${discord ? 'h-[100dvh]' : 'aspect-video'} ${getSafePlayerPaused(playerEl) === false && chatFocusedSecs > hideControlsOnChatFocused ? 'chat-controls-hidden' : ''}`;
	const videoSettingsMenu = (
		<Menu.Root className="vds-video-settings-menu vds-menu">
			<DefaultMenuButton
				label="Video Settings"
				hint={videoSettingsSummary}
				Icon={defaultLayoutIcons.Menu.Settings}
			/>
			<Menu.Items className="vds-menu-items">
				{videoSettingsAudioOptions.length > 0 ? (
					<DefaultMenuSection label="Audio Track" value={videoSettingsAudioLabel}>
						<DefaultMenuRadioGroup
							value={effectiveAudio}
							options={videoSettingsAudioOptions}
							onChange={changeAudio}
						/>
					</DefaultMenuSection>
				) : null}
				<DefaultMenuSection label={videoSettingsCodecHeader} value={videoSettingsCodecLabel}>
					<DefaultMenuRadioGroup
						value={selectedCodec}
						options={videoSettingsCodecOptions}
						onChange={changeCodec}
					/>
				</DefaultMenuSection>
			</Menu.Items>
		</Menu.Root>
	);
	const renderControlsChat = (mobileLayout: boolean, suffix: string) => (
		<div
			className="player-chat-control"
			data-player-chat-mount="true"
			data-mobile-layout={mobileLayout ? 'true' : 'false'}
		>
			<Chatbox
				send={send}
				onCommand={handleChatCommand}
				chatFocused={chatFocused}
				focusByShortcut
				controlsShowing={null}
				className="chat-pc"
				inputId={`chat-pc-input-${suffix}`}
				formId={`chat-pc-form-${suffix}`}
				messages={[]}
				historicalPlayers={{}}
				staticBaseUrl={staticBaseUrl}
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
	const chatOverlay = (
		<div
			className="pointer-events-none absolute inset-0 z-50 flex gap-1"
			id="chat-overlay"
			style={chatHidden ? { display: 'none' } : undefined}
		>
			<Chats
				controlsShowing={controlsShowing && playerSmallLayout}
				messagesToDisplay={messagesToDisplay}
				historicalPlayers={historicalPlayers}
				staticBaseUrl={staticBaseUrl}
			/>
		</div>
	);

	return (
		<>
			{voice.remoteAudioStreams.map(({ id, stream }) => (
				<RemoteVoiceAudio
					key={id}
					stream={stream}
					deafened={voice.deafened}
					volume={remoteMicVolumes[id] ?? DEFAULT_REMOTE_MIC_VOLUME}
				/>
			))}
			<div className="relative w-full">
				<div
					className={`transition-[filter,opacity] duration-300 ${
						showJoinOverlay ? 'pointer-events-none blur-sm' : 'blur-0'
					}`}
				>
					{mounted && thumbnailVttSrc && playerSrcUrl ? (
						<MediaPlayer
							className={mediaPlayerClassName}
							key={`${playerSrcUrl}:${thumbnailVttSrc}`}
							src={playerSrcUrl}
							title={job.Input}
							artist="Let's watch anime!"
							controlsDelay={1500}
							crossOrigin
							keyShortcuts={PLAYER_KEY_SHORTCUTS}
							load="eager"
							ref={setPlayerElement}
							muted={playerMuted}
							posterLoad="eager"
							playsInline
							preload="auto"
							volume={playerVolume}
							onMediaPlayRequest={() => {
								startWatchRoomConnection();
							}}
							onSeeked={() => {
								const playing = getSafePlayerPaused(playerEl) === false;
								supRef.current?.seekedHandler(playing);
								supPlayingRef.current = Boolean(supRef.current && playing);
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
							<MediaProvider className="media-provider h-full w-full" ref={setMediaProviderEl}>
								<source
									key={playerSrcUrl}
									src={playerSrcUrl}
									type={videoSrc?.type}
									data-codec={videoSrc?.codec}
								/>
								<Poster className="vds-poster" src={posterSrc} alt="" />
								<canvas ref={canvasRef} id="sub-canvas" className="pointer-events-none absolute" />
							</MediaProvider>
							<DefaultVideoLayout
								colorScheme={theme}
								icons={defaultLayoutIcons}
								smallLayoutWhen={PLAYER_SMALL_LAYOUT_QUERY}
								thumbnails={thumbnailVttSrc}
								slots={{
									settingsMenuItemsStart: videoSettingsMenu,
									largeLayout: {
										beforeCaptionButton: renderControlsChat(false, 'large')
									},
									smallLayout: {
										beforeCaptionButton: renderControlsChat(true, 'small')
									}
								}}
							/>
							{chatOverlay}
						</MediaPlayer>
					) : (
						<div className={mediaPlayerClassName} />
					)}
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
				{socketConnected ? (
					<CottageGame
						backendBaseUrl={backendBaseUrl}
						roomId={room}
						socketConnected={socketConnected}
						currentPlayer={currentCottagePlayer}
						roomPlayers={displayedRoomPlayers}
					/>
				) : (
					<CottageGamePlaceholder />
				)}

				<div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-2 max-[760px]:justify-center">
					<div className="flex min-w-0 justify-start">
						{voiceSupported ? <VoiceControls voice={voice} /> : null}
					</div>
					<div className="flex min-w-0 items-center justify-end gap-2">
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
						onCommand={handleChatCommand}
						chatFocused={chatFocused}
						controlsShowing={null}
						className="w-full min-w-0"
						inputId="chat-page-input"
						formId="chat-page-form"
						useButton
						messages={roomMessages}
						historicalPlayers={historicalPlayers}
						staticBaseUrl={staticBaseUrl}
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
						const isUsingSoundEffect = soundEffectPlayerIds.has(player.id);
						const remoteMicVolume = remoteMicVolumes[player.id] ?? DEFAULT_REMOTE_MIC_VOLUME;
						const remoteMicVolumePercent = Math.round(remoteMicVolume * 100);
						const playerMuted = voiceSupported
							? isCurrentUser
								? !voice.desiredJoined || voice.status === 'listen-only' || voice.muted
								: (voice.peerMuted[player.id] ?? true)
							: true;
						const playerBadge = (
							<Button
								variant="outline"
								aria-label={
									isCurrentUser
										? 'Open profile settings'
										: `Adjust ${player.name} microphone volume`
								}
								className={`group relative flex h-auto gap-2 overflow-visible rounded-full rounded-l-full rounded-r-full border-2 py-0 pl-0 pr-4 transition-[background-color,border-color,box-shadow] duration-200 ${
									isSpeaking
										? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_18px_rgba(16,185,129,0.28)]'
										: isUsingSoundEffect
											? 'border-sky-400 bg-sky-400/10 shadow-[0_0_18px_rgba(56,189,248,0.3)]'
											: 'border-input'
								}`}
							>
								<span className="relative mr-0.5 shrink-0">
									<Pfp
										className="h-12 w-12"
										id={playerProfileId}
										discordUser={historicalPlayers[player.id]?.discordUser ?? player.discordUser}
										name={player.name}
										staticBaseUrl={staticBaseUrl}
									/>
									{voiceSupported ? (
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
									) : null}
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
								{isCurrentUser || voiceSupported ? (
									<span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:rotate-45 group-focus-visible:scale-110 group-focus-visible:rotate-45">
										{isCurrentUser ? (
											<IconSettings2 size={13} stroke={2} />
										) : (
											<IconVolume size={13} stroke={2} />
										)}
									</span>
								) : null}
							</Button>
						);
						if (!isCurrentUser) {
							if (!voiceSupported) {
								return <div key={player.id}>{playerBadge}</div>;
							}
							return (
								<Dialog.Root key={player.id}>
									<Dialog.Trigger asChild>{playerBadge}</Dialog.Trigger>
									<Dialog.Content className="w-[calc(100vw-2rem)] max-w-sm gap-5">
										<div className="flex items-center gap-3 pr-7">
											<Pfp
												id={playerProfileId}
												className="h-12 w-12"
												discordUser={
													historicalPlayers[player.id]?.discordUser ?? player.discordUser
												}
												name={player.name}
												staticBaseUrl={staticBaseUrl}
											/>
											<div className="min-w-0">
												<Dialog.Title className="truncate text-lg font-bold">
													{player.name}
												</Dialog.Title>
												<Dialog.Description className="text-sm text-muted-foreground">
													Microphone volume
												</Dialog.Description>
											</div>
										</div>
										<div className="rounded-lg border border-border/70 bg-muted/30 p-4">
											<div className="mb-4 flex items-center justify-between gap-3">
												<label
													htmlFor={`remote-mic-volume-${player.id}`}
													className="text-sm font-bold"
												>
													Microphone gain
												</label>
												<div className="flex h-10 items-center rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
													<Input
														aria-label="Volume percent"
														type="number"
														min={0}
														max={MAX_REMOTE_MIC_VOLUME_PERCENT}
														step={5}
														value={remoteMicVolumePercent}
														className="h-9 w-20 border-0 px-2 text-right text-lg font-extrabold tabular-nums shadow-none focus-visible:ring-0"
														onChange={(event) =>
															setRemoteMicVolume(player.id, Number(event.currentTarget.value) / 100)
														}
													/>
													<span className="pr-3 text-sm font-extrabold text-muted-foreground">
														%
													</span>
												</div>
											</div>
											<Slider
												id={`remote-mic-volume-${player.id}`}
												aria-label="Volume"
												min={0}
												max={MAX_REMOTE_MIC_VOLUME_PERCENT}
												step={5}
												value={[remoteMicVolumePercent]}
												onValueChange={([value]) =>
													setRemoteMicVolume(player.id, (value ?? remoteMicVolumePercent) / 100)
												}
											/>
											<div className="mt-3 flex items-center justify-between text-xs font-bold text-muted-foreground">
												<span>Muted</span>
												<span>Normal</span>
												<span>Boost</span>
											</div>
										</div>
										<div className="flex justify-end">
											<Button
												variant="outline"
												className="gap-2"
												disabled={remoteMicVolume === DEFAULT_REMOTE_MIC_VOLUME}
												onClick={() => setRemoteMicVolume(player.id, DEFAULT_REMOTE_MIC_VOLUME)}
											>
												<IconRefresh data-icon="inline-start" stroke={2} />
												Reset
											</Button>
										</div>
									</Dialog.Content>
								</Dialog.Root>
							);
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
												discordUser={discordUser}
												name={displayName}
												staticBaseUrl={staticBaseUrl}
											/>
											<input
												accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
												disabled={Boolean(discordUser)}
												onChange={handleAvatarChange}
												type="file"
											/>
										</label>
										<div className="min-w-0 flex-1">
											<label className="mb-1 block text-xs font-bold text-muted-foreground">
												Username
											</label>
											<Input
												disabled={Boolean(discordUser)}
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
												disabled={!socketConnected}
												onClick={openNewYouTubeTab}
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
								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												type="button"
												variant="outline"
												className="h-auto min-h-9 gap-2 px-3 py-2"
												disabled={!socketConnected || !currentChessPlayer}
												onClick={openNewChessTab}
											>
												<IconChess size={18} stroke={2} />
												<span>Chess</span>
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											<p>Open synced chess game</p>
										</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>
							</div>
						</motion.div>
					</CardHeader>
					<CardContent className="max-sm:p-4">
						<MediaSelection
							ref={mediaSelectionRef}
							data={data}
							staticBaseUrl={staticBaseUrl}
							backendBaseUrl={backendBaseUrl}
							bounceToOverride={(id) => void switchRoomMedia(id)}
						/>
					</CardContent>
				</Card>
			</div>

			{socketConnected
				? youtubeState.tabs
						.filter((tab) => tab.open)
						.map((tab, index) => (
							<YouTubeFloatingTab
								key={tab.id}
								roomId={youtubeRoomId}
								initialIndex={index}
								state={tab}
								onStateChange={(patch) => updateYouTubeState(tab.id, patch)}
							/>
						))
				: null}

			{socketConnected
				? chessState.tabs
						.filter((tab) => tab.open)
						.map((tab, index) => (
							<ChessFloatingTab
								key={tab.id}
								roomId={chessRoomId}
								initialIndex={index}
								state={tab}
								currentPlayer={currentChessPlayer}
								onStateChange={(patch) => updateChessState(tab.id, patch)}
								onNotification={sendChessNotification}
							/>
						))
				: null}

			{moveToast ? (
				<div className="fixed bottom-4 left-1/2 z-[100] w-[90%] max-w-xl -translate-x-1/2">
					<MoveToast
						key={`${moveToast.job?.Id ?? 'unknown'}-${moveToast.seconds}-${moveToast.firedBy?.id ?? 'room'}`}
						historicalPlayers={historicalPlayers}
						seconds={moveToast.seconds}
						firedBy={moveToast.firedBy}
						job={moveToast.job}
						onMove={handleMoveToastMove}
						staticBaseUrl={staticBaseUrl}
					/>
				</div>
			) : null}
		</>
	);
}
