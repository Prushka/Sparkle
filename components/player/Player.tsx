'use client';

import {
	type CSSProperties,
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
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'motion/react';
import {
	MediaPlayer,
	MediaProvider,
	Menu,
	Poster,
	TextTrack,
	TimeSlider,
	useMediaState,
	useSliderState,
	useThumbnails,
	type LibASSConfig,
	type LibASSConstructor,
	type MediaKeyShortcuts,
	type MediaPlayerInstance,
	type MediaPlayerQuery,
	type MediaProviderInstance,
	type TextRenderer,
	type TextTrackInit,
	type TimeSliderInstance
} from '@vidstack/react';
import {
	DefaultMenuButton,
	DefaultMenuCheckbox,
	DefaultMenuItem,
	DefaultMenuRadioGroup,
	DefaultMenuSection,
	DefaultVideoLayout,
	defaultLayoutIcons,
	useDefaultLayoutContext,
	useDefaultLayoutWord
} from '@vidstack/react/player/layouts/default';
import {
	IconBrandYoutubeFilled,
	IconCheck,
	IconChess,
	IconHeadphones,
	IconHeadphonesOff,
	IconKeyboard,
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
import {
	CHESS_NOTIFICATION_SOUND_IDS,
	type ChessNotificationSoundId
} from '@/lib/player/chess-notifications';
import {
	BroadcastTypes,
	codecDisplayMap,
	codecMap,
	compareSubtitleStreams,
	defaultFallback,
	fallbackFontsByScript,
	fallbackFontsMap,
	formatMbps,
	formatPair,
	formatSubtitlePair,
	formatSeconds,
	getCueForgeSubtitleInfo,
	getName,
	getSubtitleFormatName,
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
	type WordleBoardSyncState,
	type WordleMode,
	type WordlePhase,
	type WordlePlayerSyncState,
	type WordleResultSyncState,
	type WordleRowSyncState,
	type WordleSettingsSyncState,
	type WordleTabSyncState,
	type WordleSyncState,
	type WordleTileStatus,
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
import { CottageGamePlaceholder } from '@/components/player/CottageGamePlaceholder';
import { RoomNavigationInput } from '@/components/room-navigation-input';
import { fetchJobs, joinBackendPath, updateRoomRecord } from '@/lib/player/data';
import type { ParsedCaptionsResult, VTTCue as MediaCaptionCue } from 'media-captions';

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
	timestamp?: number;
};

type YouTubeFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: YouTubeTabSyncState;
	translucent: boolean;
	onStateChange: (patch: Partial<YouTubeTabSyncState>) => void;
};

type ChessFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: ChessTabSyncState;
	currentPlayer: ChessPlayerSyncState | null;
	translucent: boolean;
	onStateChange: (patch: Partial<ChessTabSyncState>) => void;
	onNotification: (soundId: ChessNotificationSoundId, chess?: ChessSoundEffectContext) => void;
};

type WordleFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: WordleTabSyncState;
	currentPlayer: WordlePlayerSyncState | null;
	translucent: boolean;
	onStateChange: (patch: Partial<WordleTabSyncState>) => void;
};

type CottageGameProps = {
	backendBaseUrl: string;
	roomId: string;
	socketConnected: boolean;
	currentPlayer: { id: string; name: string; profileId?: string } | null;
	roomPlayers: RoomPlayer[];
};

const YouTubeFloatingTab = dynamic<YouTubeFloatingTabProps>(
	() =>
		import('@/components/player/YouTubeFloatingTab').then((module) => module.YouTubeFloatingTab),
	{ ssr: false }
);

const ChessFloatingTab = dynamic<ChessFloatingTabProps>(
	() => import('@/components/player/ChessFloatingTab').then((module) => module.ChessFloatingTab),
	{ ssr: false }
);

const WordleFloatingTab = dynamic<WordleFloatingTabProps>(
	() => import('@/components/player/WordleFloatingTab').then((module) => module.WordleFloatingTab),
	{ ssr: false }
);

const CottageGame = dynamic<CottageGameProps>(
	() => import('@/components/player/CottageGame').then((module) => module.CottageGame),
	{ loading: CottageGamePlaceholder, ssr: false }
);

type LocalSystemMessage = Chat & {
	isSystem: true;
};

type SubtitleTrackFormat = 'ass' | 'srt' | 'sup' | 'vtt';
type ChineseSubtitleVariant = 'Simplified' | 'Traditional';

type SubtitleTrackInfo = {
	annotated: boolean;
	cueForge: boolean;
	src: string;
	label: string;
	settingsLabel: string;
	kind: 'subtitles';
	type: SubtitleTrackFormat;
	language: string;
	default: boolean;
	format: SubtitleTrackFormat;
	style: string;
};

type SelectedSubtitleTrack = Pick<
	SubtitleTrackInfo,
	'annotated' | 'cueForge' | 'format' | 'label' | 'language' | 'src' | 'style'
> & { mode?: TextTrackMode };

type StackableSubtitleTrackFormat = Extract<SubtitleTrackFormat, 'ass' | 'vtt'>;
type StoredSubtitleSelection = {
	annotated?: boolean;
	cueForge?: boolean;
	disabled?: boolean;
	format?: SubtitleTrackFormat;
	label?: string;
	language?: string;
	src?: string;
	srcName?: string;
	style?: string;
};
type SubtitleSelectionCandidate = Required<
	Pick<StoredSubtitleSelection, 'annotated' | 'cueForge' | 'format' | 'language' | 'style'>
> &
	Pick<StoredSubtitleSelection, 'label' | 'src' | 'srcName'>;
type StoredSubtitleLayerSelections = Partial<
	Record<StackableSubtitleTrackFormat, StoredSubtitleSelection[]>
>;

const PLAYER_VOLUME_STORAGE_KEY = 'volume';
const DEFAULT_PLAYER_VOLUME = 1;
const REMOTE_MIC_VOLUME_STORAGE_KEY = 'remoteMicVolumes';
const DEFAULT_REMOTE_MIC_VOLUME = 1;
const MAX_REMOTE_MIC_VOLUME = 5;
const MAX_REMOTE_MIC_VOLUME_PERCENT = MAX_REMOTE_MIC_VOLUME * 100;
const SUBTITLE_SELECTION_STORAGE_KEY = 'subtitleSelection';
const SUBTITLE_LANGUAGE_STORAGE_KEY = 'subtitleLanguage';
const SUBTITLE_LAYERS_STORAGE_KEY = 'subtitleLayers';
const ASS_BITMAP_CACHE_LIMIT_MB = 64;
const ASS_GLYPH_CACHE_LIMIT_MB = 16;
const ASS_DEFAULT_LATIN_FONT = 'Liberation Sans';
const ASS_DEFAULT_LATIN_FONT_FILE = 'default.woff2';
const ASS_DEFAULT_UNICODE_FONT = defaultFallback[0] ?? 'Noto Sans';
const ASS_DEFAULT_UNICODE_FONT_FILE = defaultFallback[1] ?? 'NotoSans-Regular.ttf';
const ASS_ARABIC_FONT = 'Noto Naskh Arabic';
const ASS_ARABIC_FONT_FILE = 'NotoNaskhArabic-Regular.ttf';
const ASS_ARABIC_FONT_ALIASES = [
	ASS_ARABIC_FONT,
	'Adobe Arabic',
	'Arabic Typesetting',
	'Andalus',
	'Geeza Pro',
	'Sakkal Majalla',
	'Simplified Arabic',
	'Traditional Arabic',
	'Urdu Typesetting',
	'SF Arabic'
];
const ASS_ANNOTATION_FONT_ALIASES = [ASS_DEFAULT_LATIN_FONT, 'Arial', 'Arial Unicode MS'];
const ASS_ARABIC_SCRIPT_FONT = fallbackFontsByScript.Arabic[0] ?? ASS_ARABIC_FONT;
const ASS_BENGALI_FONT = fallbackFontsByScript.Bengali[0] ?? 'Noto Sans Bengali';
const ASS_CHINESE_FONT = fallbackFontsByScript.Han[0] ?? 'Noto Sans SC Thin';
// Used only for glyphs missing from the selected ASS style font; SC has the broadest shipped coverage.
const ASS_MISSING_GLYPH_FALLBACK_FONT = ASS_CHINESE_FONT;
const ASS_DEVANAGARI_FONT = fallbackFontsByScript.Devanagari[0] ?? 'Noto Sans Devanagari';
const ASS_ETHIOPIC_FONT = fallbackFontsByScript.Ethiopic[0] ?? 'Noto Sans Ethiopic';
const ASS_GEORGIAN_FONT = 'Noto Sans Georgian';
const ASS_GUJARATI_FONT = fallbackFontsByScript.Gujarati[0] ?? 'Noto Sans Gujarati';
const ASS_GURMUKHI_FONT = fallbackFontsByScript.Gurmukhi[0] ?? 'Noto Sans Gurmukhi';
const ASS_HEBREW_FONT = fallbackFontsByScript.Hebrew[0] ?? 'Noto Sans Hebrew';
const ASS_JAPANESE_FONT = fallbackFontsByScript.Japanese[0] ?? 'Noto Sans JP Thin';
const ASS_KANNADA_FONT = fallbackFontsByScript.Kannada[0] ?? 'Noto Sans Kannada';
const ASS_KHMER_FONT = fallbackFontsByScript.Khmer[0] ?? 'Noto Sans Khmer';
const ASS_KOREAN_FONT = fallbackFontsByScript.Hangul[0] ?? 'NanumGothicCoding';
const ASS_LAO_FONT = 'Noto Sans Lao';
const ASS_MALAYALAM_FONT = fallbackFontsByScript.Malayalam[0] ?? 'Noto Sans Malayalam';
const ASS_MYANMAR_FONT = fallbackFontsByScript.Myanmar[0] ?? 'Noto Sans Myanmar';
const ASS_NKO_FONT = fallbackFontsByScript.NKo[0] ?? 'Noto Sans NKo';
const ASS_ORIYA_FONT = fallbackFontsByScript.Oriya[0] ?? 'Noto Sans Oriya';
const ASS_SINHALA_FONT = fallbackFontsByScript.Sinhala[0] ?? 'Noto Sans Sinhala';
const ASS_TAMIL_FONT = fallbackFontsByScript.Tamil[0] ?? 'Noto Sans Tamil';
const ASS_TELUGU_FONT = fallbackFontsByScript.Telugu[0] ?? 'Noto Sans Telugu';
const ASS_THAI_FONT = fallbackFontsByScript.Thai[0] ?? 'Noto Sans Thai';
const ASS_TIFINAGH_FONT = fallbackFontsByScript.Tifinagh[0] ?? 'Noto Sans Tifinagh';
const ASS_COMMON_PLATFORM_FONT_ALIASES = [
	'Aharoni',
	'Apple SD Gothic Neo',
	'Arial',
	'Arial Black',
	'Arial Cyr',
	'Arial Greek',
	'Arial Narrow',
	'Arial Unicode MS',
	'Aparajita',
	'Batang',
	'Browallia New',
	'Calibri',
	'Cambria',
	'Cordia New',
	'Courier New',
	'DaunPenh',
	'David',
	'DejaVu Sans',
	'DengXian',
	'DokChampa',
	'Dotum',
	'Ebrima',
	'FangSong',
	'FrankRuehl',
	'Gautami',
	'Georgia',
	'Gulim',
	'Gungsuh',
	'Heiti SC',
	'Helvetica',
	'Helvetica Neue',
	'Hiragino Kaku Gothic ProN',
	'Hiragino Sans',
	'Iskoola Pota',
	'KaiTi',
	'Kalinga',
	'Kartika',
	'Khmer UI',
	'Kokila',
	'Krungthep',
	'Latha',
	'Lao UI',
	'Leelawadee',
	'Leelawadee UI',
	'Levenim MT',
	'Lucida Grande',
	'Lucida Sans Unicode',
	'Malgun Gothic',
	'Mangal',
	'Meiryo',
	'Microsoft Sans Serif',
	'Microsoft YaHei',
	'Microsoft JhengHei',
	'MingLiU',
	'Miriam',
	'MS Gothic',
	'MS Mincho',
	'MS PGothic',
	'MS PMincho',
	'MS Sans Serif',
	'MoolBoran',
	'Myanmar Text',
	'Narkisim',
	'Nirmala UI',
	'NSimSun',
	'Nyala',
	'Osaka',
	'Padauk',
	'PingFang SC',
	'PMingLiU',
	'Raavi',
	'Segoe UI',
	'Shonar Bangla',
	'SimHei',
	'SimKai',
	'SimSun',
	'Songti SC',
	'Shruti',
	'STHeiti',
	'STSong',
	'Sylfaen',
	'Tahoma',
	'Times New Roman Cyr',
	'Times New Roman Greek',
	'Times New Roman',
	'Trebuchet MS',
	'Tunga',
	'Utsaah',
	'Vani',
	'Verdana',
	'Vijaya',
	'Vrinda',
	'Yu Gothic',
	'sans-serif',
	'serif'
];
const ASS_COMMON_PLATFORM_FONT_ALIAS_SET = new Set(
	ASS_COMMON_PLATFORM_FONT_ALIASES.map(normalizeAssFontLookupName)
);
const ASS_SCRIPT_FALLBACK_FONTS = [
	{
		family: ASS_ARABIC_SCRIPT_FONT,
		filename: fallbackFontsByScript.Arabic[1] ?? ASS_ARABIC_FONT_FILE,
		pattern: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/
	},
	{
		family: ASS_JAPANESE_FONT,
		filename: fallbackFontsByScript.Japanese[1] ?? 'NotoSansJP-VariableFont_wght.ttf',
		pattern: /[\u3040-\u30ff]/
	},
	{
		family: ASS_KOREAN_FONT,
		filename: fallbackFontsByScript.Hangul[1] ?? 'NanumGothicCoding-Regular.ttf',
		pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/
	},
	{
		family: ASS_CHINESE_FONT,
		filename: fallbackFontsByScript.Han[1] ?? 'NotoSansSC-VariableFont_wght.ttf',
		pattern: /[\u3400-\u9fff\uf900-\ufaff]/
	},
	{
		family: ASS_HEBREW_FONT,
		filename: fallbackFontsByScript.Hebrew[1] ?? 'NotoSansHebrew-Regular.ttf',
		pattern: /[\u0590-\u05ff]/
	},
	{
		family: ASS_DEVANAGARI_FONT,
		filename: fallbackFontsByScript.Devanagari[1] ?? 'NotoSansDevanagari-Regular.ttf',
		pattern: /[\u0900-\u097f]/
	},
	{
		family: ASS_BENGALI_FONT,
		filename: fallbackFontsByScript.Bengali[1] ?? 'NotoSansBengali-Regular.ttf',
		pattern: /[\u0980-\u09ff]/
	},
	{
		family: ASS_GURMUKHI_FONT,
		filename: fallbackFontsByScript.Gurmukhi[1] ?? 'NotoSansGurmukhi-Regular.ttf',
		pattern: /[\u0a00-\u0a7f]/
	},
	{
		family: ASS_GUJARATI_FONT,
		filename: fallbackFontsByScript.Gujarati[1] ?? 'NotoSansGujarati-Regular.ttf',
		pattern: /[\u0a80-\u0aff]/
	},
	{
		family: ASS_ORIYA_FONT,
		filename: fallbackFontsByScript.Oriya[1] ?? 'NotoSansOriya-Regular.ttf',
		pattern: /[\u0b00-\u0b7f]/
	},
	{
		family: ASS_TAMIL_FONT,
		filename: fallbackFontsByScript.Tamil[1] ?? 'NotoSansTamil-Regular.ttf',
		pattern: /[\u0b80-\u0bff]/
	},
	{
		family: ASS_TELUGU_FONT,
		filename: fallbackFontsByScript.Telugu[1] ?? 'NotoSansTelugu-Regular.ttf',
		pattern: /[\u0c00-\u0c7f]/
	},
	{
		family: ASS_KANNADA_FONT,
		filename: fallbackFontsByScript.Kannada[1] ?? 'NotoSansKannada-Regular.ttf',
		pattern: /[\u0c80-\u0cff]/
	},
	{
		family: ASS_MALAYALAM_FONT,
		filename: fallbackFontsByScript.Malayalam[1] ?? 'NotoSansMalayalam-Regular.ttf',
		pattern: /[\u0d00-\u0d7f]/
	},
	{
		family: ASS_SINHALA_FONT,
		filename: fallbackFontsByScript.Sinhala[1] ?? 'NotoSansSinhala-Regular.ttf',
		pattern: /[\u0d80-\u0dff]/
	},
	{
		family: ASS_THAI_FONT,
		filename: fallbackFontsByScript.Thai[1] ?? 'NotoSansThai-Regular.ttf',
		pattern: /[\u0e00-\u0e7f]/
	},
	{ family: ASS_LAO_FONT, filename: 'NotoSansLao-Regular.ttf', pattern: /[\u0e80-\u0eff]/ },
	{
		family: ASS_MYANMAR_FONT,
		filename: fallbackFontsByScript.Myanmar[1] ?? 'NotoSansMyanmar-Regular.ttf',
		pattern: /[\u1000-\u109f]/
	},
	{
		family: ASS_ETHIOPIC_FONT,
		filename: fallbackFontsByScript.Ethiopic[1] ?? 'NotoSansEthiopic-Regular.ttf',
		pattern: /[\u1200-\u137f]/
	},
	{
		family: ASS_KHMER_FONT,
		filename: fallbackFontsByScript.Khmer[1] ?? 'NotoSansKhmer-Regular.ttf',
		pattern: /[\u1780-\u17ff]/
	},
	{
		family: ASS_NKO_FONT,
		filename: fallbackFontsByScript.NKo[1] ?? 'NotoSansNKo-Regular.ttf',
		pattern: /[\u07c0-\u07ff]/
	},
	{
		family: 'Noto Sans Armenian',
		filename: 'NotoSansArmenian-Regular.ttf',
		pattern: /[\u0530-\u058f]/
	},
	{
		family: 'Noto Sans Georgian',
		filename: 'NotoSansGeorgian-Regular.ttf',
		pattern: /[\u10a0-\u10ff\u1c90-\u1cbf]/
	},
	{
		family: ASS_TIFINAGH_FONT,
		filename: fallbackFontsByScript.Tifinagh[1] ?? 'NotoSansTifinagh-Regular.ttf',
		pattern: /[\u2d30-\u2d7f]/
	},
	{
		family: ASS_DEFAULT_UNICODE_FONT,
		filename: ASS_DEFAULT_UNICODE_FONT_FILE,
		pattern: /[\u00a0-\u024f\u0370-\u052f\u1e00-\u1eff]/
	}
] as const;
const ASS_NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const ROOM_TIME_SYNC_THRESHOLD_SECONDS = 6;
const AUDIO_LANGUAGE_PRIORITY = ['jpn', 'eng', 'chi'];
const SUBTITLE_LANGUAGE_PRIORITY = ['en'];
const DEFAULT_SUBTITLE_FORMAT_PRIORITY = ['ass', 'vtt', 'srt', 'sup'] as const;
const STACKABLE_SUBTITLE_FORMATS = new Set<SubtitleTrackFormat>(['ass', 'vtt']);
const MAX_MERGED_SUBTITLE_DENSITY = 5;
const MERGED_SUBTITLE_FONT_SCALE_STEP = 0.18;

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

const STORYBOARD_PREVIEW_HEIGHT = 75;
const STORYBOARD_PREVIEW_MIN_WIDTH = 96;
const STORYBOARD_PREVIEW_MAX_WIDTH = 240;
const STORYBOARD_SPRITE_BLOB_CACHE_LIMIT = 8;
const STORYBOARD_SPRITE_BITMAP_CACHE_LIMIT = 6;
const STORYBOARD_SPRITE_PREWARM_TIMEOUT_MS = 250;
const STORYBOARD_MAX_DEVICE_PIXEL_RATIO = 2;
const MEDIA_SESSION_SEEK_SECONDS = 10;

type SparkleMediaSessionAction = MediaSessionAction | 'enterpictureinpicture';
type SparkleWebKitPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';
type SparklePictureInPictureDocument = Document & {
	pictureInPictureElement?: Element | null;
	pictureInPictureEnabled?: boolean;
	exitPictureInPicture?: () => Promise<void>;
};
type SparklePictureInPictureVideoElement = HTMLVideoElement & {
	autoPictureInPicture?: boolean;
	requestPictureInPicture?: () => Promise<PictureInPictureWindow>;
	webkitPresentationMode?: SparkleWebKitPresentationMode;
	webkitSupportsPresentationMode?: (mode: SparkleWebKitPresentationMode) => boolean;
	webkitSetPresentationMode?: (mode: SparkleWebKitPresentationMode) => void | Promise<void>;
};

const mediaSessionActions = [
	'play',
	'pause',
	'seekbackward',
	'seekforward',
	'seekto',
	'stop',
	'enterpictureinpicture'
] as const satisfies readonly SparkleMediaSessionAction[];

type StoryboardThumbnail = {
	url: URL;
	startTime: number;
	endTime?: number;
	width?: number;
	height?: number;
	coords?: {
		x: number;
		y: number;
	};
};

type StoryboardPreviewSize = {
	cssWidth: number;
	cssHeight: number;
	bitmapWidth: number;
	bitmapHeight: number;
};

const storyboardSpriteBlobCache = new Map<string, Promise<Blob>>();
const storyboardSpriteBitmapCache = new Map<string, Promise<ImageBitmap>>();

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

function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function getMediaSessionImageType(src: string) {
	const path = src.split(/[?#]/)[0].toLowerCase();

	if (path.endsWith('.png')) {
		return 'image/png';
	}
	if (path.endsWith('.webp')) {
		return 'image/webp';
	}
	return 'image/jpeg';
}

function getMediaSessionArtwork(posterSrc: string): MediaImage[] {
	const fallbackIcon = '/favicon/icon-512x512.png';
	const artworkSrc = posterSrc || fallbackIcon;
	const artwork: MediaImage[] = [
		{
			src: artworkSrc,
			sizes: '512x512',
			type: getMediaSessionImageType(artworkSrc)
		}
	];

	if (artworkSrc !== fallbackIcon) {
		artwork.push({
			src: fallbackIcon,
			sizes: '512x512',
			type: 'image/png'
		});
	}

	return artwork;
}

function getMediaSessionTitle(data: ServerData) {
	const episode = data.job.Title.episode;
	return episode?.title || data.displayTitle || data.job.Input;
}

function getMediaSessionArtist(data: ServerData) {
	return data.job.Title.title || 'Sparkle';
}

function getStoryboardDevicePixelRatio() {
	if (typeof window === 'undefined') {
		return 1;
	}
	return Math.max(1, Math.min(window.devicePixelRatio || 1, STORYBOARD_MAX_DEVICE_PIXEL_RATIO));
}

function getStoryboardPreviewSize(thumbnail: StoryboardThumbnail | null): StoryboardPreviewSize {
	const tileWidth = Math.max(1, thumbnail?.width ?? 160);
	const tileHeight = Math.max(1, thumbnail?.height ?? 90);
	const aspectRatio = tileWidth / tileHeight;
	const cssHeight = STORYBOARD_PREVIEW_HEIGHT;
	const cssWidth = Math.min(
		STORYBOARD_PREVIEW_MAX_WIDTH,
		Math.max(STORYBOARD_PREVIEW_MIN_WIDTH, Math.round(cssHeight * aspectRatio))
	);
	const pixelRatio = getStoryboardDevicePixelRatio();

	return {
		cssWidth,
		cssHeight,
		bitmapWidth: Math.max(1, Math.round(cssWidth * pixelRatio)),
		bitmapHeight: Math.max(1, Math.round(cssHeight * pixelRatio))
	};
}

function findStoryboardThumbnail(thumbnails: StoryboardThumbnail[], time: number) {
	let low = 0;
	let high = thumbnails.length - 1;
	let best: StoryboardThumbnail | null = null;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const thumbnail = thumbnails[middle];
		if (time < thumbnail.startTime) {
			high = middle - 1;
			continue;
		}
		best = thumbnail;
		low = middle + 1;
	}

	if (!best || (best.endTime && time >= best.endTime)) {
		return null;
	}

	return best;
}

function getStoryboardSpriteBlob(src: string) {
	let blobPromise = storyboardSpriteBlobCache.get(src);
	if (blobPromise) {
		storyboardSpriteBlobCache.delete(src);
		storyboardSpriteBlobCache.set(src, blobPromise);
		return blobPromise;
	}

	blobPromise = fetch(src, { credentials: 'same-origin' }).then((response) => {
		if (!response.ok) {
			throw new Error(`Unable to load storyboard sprite ${response.status}`);
		}
		return response.blob();
	});
	storyboardSpriteBlobCache.set(src, blobPromise);

	while (storyboardSpriteBlobCache.size > STORYBOARD_SPRITE_BLOB_CACHE_LIMIT) {
		const oldestKey = storyboardSpriteBlobCache.keys().next().value as string | undefined;
		if (!oldestKey) {
			break;
		}
		storyboardSpriteBlobCache.delete(oldestKey);
	}

	return blobPromise;
}

function cacheStoryboardSpriteBitmap(src: string, bitmapPromise: Promise<ImageBitmap>) {
	storyboardSpriteBitmapCache.set(src, bitmapPromise);

	while (storyboardSpriteBitmapCache.size > STORYBOARD_SPRITE_BITMAP_CACHE_LIMIT) {
		const oldestKey = storyboardSpriteBitmapCache.keys().next().value as string | undefined;
		if (!oldestKey) {
			break;
		}
		const oldestBitmapPromise = storyboardSpriteBitmapCache.get(oldestKey);
		storyboardSpriteBitmapCache.delete(oldestKey);
		oldestBitmapPromise?.then((bitmap) => bitmap.close()).catch(() => {});
	}
}

function getStoryboardSpriteBitmap(src: string) {
	let bitmapPromise = storyboardSpriteBitmapCache.get(src);
	if (bitmapPromise) {
		storyboardSpriteBitmapCache.delete(src);
		storyboardSpriteBitmapCache.set(src, bitmapPromise);
		return bitmapPromise;
	}

	bitmapPromise = getStoryboardSpriteBlob(src)
		.then((blob) => createImageBitmap(blob))
		.catch((error) => {
			if (storyboardSpriteBitmapCache.get(src) === bitmapPromise) {
				storyboardSpriteBitmapCache.delete(src);
			}
			throw error;
		});
	cacheStoryboardSpriteBitmap(src, bitmapPromise);
	return bitmapPromise;
}

function getStoryboardSpriteSources(thumbnails: StoryboardThumbnail[]) {
	const seen = new Set<string>();
	const sources: string[] = [];

	for (const thumbnail of thumbnails) {
		const src = thumbnail.url.href;
		if (!seen.has(src)) {
			seen.add(src);
			sources.push(src);
		}
	}

	return sources;
}

function getNearbyStoryboardSpriteSources(activeSrc: string, sources: string[]) {
	const activeIndex = sources.indexOf(activeSrc);
	if (activeIndex === -1) {
		return [activeSrc];
	}

	return [activeSrc, sources[activeIndex + 1], sources[activeIndex - 1]].filter(
		(src): src is string => Boolean(src)
	);
}

function getStoryboardSourceRect(thumbnail: StoryboardThumbnail, size: StoryboardPreviewSize) {
	return {
		x: Math.max(0, Math.round(thumbnail.coords?.x ?? 0)),
		y: Math.max(0, Math.round(thumbnail.coords?.y ?? 0)),
		width: Math.max(1, Math.round(thumbnail.width ?? size.cssWidth)),
		height: Math.max(1, Math.round(thumbnail.height ?? size.cssHeight))
	};
}

function clampStoryboardSourceRect(
	rect: ReturnType<typeof getStoryboardSourceRect>,
	bitmap: ImageBitmap
) {
	const x = Math.min(rect.x, Math.max(0, bitmap.width - 1));
	const y = Math.min(rect.y, Math.max(0, bitmap.height - 1));

	return {
		x,
		y,
		width: Math.max(1, Math.min(rect.width, bitmap.width - x)),
		height: Math.max(1, Math.min(rect.height, bitmap.height - y))
	};
}

function prewarmStoryboardSprite(src: string) {
	if (storyboardSpriteBitmapCache.has(src)) {
		return;
	}
	void getStoryboardSpriteBitmap(src).catch(() => {});
}

function scheduleStoryboardPrewarm(callback: () => void) {
	const idleWindow = window as Window & {
		requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
		cancelIdleCallback?: (handle: number) => void;
	};

	if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
		const handle = idleWindow.requestIdleCallback(callback, {
			timeout: STORYBOARD_SPRITE_PREWARM_TIMEOUT_MS
		});
		return () => idleWindow.cancelIdleCallback?.(handle);
	}

	const timeout = window.setTimeout(callback, STORYBOARD_SPRITE_PREWARM_TIMEOUT_MS);
	return () => window.clearTimeout(timeout);
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
const WORDLE_WORD_LENGTH = 5;
const WORDLE_GUESS_PATTERN = /^[A-Z]{5}$/;
const DEFAULT_WORDLE_TURNS = 6;
const MAX_WORDLE_TURNS = 10;
const MAX_WORDLE_TABS = 64;
const DEFAULT_WORDLE_SETTINGS: WordleSettingsSyncState = {
	mode: 'competitive',
	turns: DEFAULT_WORDLE_TURNS
};
const DEFAULT_WORDLE_SYNC_STATE: WordleSyncState = {
	tabs: [],
	updatedAt: 0
};
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

type TabbedSyncState<TTab extends { id: string; open: boolean; updatedAt: number }> = {
	tabs: TTab[];
	updatedAt: number;
};

function shouldUseIncomingTabbedSyncTab<TTab extends { open: boolean; updatedAt: number }>(
	current: TTab,
	incoming: TTab
) {
	if (incoming.open !== current.open) {
		return !incoming.open;
	}
	if (incoming.updatedAt !== current.updatedAt) {
		return incoming.updatedAt > current.updatedAt;
	}
	return false;
}

function mergeTabbedSyncStates<
	TTab extends { id: string; open: boolean; updatedAt: number },
	TState extends TabbedSyncState<TTab>
>(
	currentState: TState,
	incomingState: TState,
	normalize: (state: Partial<TState> | null | undefined) => TState,
	maxTabs: number
) {
	const current = normalize(currentState);
	const incoming = normalize(incomingState);
	const mergedTabs = new Map<string, TTab>();
	const tabOrder: string[] = [];

	for (const tab of current.tabs) {
		mergedTabs.set(tab.id, tab);
		tabOrder.push(tab.id);
	}

	for (const incomingTab of incoming.tabs) {
		const currentTab = mergedTabs.get(incomingTab.id);
		if (!currentTab) {
			mergedTabs.set(incomingTab.id, incomingTab);
			tabOrder.push(incomingTab.id);
			continue;
		}
		if (shouldUseIncomingTabbedSyncTab(currentTab, incomingTab)) {
			mergedTabs.set(incomingTab.id, incomingTab);
		}
	}

	const tabs = tabOrder
		.map((tabId) => mergedTabs.get(tabId))
		.filter((tab): tab is TTab => Boolean(tab))
		.slice(-maxTabs);
	return normalize({
		tabs,
		updatedAt: Math.max(current.updatedAt, incoming.updatedAt)
	} as Partial<TState>);
}

function areTabbedSyncStatesEqual<TTab extends { id: string; open: boolean; updatedAt: number }>(
	left: TabbedSyncState<TTab>,
	right: TabbedSyncState<TTab>
) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function nextTabbedSyncUpdatedAt<TTab extends { id: string; open: boolean; updatedAt: number }>(
	state: TabbedSyncState<TTab>
) {
	const latestTabUpdatedAt = state.tabs.reduce(
		(latest, tab) => Math.max(latest, tab.updatedAt),
		state.updatedAt
	);
	return Math.max(Date.now(), latestTabUpdatedAt + 1);
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

function createDefaultWordleRows(turns: number): WordleRowSyncState[] {
	return Array.from({ length: turns }, () => ({
		statuses: Array.from({ length: WORDLE_WORD_LENGTH }, () => 'empty' as WordleTileStatus),
		typed: 0,
		submitted: false
	}));
}

function createDefaultWordleTab(
	id: string,
	player: WordlePlayerSyncState | null = null
): WordleTabSyncState {
	return {
		id,
		open: true,
		phase: 'setup',
		settings: DEFAULT_WORDLE_SETTINGS,
		players: player ? [player] : [],
		boards: [],
		activeBoardId: '',
		turnPlayerId: '',
		startedAt: 0,
		result: null,
		updatedAt: 0
	};
}

function normalizeWordlePlayer(
	player: Partial<WordlePlayerSyncState> | null | undefined
): WordlePlayerSyncState | null {
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

function normalizeWordleSettings(
	settings: Partial<WordleSettingsSyncState> | null | undefined
): WordleSettingsSyncState {
	const mode: WordleMode = settings?.mode === 'coop' ? 'coop' : 'competitive';
	const turns =
		typeof settings?.turns === 'number' && Number.isFinite(settings.turns)
			? Math.max(1, Math.min(MAX_WORDLE_TURNS, Math.round(settings.turns)))
			: DEFAULT_WORDLE_TURNS;
	return { mode, turns };
}

function normalizeWordleTileStatus(
	status: unknown,
	submitted: boolean,
	typed: boolean
): WordleTileStatus {
	if (submitted) {
		return status === 'correct' || status === 'present' || status === 'absent' ? status : 'absent';
	}
	return typed ? 'typed' : 'empty';
}

function normalizeWordleRows(
	rows: Partial<WordleRowSyncState>[] | null | undefined,
	turns: number
): WordleRowSyncState[] {
	const defaults = createDefaultWordleRows(turns);
	return defaults.map((defaultRow, rowIndex) => {
		const row = rows?.[rowIndex];
		if (!row) {
			return defaultRow;
		}
		const submitted = row.submitted === true;
		const typed = submitted
			? WORDLE_WORD_LENGTH
			: typeof row.typed === 'number' && Number.isFinite(row.typed)
				? Math.max(0, Math.min(WORDLE_WORD_LENGTH, Math.round(row.typed)))
				: 0;
		const playerId =
			typeof row.playerId === 'string' && CHESS_TAB_ID_PATTERN.test(row.playerId)
				? row.playerId
				: undefined;
		const guess =
			submitted && typeof row.guess === 'string' && WORDLE_GUESS_PATTERN.test(row.guess)
				? row.guess
				: undefined;
		return {
			statuses: Array.from({ length: WORDLE_WORD_LENGTH }, (_, index) =>
				normalizeWordleTileStatus(row.statuses?.[index], submitted, index < typed)
			),
			typed,
			submitted,
			...(playerId ? { playerId } : {}),
			...(guess ? { guess } : {})
		};
	});
}

function normalizeWordleBoard(
	board: Partial<WordleBoardSyncState> | null | undefined,
	turns: number
): WordleBoardSyncState | null {
	if (!board || typeof board.id !== 'string' || !CHESS_TAB_ID_PATTERN.test(board.id)) {
		return null;
	}
	const playerId =
		typeof board.playerId === 'string' && CHESS_TAB_ID_PATTERN.test(board.playerId)
			? board.playerId
			: undefined;
	const currentRow =
		typeof board.currentRow === 'number' && Number.isFinite(board.currentRow)
			? Math.max(0, Math.min(turns, Math.round(board.currentRow)))
			: 0;
	const finishedAt =
		typeof board.finishedAt === 'number' && Number.isFinite(board.finishedAt)
			? Math.max(0, board.finishedAt)
			: 0;
	return {
		id: board.id,
		...(playerId ? { playerId } : {}),
		rows: normalizeWordleRows(board.rows, turns),
		currentRow,
		solved: board.solved === true,
		finished: board.finished === true || board.solved === true || currentRow >= turns,
		finishedAt
	};
}

function normalizeWordleResult(
	result: Partial<WordleResultSyncState> | null | undefined
): WordleResultSyncState | null {
	if (!result) {
		return null;
	}
	const winnerIds = Array.isArray(result.winnerIds)
		? result.winnerIds.filter(
				(id): id is string => typeof id === 'string' && CHESS_TAB_ID_PATTERN.test(id)
			)
		: [];
	const message = typeof result.message === 'string' ? result.message.slice(0, 160) : '';
	return { winnerIds, message };
}

function normalizeWordleTabSyncState(
	state: Partial<WordleTabSyncState> | null | undefined,
	fallbackId = randomString(10)
): WordleTabSyncState | null {
	const id =
		typeof state?.id === 'string' && CHESS_TAB_ID_PATTERN.test(state.id) ? state.id : fallbackId;
	if (!CHESS_TAB_ID_PATTERN.test(id)) {
		return null;
	}
	const settings = normalizeWordleSettings(state?.settings);
	const phase: WordlePhase =
		state?.phase === 'playing' || state?.phase === 'ended' ? state.phase : 'setup';
	const players = Array.isArray(state?.players)
		? state.players
				.map((player) => normalizeWordlePlayer(player))
				.filter((player): player is WordlePlayerSyncState => Boolean(player))
		: [];
	const seenPlayers = new Set<string>();
	const uniquePlayers = players.filter((player) => {
		if (seenPlayers.has(player.id)) {
			return false;
		}
		seenPlayers.add(player.id);
		return true;
	});
	const boards =
		phase === 'setup'
			? []
			: Array.isArray(state?.boards)
				? state.boards
						.map((board) => normalizeWordleBoard(board, settings.turns))
						.filter((board): board is WordleBoardSyncState => Boolean(board))
				: [];
	const activeBoardId =
		typeof state?.activeBoardId === 'string' && CHESS_TAB_ID_PATTERN.test(state.activeBoardId)
			? state.activeBoardId
			: boards[0]?.id || '';
	const turnPlayerId =
		typeof state?.turnPlayerId === 'string' &&
		CHESS_TAB_ID_PATTERN.test(state.turnPlayerId) &&
		uniquePlayers.some((player) => player.id === state.turnPlayerId)
			? state.turnPlayerId
			: settings.mode === 'coop'
				? uniquePlayers[0]?.id || ''
				: '';
	return {
		id,
		open: Boolean(state?.open),
		phase,
		settings,
		players: uniquePlayers,
		boards,
		activeBoardId,
		turnPlayerId,
		startedAt:
			typeof state?.startedAt === 'number' && Number.isFinite(state.startedAt)
				? Math.max(0, state.startedAt)
				: 0,
		result: phase === 'ended' ? normalizeWordleResult(state?.result) : null,
		updatedAt:
			typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0
	};
}

function normalizeWordleSyncState(state: Partial<WordleSyncState> | null | undefined) {
	const rawTabs = Array.isArray(state?.tabs) ? state.tabs : [];
	const tabs: WordleTabSyncState[] = [];
	const seen = new Set<string>();
	for (const rawTab of rawTabs) {
		if (tabs.length >= MAX_WORDLE_TABS) {
			break;
		}
		const tab = normalizeWordleTabSyncState(rawTab);
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

function readStoredWordleSyncState(storageKey: string): WordleSyncState {
	if (typeof window === 'undefined') {
		return DEFAULT_WORDLE_SYNC_STATE;
	}
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (!stored) {
			return DEFAULT_WORDLE_SYNC_STATE;
		}
		return normalizeWordleSyncState(JSON.parse(stored) as Partial<WordleSyncState>);
	} catch {
		return DEFAULT_WORDLE_SYNC_STATE;
	}
}

function saveStoredWordleSyncState(storageKey: string, state: WordleSyncState) {
	if (typeof window === 'undefined' || !storageKey) {
		return;
	}
	window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function isMeaningfulWordleState(state: WordleSyncState) {
	return state.tabs.some((tab) => tab.open || tab.phase !== 'setup' || tab.boards.length > 0);
}

function isValidMultiplayerPlayerId(id: string | null | undefined): id is string {
	return typeof id === 'string' && CHESS_TAB_ID_PATTERN.test(id);
}

function addResumePlayerId(
	candidates: Set<string>,
	player: { id: string; profileId?: string } | null | undefined,
	profileId: string
) {
	if (player?.profileId === profileId && isValidMultiplayerPlayerId(player.id)) {
		candidates.add(player.id);
	}
}

function collectChessResumePlayerIds(
	state: ChessSyncState,
	profileId: string,
	candidates: Set<string>
) {
	for (const tab of state.tabs) {
		if (!tab.open) {
			continue;
		}
		addResumePlayerId(candidates, tab.white, profileId);
		addResumePlayerId(candidates, tab.black, profileId);
	}
}

function collectWordleResumePlayerIds(
	state: WordleSyncState,
	profileId: string,
	candidates: Set<string>
) {
	for (const tab of state.tabs) {
		if (!tab.open) {
			continue;
		}
		for (const player of tab.players) {
			addResumePlayerId(candidates, player, profileId);
		}
	}
}

function findStoredMultiplayerPlayerId(
	roomId: string,
	profileId: string,
	currentPlayerId: string | null
) {
	if (typeof window === 'undefined' || !profileId) {
		return currentPlayerId;
	}
	const candidates = new Set<string>();
	collectChessResumePlayerIds(
		readStoredChessSyncState(`sparkle:chess-sync-state:${roomId}`),
		profileId,
		candidates
	);
	collectWordleResumePlayerIds(
		readStoredWordleSyncState(`sparkle:wordle-sync-state:${roomId}`),
		profileId,
		candidates
	);
	if (currentPlayerId && candidates.has(currentPlayerId)) {
		return currentPlayerId;
	}
	if (candidates.size === 1) {
		return [...candidates][0];
	}
	return currentPlayerId;
}

function getSessionPlayerId(roomId: string, profileId: string) {
	if (typeof window === 'undefined') {
		return randomString(14);
	}
	const storedSessionId = window.sessionStorage.getItem('playerId');
	const currentPlayerId = isValidMultiplayerPlayerId(storedSessionId) ? storedSessionId : null;
	const resumedPlayerId = findStoredMultiplayerPlayerId(roomId, profileId, currentPlayerId);
	const nextPlayerId = resumedPlayerId ?? randomString(14);
	window.sessionStorage.setItem('playerId', nextPlayerId);
	return nextPlayerId;
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
	const cueForgeSubtitle = getCueForgeSubtitleInfo(stream);
	if (cueForgeSubtitle) {
		return languageSrcMap[cueForgeSubtitle.languageId] || cueForgeSubtitle.languageId;
	}
	const rawLanguage = stream.Language || '';
	const title = stream.Title || '';
	if (rawLanguage === 'chi' || rawLanguage === 'zho' || /^zh(?:-|$)/i.test(rawLanguage)) {
		if (/traditional|繁體|繁体|正體|正体|tc|cht/i.test(title)) {
			return 'zh-TW';
		}
		if (/simplified|简体|簡體|sc|chs/i.test(title)) {
			return 'zh-CN';
		}
	}
	return languageSrcMap[rawLanguage] || rawLanguage;
}

function getSubtitleLanguageBase(language: string) {
	return language.split('-')[0]?.toLowerCase() || language.toLowerCase();
}

function isChineseSubtitleLanguage(language: string) {
	return getSubtitleLanguageBase(language) === 'zh';
}

function isSameSubtitleLanguage(a: string, b: string) {
	if (a === b) {
		return true;
	}
	if (isChineseSubtitleLanguage(a) || isChineseSubtitleLanguage(b)) {
		return false;
	}
	return getSubtitleLanguageBase(a) === getSubtitleLanguageBase(b);
}

function isSubtitleTrackFormat(value: string): value is SubtitleTrackFormat {
	return value === 'ass' || value === 'srt' || value === 'sup' || value === 'vtt';
}

function getSubtitleSelectionStyle(format: SubtitleTrackFormat) {
	return format;
}

function getSubtitleSrcName(src: string) {
	return src.split(/[?#]/)[0].split('/').pop() || src;
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

function normalizeStoredSubtitleSelection(value: unknown): StoredSubtitleSelection | null {
	if (typeof value === 'string') {
		const storedValue = value.trim();
		if (!storedValue) {
			return null;
		}
		if (storedValue.toLowerCase() === 'off') {
			return { disabled: true };
		}
		if (storedValue.includes('\t')) {
			const [language = '', label = '', srcName = ''] = storedValue.split('\t');
			const format = isSubtitleTrackFormat(getSubtitleFormat(srcName))
				? getSubtitleFormat(srcName)
				: undefined;
			return normalizeStoredSubtitleSelection({
				format,
				label,
				language,
				srcName,
				style: format ? getSubtitleSelectionStyle(format) : undefined
			});
		}
		if (storedValue.includes('/') || /\.[a-z0-9]+$/i.test(storedValue)) {
			const format = getSubtitleFormat(storedValue);
			return {
				format,
				src: storedValue,
				srcName: getSubtitleSrcName(storedValue),
				style: getSubtitleSelectionStyle(format)
			};
		}
		return { language: storedValue };
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const record = value as Record<string, unknown>;
	const selection: StoredSubtitleSelection = {};
	for (const key of ['label', 'language', 'src', 'srcName', 'style'] as const) {
		const stringValue = record[key];
		if (typeof stringValue === 'string' && stringValue.trim()) {
			selection[key] = stringValue.trim();
		}
	}
	if (typeof record.cueForge === 'boolean') {
		selection.cueForge = record.cueForge;
	}
	if (typeof record.annotated === 'boolean') {
		selection.annotated = record.annotated;
	}
	if (typeof record.disabled === 'boolean') {
		selection.disabled = record.disabled;
	}
	if (typeof record.format === 'string' && isSubtitleTrackFormat(record.format)) {
		selection.format = record.format;
	}
	if (selection.src && !selection.srcName) {
		selection.srcName = getSubtitleSrcName(selection.src);
	}
	if (selection.format && !selection.style) {
		selection.style = getSubtitleSelectionStyle(selection.format);
	}
	return Object.keys(selection).length > 0 ? selection : null;
}

function getStoredSubtitleSelection() {
	if (typeof window === 'undefined') {
		return null;
	}
	const storedSelection = window.localStorage.getItem(SUBTITLE_SELECTION_STORAGE_KEY);
	if (storedSelection) {
		try {
			const selection = normalizeStoredSubtitleSelection(JSON.parse(storedSelection));
			if (selection) {
				return selection;
			}
		} catch {
			const selection = normalizeStoredSubtitleSelection(storedSelection);
			if (selection) {
				return selection;
			}
		}
	}
	const legacyLanguage = readStoredSubtitleLanguage();
	return legacyLanguage ? { language: legacyLanguage } : null;
}

function getStoredSubtitleSelectionForTrack(
	track: Pick<
		SubtitleTrackInfo,
		'annotated' | 'cueForge' | 'format' | 'label' | 'language' | 'src' | 'style'
	>
): StoredSubtitleSelection {
	return {
		annotated: track.annotated,
		cueForge: track.cueForge,
		format: track.format,
		label: track.label,
		language: track.language,
		src: track.src,
		srcName: getSubtitleSrcName(track.src),
		style: track.style || getSubtitleSelectionStyle(track.format)
	};
}

function saveStoredSubtitleSelection(track: SelectedSubtitleTrack) {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(
		SUBTITLE_SELECTION_STORAGE_KEY,
		JSON.stringify(getStoredSubtitleSelectionForTrack(track))
	);
	saveStoredSubtitleLanguage(track.language);
}

function saveStoredSubtitleSelectionOff() {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(SUBTITLE_SELECTION_STORAGE_KEY, JSON.stringify({ disabled: true }));
	window.localStorage.removeItem(SUBTITLE_LANGUAGE_STORAGE_KEY);
}

function isStackableSubtitleFormat(
	format: SubtitleTrackFormat
): format is StackableSubtitleTrackFormat {
	return STACKABLE_SUBTITLE_FORMATS.has(format);
}

function getSubtitleFormatPriority(format: SubtitleTrackFormat) {
	const priorityIndex = DEFAULT_SUBTITLE_FORMAT_PRIORITY.indexOf(format);
	return priorityIndex === -1 ? DEFAULT_SUBTITLE_FORMAT_PRIORITY.length : priorityIndex;
}

function compareSubtitleFormats(a: SubtitleTrackFormat, b: SubtitleTrackFormat) {
	return getSubtitleFormatPriority(a) - getSubtitleFormatPriority(b) || a.localeCompare(b);
}

function areStringArraysEqual(a: string[], b: string[]) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function getStoredSubtitleSelectionDedupeKey(selection: StoredSubtitleSelection) {
	return [
		selection.disabled ? 'off' : '',
		selection.language || '',
		selection.cueForge === undefined ? '' : selection.cueForge ? 'cueforge' : 'native',
		selection.annotated === undefined ? '' : selection.annotated ? 'annotated' : 'plain',
		selection.format || '',
		selection.style || '',
		selection.label || '',
		selection.srcName || '',
		selection.src || ''
	].join('\t');
}

function dedupeStoredSubtitleSelections(values: StoredSubtitleSelection[]) {
	const uniqueSelections: StoredSubtitleSelection[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const key = getStoredSubtitleSelectionDedupeKey(value);
		if (key && !seen.has(key)) {
			seen.add(key);
			uniqueSelections.push(value);
		}
	}
	return uniqueSelections;
}

function isStoredSubtitleSelectionDisabled(selection: StoredSubtitleSelection | null) {
	return selection?.disabled === true;
}

function getSubtitleSelectionCandidateFromStream(stream: Stream): SubtitleSelectionCandidate {
	const cueForgeSubtitle = getCueForgeSubtitleInfo(stream);
	const format = getSubtitleFormat(stream.Location);
	return {
		annotated: Boolean(cueForgeSubtitle?.annotated),
		cueForge: Boolean(cueForgeSubtitle),
		format,
		label: formatSubtitlePair(stream, true),
		language: getSubtitleLanguage(stream),
		src: stream.Location,
		srcName: getSubtitleSrcName(stream.Location),
		style: getSubtitleSelectionStyle(format)
	};
}

function getSubtitleSelectionCandidateFromTrack(
	track: Pick<
		SubtitleTrackInfo,
		'annotated' | 'cueForge' | 'format' | 'label' | 'language' | 'src' | 'style'
	>
): SubtitleSelectionCandidate {
	return {
		annotated: track.annotated,
		cueForge: track.cueForge,
		format: track.format,
		label: track.label,
		language: track.language,
		src: track.src,
		srcName: getSubtitleSrcName(track.src),
		style: track.style || getSubtitleSelectionStyle(track.format)
	};
}

function getSubtitleSelectionScore(
	candidate: SubtitleSelectionCandidate,
	selection: StoredSubtitleSelection
) {
	if (isStoredSubtitleSelectionDisabled(selection)) {
		return -1;
	}
	let score = 0;
	if (selection.src && candidate.src === selection.src) {
		score += 1000;
	}
	if (
		selection.srcName &&
		(candidate.srcName === selection.srcName ||
			getSubtitleSrcName(selection.srcName) === candidate.srcName)
	) {
		score += 500;
	}
	if (selection.src && getSubtitleSrcName(selection.src) === candidate.srcName) {
		score += 500;
	}
	if (selection.language) {
		if (!isSameSubtitleLanguage(candidate.language, selection.language)) {
			return -1;
		}
		score += candidate.language === selection.language ? 200 : 160;
	}
	if (typeof selection.cueForge === 'boolean') {
		if (candidate.cueForge !== selection.cueForge) {
			return -1;
		}
		score += 90;
	}
	if (typeof selection.annotated === 'boolean') {
		if (candidate.annotated !== selection.annotated) {
			return -1;
		}
		score += 80;
	}
	if (selection.format) {
		if (candidate.format !== selection.format) {
			return -1;
		}
		score += 70;
	}
	if (selection.style) {
		if (candidate.style !== selection.style) {
			return -1;
		}
		score += 60;
	}
	if (selection.label && candidate.label === selection.label) {
		score += 40;
	}
	return score;
}

function findSubtitleByStoredSelection<T>(
	items: T[],
	selection: StoredSubtitleSelection | null,
	getCandidate: (item: T) => SubtitleSelectionCandidate,
	usedSrcs: string[] = []
) {
	if (!selection) {
		return null;
	}
	let bestItem: T | null = null;
	let bestScore = -1;
	for (const item of items) {
		const candidate = getCandidate(item);
		if (candidate.src && usedSrcs.includes(candidate.src)) {
			continue;
		}
		const score = getSubtitleSelectionScore(candidate, selection);
		if (score > bestScore) {
			bestItem = item;
			bestScore = score;
		}
	}
	return bestScore >= 0 ? bestItem : null;
}

function pickSubtitleTrackForFormat(
	tracks: SubtitleTrackInfo[],
	format: SubtitleTrackFormat,
	storedSelection: StoredSubtitleSelection | null = getStoredSubtitleSelection()
) {
	const formatTracks = getSubtitleTracksByFormat(tracks, format);
	if (formatTracks.length === 0 || isStoredSubtitleSelectionDisabled(storedSelection)) {
		return null;
	}
	const exactStoredMatch = findSubtitleByStoredSelection(
		formatTracks,
		storedSelection,
		getSubtitleSelectionCandidateFromTrack
	);
	if (exactStoredMatch) {
		return exactStoredMatch;
	}
	if (storedSelection?.language) {
		const languageMatch = formatTracks.find((track) =>
			isSameSubtitleLanguage(track.language, storedSelection.language || '')
		);
		if (languageMatch) {
			return languageMatch;
		}
	}
	for (const language of SUBTITLE_LANGUAGE_PRIORITY) {
		const priorityMatch = formatTracks.find(
			(track) => getSubtitleLanguageBase(track.language) === language
		);
		if (priorityMatch) {
			return priorityMatch;
		}
	}
	return formatTracks[0] ?? null;
}

function hasDetailedStoredSubtitleSelection(selection: StoredSubtitleSelection | null) {
	return Boolean(
		selection?.annotated !== undefined ||
		selection?.cueForge !== undefined ||
		selection?.format ||
		selection?.label ||
		selection?.src ||
		selection?.srcName ||
		selection?.style
	);
}

function readStoredSubtitleLayerSelectionMap(): StoredSubtitleLayerSelections {
	if (typeof window === 'undefined') {
		return {};
	}
	try {
		const parsed = JSON.parse(window.localStorage.getItem(SUBTITLE_LAYERS_STORAGE_KEY) || '[]');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		const selections: StoredSubtitleLayerSelections = {};
		for (const format of ['ass', 'vtt'] as const) {
			const storedSelections = (parsed as Record<string, unknown>)[format];
			if (!Array.isArray(storedSelections)) {
				continue;
			}
			const normalizedSelections = dedupeStoredSubtitleSelections(
				storedSelections
					.map(normalizeStoredSubtitleSelection)
					.filter((selection): selection is StoredSubtitleSelection => Boolean(selection))
			);
			if (normalizedSelections.length > 0) {
				selections[format] = normalizedSelections;
			}
		}
		return selections;
	} catch {
		return {};
	}
}

function readLegacyStoredSubtitleLayerSrcs() {
	if (typeof window === 'undefined') {
		return [];
	}
	try {
		const parsed = JSON.parse(window.localStorage.getItem(SUBTITLE_LAYERS_STORAGE_KEY) || '[]');
		return Array.isArray(parsed)
			? parsed.filter((src): src is string => typeof src === 'string' && src.length > 0)
			: [];
	} catch {
		return [];
	}
}

function readStoredSubtitleLayerSelections(format: StackableSubtitleTrackFormat) {
	return readStoredSubtitleLayerSelectionMap()[format] ?? [];
}

function saveStoredSubtitleLayerSelections(
	format: StackableSubtitleTrackFormat,
	tracks: SubtitleTrackInfo[]
) {
	if (typeof window === 'undefined') {
		return;
	}
	const storedSelections = readStoredSubtitleLayerSelectionMap();
	const normalizedSelections = dedupeStoredSubtitleSelections(
		tracks.map(getStoredSubtitleSelectionForTrack)
	);
	if (normalizedSelections.length > 0) {
		storedSelections[format] = normalizedSelections;
	} else {
		delete storedSelections[format];
	}
	if (!storedSelections.ass && !storedSelections.vtt) {
		window.localStorage.removeItem(SUBTITLE_LAYERS_STORAGE_KEY);
		return;
	}
	window.localStorage.setItem(SUBTITLE_LAYERS_STORAGE_KEY, JSON.stringify(storedSelections));
}

function getMergedSubtitleFontScale(count: number) {
	return Math.max(
		0.7,
		1 -
			Math.max(0, Math.min(count, MAX_MERGED_SUBTITLE_DENSITY) - 1) *
				MERGED_SUBTITLE_FONT_SCALE_STEP
	);
}

function getStackableSubtitleTracks(
	tracks: SubtitleTrackInfo[],
	primaryTrack: SelectedSubtitleTrack | null
) {
	if (!primaryTrack || !isStackableSubtitleFormat(primaryTrack.format)) {
		return [];
	}
	return tracks.filter(
		(track) => track.format === primaryTrack.format && isStackableSubtitleFormat(track.format)
	);
}

function getAvailableSubtitleFormats(tracks: SubtitleTrackInfo[]) {
	return Array.from(new Set(tracks.map((track) => track.format))).sort(compareSubtitleFormats);
}

function getSubtitleTracksByFormat(
	tracks: SubtitleTrackInfo[],
	format: SubtitleTrackFormat | null
) {
	if (!format) {
		return [];
	}
	return tracks.filter((track) => track.format === format).sort(compareSubtitleTrackNames);
}

function getChineseSubtitleVariant(language: string): ChineseSubtitleVariant | null {
	const normalizedLanguage = language.trim().toLowerCase();
	if (
		normalizedLanguage === 'zh-cn' ||
		normalizedLanguage === 'zh-hans' ||
		normalizedLanguage === 'zh-sg'
	) {
		return 'Simplified';
	}
	if (
		normalizedLanguage === 'zh-tw' ||
		normalizedLanguage === 'zh-hant' ||
		normalizedLanguage === 'zh-hk' ||
		normalizedLanguage === 'zh-mo'
	) {
		return 'Traditional';
	}
	return null;
}

function getChineseSubtitleVariantVisibilityByFormat(tracks: SubtitleTrackInfo[]) {
	const variantsByFormat = new Map<SubtitleTrackFormat, Set<ChineseSubtitleVariant>>();
	for (const track of tracks) {
		const variant = getChineseSubtitleVariant(track.language);
		if (!variant) {
			continue;
		}
		const variants = variantsByFormat.get(track.format) ?? new Set<ChineseSubtitleVariant>();
		variants.add(variant);
		variantsByFormat.set(track.format, variants);
	}
	return new Map([...variantsByFormat].map(([format, variants]) => [format, variants.size > 1]));
}

function getSubtitleSettingsBaseLabel(track: SubtitleTrackInfo) {
	return track.label.replace(/^\s*\d+\s*-\s*/, '').trim() || track.label;
}

function formatSubtitleSettingsLabel(label: string) {
	let formattedLabel = label.trim();
	const suffixes: string[] = [];
	let suffixMatch = formattedLabel.match(/\s+\(([^()]+)\)\s*$/);
	while (suffixMatch) {
		suffixes.unshift(suffixMatch[1].trim());
		formattedLabel = formattedLabel.slice(0, suffixMatch.index).trimEnd();
		suffixMatch = formattedLabel.match(/\s+\(([^()]+)\)\s*$/);
	}
	return [formattedLabel, ...suffixes].filter(Boolean).join(' - ') || label;
}

function formatChineseSubtitleSettingsLabel(
	label: string,
	variant: ChineseSubtitleVariant,
	showVariant: boolean
) {
	let formattedLabel = label
		.replace(/\bsimplified\s+chinese\b/gi, 'Chinese - Simplified')
		.replace(/\btraditional\s+chinese\b/gi, 'Chinese - Traditional')
		.replace(/\bChinese\s*-\s*simplified\b/gi, 'Chinese - Simplified')
		.replace(/\bChinese\s*-\s*traditional\b/gi, 'Chinese - Traditional');

	if (showVariant && !new RegExp(`\\bChinese\\s*-\\s*${variant}\\b`).test(formattedLabel)) {
		formattedLabel = formattedLabel.replace(/\bChinese\b/, `Chinese - ${variant}`);
	}
	if (!showVariant) {
		formattedLabel = formattedLabel.replace(
			new RegExp(`\\bChinese\\s*-\\s*${variant}\\b`, 'g'),
			'Chinese'
		);
	}
	return formattedLabel;
}

function getSubtitleSettingsDuplicateKey(track: SubtitleTrackInfo) {
	return [track.format, track.language, track.annotated ? 'annotated' : 'plain'].join('\t');
}

function withSubtitleSettingsLabels(tracks: SubtitleTrackInfo[]) {
	const showChineseVariantByFormat = getChineseSubtitleVariantVisibilityByFormat(tracks);
	const entries = tracks.map((track, index) => ({
		baseLabel: getSubtitleSettingsBaseLabel(track),
		index,
		key: getSubtitleSettingsDuplicateKey(track),
		track
	}));
	const entriesByKey = new Map<string, typeof entries>();
	for (const entry of entries) {
		const keyEntries = entriesByKey.get(entry.key);
		if (keyEntries) {
			keyEntries.push(entry);
		} else {
			entriesByKey.set(entry.key, [entry]);
		}
	}

	const suffixes = new Map<number, number>();
	for (const keyEntries of entriesByKey.values()) {
		if (keyEntries.length <= 1) {
			continue;
		}
		[...keyEntries]
			.sort(
				(a, b) =>
					a.baseLabel.localeCompare(b.baseLabel, undefined, {
						numeric: true,
						sensitivity: 'base'
					}) ||
					a.track.src.localeCompare(b.track.src, undefined, {
						numeric: true,
						sensitivity: 'base'
					}) ||
					a.index - b.index
			)
			.forEach((entry, index) => suffixes.set(entry.index, index + 1));
	}

	return entries.map((entry) => {
		const suffix = suffixes.get(entry.index);
		const label = suffix ? `${entry.baseLabel} (${suffix})` : entry.baseLabel;
		const settingsLabel = formatSubtitleSettingsLabel(label);
		const chineseVariant = getChineseSubtitleVariant(entry.track.language);
		return {
			...entry.track,
			settingsLabel: chineseVariant
				? formatChineseSubtitleSettingsLabel(
						settingsLabel,
						chineseVariant,
						showChineseVariantByFormat.get(entry.track.format) ?? false
					)
				: settingsLabel
		};
	});
}

function compareSubtitleTrackNames(a: SubtitleTrackInfo, b: SubtitleTrackInfo) {
	return (
		a.settingsLabel.localeCompare(b.settingsLabel, undefined, {
			numeric: true,
			sensitivity: 'base'
		}) ||
		a.language.localeCompare(b.language, undefined, { numeric: true, sensitivity: 'base' }) ||
		a.src.localeCompare(b.src, undefined, { numeric: true, sensitivity: 'base' })
	);
}

function sanitizeSubtitleLayerSelection(
	srcs: string[],
	tracks: SubtitleTrackInfo[],
	primaryTrack: SelectedSubtitleTrack | null
) {
	const stackableTracks = getStackableSubtitleTracks(tracks, primaryTrack);
	const allowedSrcs = new Set(stackableTracks.map((track) => track.src));
	const nextSrcs: string[] = [];
	for (const src of srcs) {
		if (src !== primaryTrack?.src && allowedSrcs.has(src) && !nextSrcs.includes(src)) {
			nextSrcs.push(src);
		}
	}
	return nextSrcs;
}

function getSubtitleLayerTracks(srcs: string[], tracks: SubtitleTrackInfo[]) {
	return srcs
		.map((src) => tracks.find((track) => track.src === src) ?? null)
		.filter((track): track is SubtitleTrackInfo => Boolean(track));
}

function getStoredSubtitleLayerSrcs(
	tracks: SubtitleTrackInfo[],
	primaryTrack: SelectedSubtitleTrack
) {
	if (!isStackableSubtitleFormat(primaryTrack.format)) {
		return [];
	}
	const companionTracks = getStackableSubtitleTracks(tracks, primaryTrack).filter(
		(track) => track.src !== primaryTrack.src
	);
	const storedSelections = readStoredSubtitleLayerSelections(primaryTrack.format);
	const restoredSrcs: string[] = [];
	for (const selection of storedSelections) {
		const matchingTrack = findSubtitleByStoredSelection(
			companionTracks,
			selection,
			getSubtitleSelectionCandidateFromTrack,
			restoredSrcs
		);
		if (matchingTrack) {
			restoredSrcs.push(matchingTrack.src);
		}
	}
	if (restoredSrcs.length > 0 || storedSelections.length > 0) {
		return restoredSrcs;
	}

	const legacySrcs = readLegacyStoredSubtitleLayerSrcs();
	const migratedSrcs = sanitizeSubtitleLayerSelection(legacySrcs, tracks, primaryTrack);
	if (migratedSrcs.length > 0) {
		saveStoredSubtitleLayerSelections(
			primaryTrack.format,
			getSubtitleLayerTracks(migratedSrcs, tracks)
		);
	}
	return migratedSrcs;
}

function getSelectedSubtitleLayerCount(
	tracks: SubtitleTrackInfo[],
	selectedTrack: SelectedSubtitleTrack | null,
	extraSubtitleLayerSrcs: string[]
) {
	const stackableTracks = getStackableSubtitleTracks(tracks, selectedTrack);
	if (!selectedTrack || stackableTracks.length <= 1) {
		return 1;
	}
	return (
		1 +
		stackableTracks.filter(
			(track) => track.src !== selectedTrack.src && extraSubtitleLayerSrcs.includes(track.src)
		).length
	);
}

function pickPrioritySubtitleStreamBySelection(
	streams: Stream[],
	storedSelection: StoredSubtitleSelection | null
) {
	if (isStoredSubtitleSelectionDisabled(storedSelection)) {
		return null;
	}
	if (storedSelection) {
		const storedMatch = findSubtitleByStoredSelection(
			streams,
			storedSelection,
			getSubtitleSelectionCandidateFromStream
		);
		if (storedMatch) {
			return storedMatch;
		}
		if (storedSelection.language) {
			const storedLanguageMatch = streams.find((stream) =>
				isSameSubtitleLanguage(getSubtitleLanguage(stream), storedSelection.language || '')
			);
			if (storedLanguageMatch) {
				return storedLanguageMatch;
			}
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

function pickPrioritySubtitleStream(
	streams: Stream[],
	storedSelection: StoredSubtitleSelection | null
) {
	if (isStoredSubtitleSelectionDisabled(storedSelection)) {
		return null;
	}
	if (hasDetailedStoredSubtitleSelection(storedSelection)) {
		const storedMatch = findSubtitleByStoredSelection(
			streams,
			storedSelection,
			getSubtitleSelectionCandidateFromStream
		);
		if (storedMatch) {
			return storedMatch;
		}
	}

	const streamsByFormat = new Map<SubtitleTrackFormat, Stream[]>();

	for (const stream of streams) {
		const format = getSubtitleFormat(stream.Location);
		const formatStreams = streamsByFormat.get(format);
		if (formatStreams) {
			formatStreams.push(stream);
		} else {
			streamsByFormat.set(format, [stream]);
		}
	}

	for (const format of [...streamsByFormat.keys()].sort(compareSubtitleFormats)) {
		const priorityMatch = pickPrioritySubtitleStreamBySelection(
			streamsByFormat.get(format) ?? [],
			storedSelection
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

function createSubtitleTextTrack(track: SubtitleTrackInfo, overrides: Partial<TextTrackInit> = {}) {
	if (track.format === 'sup') {
		return new TextTrack({
			id: track.src,
			label: track.label,
			kind: track.kind,
			language: track.language,
			default: track.default,
			...overrides
		});
	}
	return new TextTrack({
		id: track.src,
		src: track.src,
		label: track.label,
		kind: track.kind,
		type: track.format,
		language: track.language,
		default: track.default,
		...overrides
	});
}

function setPlayerTextTrackMode(track: any, mode: TextTrackMode) {
	try {
		if (typeof track?.setMode === 'function') {
			track.setMode(mode);
		} else if (track) {
			track.mode = mode;
		}
	} catch {
		// Tracks can be removed while Vidstack is changing providers.
	}
}

function findPlayerTextTrackByOriginalSrc(textTracks: any, src: string) {
	return toArray(textTracks).find((track) => track?.id === src || track?.src === src) ?? null;
}

function isManagedSubtitleTextTrack(track: any, tracks: SubtitleTrackInfo[]) {
	return tracks.some((info) => track?.id === info.src || track?.src === info.src);
}

function getCaptionTextTrackOptionKey(track: any) {
	const kind = track?.kind;
	if (kind !== 'captions' && kind !== 'subtitles') {
		return null;
	}
	const id = typeof track?.id === 'string' ? track.id : '';
	const label = typeof track?.label === 'string' ? track.label.toLowerCase() : '';
	if (!id && !label) {
		return null;
	}
	return `${id}:${kind}-${label}`;
}

function removeDuplicateCaptionTextTracks(textTracks: any, preferredTrack?: any) {
	if (!textTracks?.remove) {
		return;
	}
	const tracksByKey = new Map<string, any[]>();
	for (const track of toArray(textTracks)) {
		const key = getCaptionTextTrackOptionKey(track);
		if (!key) {
			continue;
		}
		const matches = tracksByKey.get(key);
		if (matches) {
			matches.push(track);
		} else {
			tracksByKey.set(key, [track]);
		}
	}
	for (const tracks of tracksByKey.values()) {
		if (tracks.length < 2) {
			continue;
		}
		const trackToKeep =
			(preferredTrack && tracks.includes(preferredTrack) ? preferredTrack : null) ??
			tracks.find((track) => track?.mode === 'showing') ??
			tracks[tracks.length - 1];
		for (const track of tracks) {
			if (track !== trackToKeep) {
				removePlayerTextTrack(textTracks, track);
			}
		}
	}
}

function addUniquePlayerTextTrack(textTracks: any, textTrack: any) {
	if (!textTracks?.add || !textTrack) {
		return;
	}
	const nextKey = getCaptionTextTrackOptionKey(textTrack);
	if (nextKey) {
		for (const existingTrack of toArray(textTracks)) {
			if (existingTrack !== textTrack && getCaptionTextTrackOptionKey(existingTrack) === nextKey) {
				removePlayerTextTrack(textTracks, existingTrack);
			}
		}
	}
	textTracks.add(textTrack);
	removeDuplicateCaptionTextTracks(textTracks, textTrack);
}

function showPlayerSubtitleTextTrack(
	player: MediaPlayerInstance | null,
	tracks: SubtitleTrackInfo[],
	selectedTrack: SelectedSubtitleTrack | null
) {
	if (!player || !selectedTrack) {
		return false;
	}
	let textTracks: any = null;
	try {
		textTracks = player.textTracks;
	} catch {
		return false;
	}
	const targetTrack = findPlayerTextTrackByOriginalSrc(textTracks, selectedTrack.src);
	if (!targetTrack) {
		return false;
	}
	for (const track of toArray(textTracks)) {
		if (isManagedSubtitleTextTrack(track, tracks)) {
			setPlayerTextTrackMode(track, track === targetTrack ? 'showing' : 'disabled');
		}
	}
	setPlayerTextTrackMode(targetTrack, 'showing');
	return true;
}

function disablePlayerSubtitleTextTracks(
	player: MediaPlayerInstance | null,
	tracks: SubtitleTrackInfo[]
) {
	if (!player) {
		return;
	}
	let textTracks: any = null;
	try {
		textTracks = player.textTracks;
	} catch {
		return;
	}
	for (const track of toArray(textTracks)) {
		if (isManagedSubtitleTextTrack(track, tracks)) {
			setPlayerTextTrackMode(track, 'disabled');
		}
	}
}

function restoreSubtitleTextTrackOrder(
	textTracks: any,
	tracks: SubtitleTrackInfo[],
	options: {
		replacement?: { mode: TextTrackMode; primarySrc: string; textTrack: any };
		restoreMode?: TextTrackMode;
		restoreSrc?: string;
	} = {}
) {
	if (!textTracks?.add || !textTracks?.remove || tracks.length === 0) {
		return;
	}
	const existingTracks = toArray(textTracks);
	const modeBySrc = new Map<string, TextTrackMode>();
	const originalTrackBySrc = new Map<string, any>();
	for (const trackInfo of tracks) {
		const textTrack = existingTracks.find(
			(track) => track?.src === trackInfo.src || (!track?.src && track?.id === trackInfo.src)
		);
		if (textTrack) {
			originalTrackBySrc.set(trackInfo.src, textTrack);
			modeBySrc.set(trackInfo.src, textTrack.mode ?? 'disabled');
		}
	}
	const replacement = options.replacement;
	if (options.restoreSrc && options.restoreMode) {
		modeBySrc.set(options.restoreSrc, options.restoreMode);
	}
	if (replacement) {
		modeBySrc.set(replacement.primarySrc, replacement.mode);
	}

	for (const textTrack of existingTracks) {
		if (
			isManagedSubtitleTextTrack(textTrack, tracks) ||
			(replacement && textTrack?.id === replacement.primarySrc)
		) {
			removePlayerTextTrack(textTracks, textTrack);
		}
	}

	for (const trackInfo of tracks) {
		const textTrack =
			replacement && trackInfo.src === replacement.primarySrc
				? replacement.textTrack
				: originalTrackBySrc.get(trackInfo.src) || createSubtitleTextTrack(trackInfo);
		addUniquePlayerTextTrack(textTracks, textTrack);
		setPlayerTextTrackMode(textTrack, modeBySrc.get(trackInfo.src) ?? 'disabled');
	}
}

function removePlayerTextTrack(textTracks: any, track: any) {
	if (!textTracks?.remove || !track) {
		return;
	}
	try {
		textTracks.remove(track);
	} catch {
		// The track may already be gone after a media/source reset.
	}
}

function getSubtitleBlobMimeType(format: Extract<SubtitleTrackFormat, 'ass' | 'vtt'>) {
	return format === 'ass' ? 'text/x-ssa' : 'text/vtt';
}

function normalizeSubtitleCueText(text: string) {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
}

function subtitleCueFromMediaCue(cue: MediaCaptionCue): SubtitleMergeCue | null {
	const startTime = Number(cue.startTime);
	const endTime = Number(cue.endTime);
	const text = normalizeSubtitleCueText(cue.text || '');
	if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime || !text) {
		return null;
	}
	return { startTime, endTime, text };
}

async function parseSubtitleDocument(
	parser: CaptionsParserModule,
	track: SubtitleTrackInfo,
	signal: AbortSignal
): Promise<ParsedSubtitleDocument> {
	const response = await fetch(track.src, { signal });
	if (!response.ok) {
		throw new Error(`Failed to load ${track.label}: ${response.status}`);
	}
	const content = await response.text();
	const parsed = await parser.parseText(content, { type: track.format === 'ass' ? 'ass' : 'vtt' });
	const cues = parsed.cues
		.map(subtitleCueFromMediaCue)
		.filter((cue): cue is SubtitleMergeCue => Boolean(cue));
	return { content, cues, track };
}

async function fetchSubtitleText(track: SubtitleTrackInfo, signal: AbortSignal) {
	const response = await fetch(track.src, { signal });
	if (!response.ok) {
		throw new Error(`Failed to load ${track.label}: ${response.status}`);
	}
	return response.text();
}

function getMergedSubtitleSignature(tracks: SubtitleTrackInfo[]) {
	return tracks.map((track) => track.src).join('\n');
}

function getActiveTrackText(cues: SubtitleMergeCue[], time: number) {
	return cues
		.filter((cue) => cue.startTime <= time && cue.endTime > time)
		.map((cue) => cue.text)
		.filter(Boolean)
		.join('\n');
}

function mergeSubtitleCues(documents: ParsedSubtitleDocument[]) {
	const timePoints = new Set<number>();
	for (const document of documents) {
		for (const cue of document.cues) {
			timePoints.add(cue.startTime);
			timePoints.add(cue.endTime);
		}
	}
	const sortedTimes = [...timePoints].sort((a, b) => a - b);
	const mergedCues: MergedSubtitleCue[] = [];

	for (let index = 0; index < sortedTimes.length - 1; index++) {
		const startTime = sortedTimes[index];
		const endTime = sortedTimes[index + 1];
		if (
			!Number.isFinite(startTime) ||
			!Number.isFinite(endTime) ||
			endTime <= startTime ||
			endTime - startTime < 0.01
		) {
			continue;
		}
		const sampleTime = startTime + (endTime - startTime) / 2;
		const text = documents
			.map((document) => getActiveTrackText(document.cues, sampleTime))
			.filter(Boolean)
			.join('\n');
		if (!text) {
			continue;
		}
		const previousCue = mergedCues[mergedCues.length - 1];
		if (
			previousCue &&
			previousCue.text === text &&
			Math.abs(previousCue.endTime - startTime) < 0.02
		) {
			previousCue.endTime = endTime;
		} else {
			mergedCues.push({ startTime, endTime, text });
		}
	}

	return mergedCues;
}

function formatVttTimestamp(seconds: number) {
	const clampedSeconds = Math.max(0, seconds);
	const hours = Math.floor(clampedSeconds / 3600);
	const minutes = Math.floor((clampedSeconds % 3600) / 60);
	const wholeSeconds = Math.floor(clampedSeconds % 60);
	const milliseconds = Math.round((clampedSeconds - Math.floor(clampedSeconds)) * 1000);
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
		wholeSeconds
	).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function serializeMergedVtt(cues: MergedSubtitleCue[]) {
	return `WEBVTT\n\n${cues
		.map(
			(cue) =>
				`${formatVttTimestamp(cue.startTime)} --> ${formatVttTimestamp(cue.endTime)}\n${cue.text}`
		)
		.join('\n\n')}\n`;
}

function parseAssTimestamp(value: string) {
	const match = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.](\d{1,3}))?$/);
	if (!match) {
		return Number.POSITIVE_INFINITY;
	}
	const hours = Number.parseInt(match[1], 10);
	const minutes = Number.parseInt(match[2], 10);
	const seconds = Number.parseInt(match[3], 10);
	const fractionText = match[4] ?? '';
	const fraction = fractionText ? Number.parseInt(fractionText.padEnd(3, '0'), 10) / 1000 : 0;
	return hours * 3600 + minutes * 60 + seconds + fraction;
}

function normalizeAssColumnName(value: string) {
	return value.trim().toLowerCase();
}

function splitAssValues(value: string, count: number) {
	const values: string[] = [];
	let cursor = 0;
	for (let index = 0; index < value.length && values.length < count - 1; index++) {
		if (value[index] !== ',') {
			continue;
		}
		values.push(value.slice(cursor, index).trim());
		cursor = index + 1;
	}
	values.push(value.slice(cursor).trim());
	while (values.length < count) {
		values.push('');
	}
	return values;
}

function assValue(
	values: Record<string, string>,
	column: string,
	defaults: Record<string, string>
) {
	const key = normalizeAssColumnName(column);
	return values[key] ?? defaults[key] ?? '';
}

function parseAssDocument(
	content: string,
	track: SubtitleTrackInfo,
	fallbackContent = EMPTY_ASS_TRACK
): AssParsedDocument {
	const lines = (content || fallbackContent).replace(/\r\n?/g, '\n').split('\n');
	const structuralIndex = lines.findIndex((line) =>
		/^\[(?:v4\+?\s+styles|events)\]\s*$/i.test(line)
	);
	const header = (structuralIndex >= 0 ? lines.slice(0, structuralIndex) : lines)
		.join('\n')
		.trimEnd();
	let section = '';
	let styleColumns = ASS_STYLE_COLUMNS.map(String);
	let eventColumns = ASS_EVENT_COLUMNS.map(String);
	let playResX: number | null = null;
	let playResY: number | null = null;
	const styles: AssParsedStyle[] = [];
	const events: AssParsedEvent[] = [];
	const fontSections: string[] = [];
	let activeFontSection: string[] | null = null;

	const flushActiveFontSection = () => {
		const fontSection = activeFontSection?.join('\n').trimEnd();
		if (fontSection) {
			fontSections.push(fontSection);
		}
		activeFontSection = null;
	};

	for (const line of lines) {
		const playResXMatch = line.match(/^PlayResX:\s*(\d+(?:\.\d+)?)/i);
		if (playResXMatch) {
			playResX = Number.parseFloat(playResXMatch[1]);
		}
		const playResYMatch = line.match(/^PlayResY:\s*(\d+(?:\.\d+)?)/i);
		if (playResYMatch) {
			playResY = Number.parseFloat(playResYMatch[1]);
		}
		const sectionMatch = line.match(/^\[(.*)\]\s*$/);
		if (sectionMatch) {
			flushActiveFontSection();
			section = sectionMatch[1].trim().toLowerCase();
			activeFontSection = section === 'fonts' ? [] : null;
			continue;
		}
		if (section === 'fonts') {
			activeFontSection?.push(line);
			continue;
		}
		const separatorIndex = line.indexOf(':');
		if (separatorIndex === -1) {
			continue;
		}
		const key = line.slice(0, separatorIndex).trim().toLowerCase();
		const rawValue = line.slice(separatorIndex + 1).trim();
		if (section === 'v4+ styles' || section === 'v4 styles') {
			if (key === 'format') {
				styleColumns = rawValue.split(',').map((value) => value.trim());
				continue;
			}
			if (key !== 'style') {
				continue;
			}
			const rawValues = splitAssValues(rawValue, styleColumns.length);
			const values: Record<string, string> = {};
			for (let index = 0; index < styleColumns.length; index++) {
				values[normalizeAssColumnName(styleColumns[index])] = rawValues[index] ?? '';
			}
			styles.push({ values });
			continue;
		}
		if (section === 'events') {
			if (key === 'format') {
				eventColumns = rawValue.split(',').map((value) => value.trim());
				continue;
			}
			if (key !== 'dialogue') {
				continue;
			}
			const rawValues = splitAssValues(rawValue, eventColumns.length);
			const values: Record<string, string> = {};
			for (let index = 0; index < eventColumns.length; index++) {
				values[normalizeAssColumnName(eventColumns[index])] = rawValues[index] ?? '';
			}
			events.push({
				endTime: parseAssTimestamp(assValue(values, 'End', ASS_EVENT_DEFAULTS)),
				startTime: parseAssTimestamp(assValue(values, 'Start', ASS_EVENT_DEFAULTS)),
				values
			});
		}
	}

	flushActiveFontSection();

	return {
		content,
		eventColumns,
		events,
		fontSections,
		header: header.trimEnd(),
		playResX: Number.isFinite(playResX) ? playResX : null,
		playResY: Number.isFinite(playResY) ? playResY : null,
		styleColumns,
		styles,
		track
	};
}

function getAssStyleName(style: AssParsedStyle) {
	return assValue(style.values, 'Name', ASS_STYLE_DEFAULTS);
}

function normalizeAssStyleKey(styleName: string) {
	return styleName.trim().toLowerCase();
}

function getAssDocumentStyles(document: AssParsedDocument) {
	return document.styles.length > 0
		? document.styles
		: parseAssDocument(
				normalizeAssRendererFonts(EMPTY_ASS_TRACK, document.track.language),
				document.track
			).styles;
}

function getAssMergedStyleName(styleName: string, documentIndex: number) {
	return `sparkle_${documentIndex}_${(styleName.trim() || ASS_STYLE_DEFAULTS.name).replace(
		/,/g,
		'_'
	)}`;
}

function getAssStyleNameMap(document: AssParsedDocument, documentIndex: number) {
	const styleNameMap = new Map<string, string>();
	for (const style of getAssDocumentStyles(document)) {
		const styleName = getAssStyleName(style) || ASS_STYLE_DEFAULTS.name;
		styleNameMap.set(
			normalizeAssStyleKey(styleName),
			getAssMergedStyleName(styleName, documentIndex)
		);
	}
	if (!styleNameMap.has(normalizeAssStyleKey(ASS_STYLE_DEFAULTS.name))) {
		styleNameMap.set(
			normalizeAssStyleKey(ASS_STYLE_DEFAULTS.name),
			getAssMergedStyleName(ASS_STYLE_DEFAULTS.name, documentIndex)
		);
	}
	return styleNameMap;
}

function getMappedAssStyleName(
	styleName: string,
	styleNameMap: Map<string, string>,
	fallbackStyleName: string
) {
	const normalizedStyleName = normalizeAssStyleKey(styleName);
	return styleNameMap.get(normalizedStyleName) ?? fallbackStyleName;
}

function namespaceAssStyleResetOverrides(text: string, styleNameMap: Map<string, string>) {
	return text.replace(/\{([^}]*)\}/g, (_, overrideText: string) => {
		const namespacedOverrideText = overrideText.replace(
			/\\r([^\\}]*)/gi,
			(match, styleName: string) => {
				const trimmedStyleName = styleName.trim();
				if (!trimmedStyleName) {
					return '\\r';
				}
				const mappedStyleName = styleNameMap.get(normalizeAssStyleKey(trimmedStyleName));
				return mappedStyleName ? `\\r${mappedStyleName}` : match;
			}
		);
		return `{${namespacedOverrideText}}`;
	});
}

function formatScaledAssNumber(value: string, scale: number, integer = false) {
	if (scale === 1) {
		return value;
	}
	const trimmedValue = value.trim();
	if (!ASS_NUMBER_PATTERN.test(trimmedValue)) {
		return value;
	}
	const numericValue = Number.parseFloat(trimmedValue);
	if (!Number.isFinite(numericValue)) {
		return value;
	}
	const scaledValue = integer
		? Math.round(numericValue * scale)
		: Math.round(numericValue * scale * 1000) / 1000;
	if (Object.is(scaledValue, -0)) {
		return '0';
	}
	return String(scaledValue);
}

function scaleAssStyleValues(values: Record<string, string>, scale: number) {
	if (scale === 1) {
		return values;
	}
	for (const key of ['fontsize', 'spacing', 'outline', 'shadow']) {
		values[key] = formatScaledAssNumber(values[key] ?? '', scale);
	}
	for (const key of ['marginl', 'marginr', 'marginv']) {
		values[key] = formatScaledAssNumber(values[key] ?? '', scale, true);
	}
	return values;
}

function scaleAssEventMargins(values: Record<string, string>, scale: number) {
	if (scale === 1) {
		return values;
	}
	for (const key of ['marginl', 'marginr', 'marginv']) {
		values[key] = formatScaledAssNumber(values[key] ?? '', scale, true);
	}
	return values;
}

function scaleAssOverrideText(text: string, scale: number) {
	if (scale === 1) {
		return text;
	}
	return text.replace(
		/\\(fs|fsp|bord|xbord|ybord|shad|xshad|yshad|blur|be)(-?(?:\d+(?:\.\d+)?|\.\d+))/gi,
		(match, tag: string, value: string) => {
			const scaledValue = formatScaledAssNumber(value, scale, tag.toLowerCase() === 'be');
			return scaledValue === value ? match : `\\${tag}${scaledValue}`;
		}
	);
}

function normalizeAssFontLookupName(fontName: string) {
	return fontName.trim().replace(/^@/, '').toLowerCase();
}

function getAssRendererLanguageFallbackFont(language: string | null | undefined) {
	const normalizedLanguage = language?.trim().toLowerCase();
	if (!normalizedLanguage) {
		return null;
	}
	const fallbackEntry = Object.entries(fallbackFontsMap).find(([languageTag]) => {
		const normalizedLanguageTag = languageTag.toLowerCase();
		return (
			normalizedLanguageTag === normalizedLanguage ||
			normalizedLanguageTag.split('-')[0] === normalizedLanguage
		);
	});
	return fallbackEntry?.[1]?.[0] ?? null;
}

function getAssRendererScriptFallbackFont(content: string, language?: string | null) {
	const languageFallback = getAssRendererLanguageFallbackFont(language);
	if (languageFallback) {
		return languageFallback;
	}
	return ASS_SCRIPT_FALLBACK_FONTS.find(({ pattern }) => pattern.test(content))?.family ?? null;
}

function shouldUseAssRendererScriptFallback(fontName: string) {
	const normalizedFontName = normalizeAssFontLookupName(fontName);
	return normalizedFontName ? ASS_COMMON_PLATFORM_FONT_ALIAS_SET.has(normalizedFontName) : false;
}

function getAssRendererFontName(
	fontName: string,
	options: { fallbackFont?: string | null; phoneticAnnotation?: boolean } = {}
) {
	const normalizedFontName = normalizeAssFontLookupName(fontName);
	if (ASS_ARABIC_FONT_ALIASES.some((alias) => alias.toLowerCase() === normalizedFontName)) {
		return ASS_ARABIC_FONT;
	}
	const annotationFont = ASS_ANNOTATION_FONT_ALIASES.some(
		(alias) => alias.toLowerCase() === normalizedFontName
	);
	if (options.phoneticAnnotation && annotationFont) {
		return ASS_DEFAULT_LATIN_FONT;
	}
	if (options.fallbackFont && shouldUseAssRendererScriptFallback(fontName)) {
		return options.fallbackFont;
	}
	return fontName;
}

function isAssPhoneticAnnotationOverride(text: string) {
	return (
		/\\c&HAAEBFF&/i.test(text) && /\\fscx60(?:\.0+)?/i.test(text) && /\\fscy60(?:\.0+)?/i.test(text)
	);
}

function normalizeAssRendererOverrideFonts(text: string, fallbackFont: string | null) {
	return text.replace(/\{([^}]*)\}/g, (block, overrideText: string) => {
		const phoneticAnnotation = isAssPhoneticAnnotationOverride(overrideText);
		return `{${overrideText.replace(/\\fn([^\\}]*)/gi, (match, fontName: string) => {
			const rendererFontName = getAssRendererFontName(fontName, {
				fallbackFont,
				phoneticAnnotation
			});
			return rendererFontName === fontName ? match : `\\fn${rendererFontName}`;
		})}}`;
	});
}

function normalizeAssRendererStyleFonts(content: string, fallbackFont: string | null) {
	let section = '';
	let styleColumns = ASS_STYLE_COLUMNS.map(String);
	return content
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => {
			const sectionMatch = line.match(/^\[(.*)\]\s*$/);
			if (sectionMatch) {
				section = sectionMatch[1].trim().toLowerCase();
				return line;
			}
			if (section !== 'v4+ styles' && section !== 'v4 styles') {
				return line;
			}
			const separatorIndex = line.indexOf(':');
			if (separatorIndex === -1) {
				return line;
			}
			const key = line.slice(0, separatorIndex).trim().toLowerCase();
			const rawValue = line.slice(separatorIndex + 1).trim();
			if (key === 'format') {
				styleColumns = rawValue.split(',').map((value) => value.trim());
				return line;
			}
			if (key !== 'style') {
				return line;
			}
			const fontNameIndex = styleColumns.findIndex(
				(column) => normalizeAssColumnName(column) === 'fontname'
			);
			if (fontNameIndex === -1) {
				return line;
			}
			const values = splitAssValues(rawValue, styleColumns.length);
			const rendererFontName = getAssRendererFontName(values[fontNameIndex] ?? '', {
				fallbackFont
			});
			if (rendererFontName === values[fontNameIndex]) {
				return line;
			}
			values[fontNameIndex] = rendererFontName;
			return `${line.slice(0, separatorIndex + 1)} ${values.join(',')}`;
		})
		.join('\n');
}

function normalizeAssRendererFonts(content: string, language?: string | null) {
	const fallbackFont = getAssRendererScriptFallbackFont(content, language);
	return normalizeAssRendererOverrideFonts(
		normalizeAssRendererStyleFonts(content, fallbackFont),
		fallbackFont
	);
}

function markAssRendererFontsNormalized(content: string) {
	if (content.includes(ASS_RENDERER_FONT_NORMALIZATION_MARKER)) {
		return content;
	}
	const normalizedContent = content.replace(/\r\n?/g, '\n');
	const lines = normalizedContent.split('\n');
	const scriptInfoIndex = lines.findIndex((line) => /^\[script info\]\s*$/i.test(line));
	if (scriptInfoIndex >= 0) {
		lines.splice(scriptInfoIndex + 1, 0, ASS_RENDERER_FONT_NORMALIZATION_MARKER);
		return lines.join('\n');
	}
	return `${ASS_RENDERER_FONT_NORMALIZATION_MARKER}\n${normalizedContent}`;
}

function areAssRendererFontsNormalized(content: string) {
	return content.includes(ASS_RENDERER_FONT_NORMALIZATION_MARKER);
}

function createNamespacedAssStyleValues(
	style: AssParsedStyle,
	styleNameMap: Map<string, string>,
	scale: number
) {
	const styleName = getAssStyleName(style) || ASS_STYLE_DEFAULTS.name;
	const values: Record<string, string> = {};
	for (const column of ASS_STYLE_COLUMNS) {
		values[normalizeAssColumnName(column)] = assValue(style.values, column, ASS_STYLE_DEFAULTS);
	}
	values.name = getMappedAssStyleName(styleName, styleNameMap, ASS_STYLE_DEFAULTS.name);
	return scaleAssStyleValues(values, scale);
}

function createNamespacedAssEventValues(
	event: AssParsedEvent,
	styleNameMap: Map<string, string>,
	scale: number
) {
	const fallbackStyleName =
		styleNameMap.get(normalizeAssStyleKey(ASS_STYLE_DEFAULTS.name)) ?? ASS_STYLE_DEFAULTS.name;
	const values: Record<string, string> = {};
	for (const column of ASS_EVENT_COLUMNS) {
		values[normalizeAssColumnName(column)] = assValue(event.values, column, ASS_EVENT_DEFAULTS);
	}
	values.style = getMappedAssStyleName(values.style, styleNameMap, fallbackStyleName);
	values.text = scaleAssOverrideText(
		namespaceAssStyleResetOverrides(values.text, styleNameMap),
		scale
	);
	return scaleAssEventMargins(values, scale);
}

function serializeAssRow(
	columns: readonly string[],
	values: Record<string, string>,
	defaults: Record<string, string>
) {
	return columns.map((column) => assValue(values, column, defaults)).join(',');
}

function serializeAssStyle(values: Record<string, string>) {
	return `Style: ${serializeAssRow(ASS_STYLE_COLUMNS, values, ASS_STYLE_DEFAULTS)}`;
}

function serializeAssEvent(values: Record<string, string>) {
	return `Dialogue: ${serializeAssRow(ASS_EVENT_COLUMNS, values, ASS_EVENT_DEFAULTS)}`;
}

function serializeMergedAssHeader(document: AssParsedDocument) {
	return document.header.trimEnd() || '[Script Info]\nScriptType: v4.00+';
}

function serializeMergedAssFontSections(documents: AssParsedDocument[]) {
	const fontSections: string[] = [];
	const emittedFontSections = new Set<string>();
	for (const document of documents) {
		for (const fontSection of document.fontSections) {
			const normalizedFontSection = fontSection.trim();
			if (!normalizedFontSection || emittedFontSections.has(normalizedFontSection)) {
				continue;
			}
			emittedFontSections.add(normalizedFontSection);
			fontSections.push(normalizedFontSection);
		}
	}
	return fontSections.length > 0 ? `\n[Fonts]\n${fontSections.join('\n')}\n` : '';
}

function serializeMergedAss(
	documents: AssParsedDocument[],
	scale = getMergedSubtitleFontScale(documents.length)
) {
	if (documents.length === 0) {
		return '';
	}
	const primaryDocument = documents[0];
	const styles: string[] = [];
	const events: string[] = [];
	const emittedStyleNames = new Set<string>();

	documents.forEach((document, documentIndex) => {
		const styleNameMap = getAssStyleNameMap(document, documentIndex);
		for (const style of getAssDocumentStyles(document)) {
			const values = createNamespacedAssStyleValues(style, styleNameMap, scale);
			const styleName = normalizeAssStyleKey(values.name);
			if (emittedStyleNames.has(styleName)) {
				continue;
			}
			emittedStyleNames.add(styleName);
			styles.push(serializeAssStyle(values));
		}
		for (const event of document.events) {
			if (
				!Number.isFinite(event.startTime) ||
				!Number.isFinite(event.endTime) ||
				event.endTime <= event.startTime
			) {
				continue;
			}
			events.push(serializeAssEvent(createNamespacedAssEventValues(event, styleNameMap, scale)));
		}
	});

	return `${serializeMergedAssHeader(primaryDocument)}

[V4+ Styles]
Format: ${ASS_STYLE_COLUMNS.join(', ')}
${styles.join('\n')}

[Events]
Format: ${ASS_EVENT_COLUMNS.join(', ')}
${events.join('\n')}
${serializeMergedAssFontSections(documents)}`;
}

async function buildMergedSubtitleContent(
	tracks: SubtitleTrackInfo[],
	signal: AbortSignal
): Promise<string> {
	if (tracks.length === 0) {
		return '';
	}
	if (tracks[0].format === 'ass') {
		const documents = await Promise.all(
			tracks.map(async (track) => {
				const content = await fetchSubtitleText(track, signal);
				return parseAssDocument(normalizeAssRendererFonts(content, track.language), track);
			})
		);
		return markAssRendererFontsNormalized(serializeMergedAss(documents));
	}
	const parser = await loadCaptionsParserModule();
	const documents = await Promise.all(
		tracks.map((track) => parseSubtitleDocument(parser, track, signal))
	);
	const cues = mergeSubtitleCues(documents);
	return serializeMergedVtt(cues);
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

function getPictureInPictureDocument() {
	if (typeof document === 'undefined') {
		return null;
	}
	return document as SparklePictureInPictureDocument;
}

function getPageVideoElements(preferredVideo?: SparklePictureInPictureVideoElement | null) {
	const videos: SparklePictureInPictureVideoElement[] = [];
	if (preferredVideo) {
		videos.push(preferredVideo);
	}
	if (typeof document === 'undefined') {
		return videos;
	}
	try {
		for (const video of document.querySelectorAll('video')) {
			if (video !== preferredVideo) {
				videos.push(video as SparklePictureInPictureVideoElement);
			}
		}
	} catch {
		// The document can be unavailable during page teardown.
	}
	return videos;
}

function canUseStandardPictureInPicture(video: SparklePictureInPictureVideoElement | null) {
	const pipDocument = getPictureInPictureDocument();
	return Boolean(
		video &&
		pipDocument?.pictureInPictureEnabled &&
		!video.disablePictureInPicture &&
		typeof video.requestPictureInPicture === 'function'
	);
}

function canUseWebKitPictureInPicture(video: SparklePictureInPictureVideoElement | null) {
	if (
		!video ||
		typeof video.webkitSetPresentationMode !== 'function' ||
		typeof video.webkitSupportsPresentationMode !== 'function'
	) {
		return false;
	}
	try {
		return video.webkitSupportsPresentationMode('picture-in-picture');
	} catch {
		return false;
	}
}

function canUseNativePictureInPicture(video: SparklePictureInPictureVideoElement | null) {
	return canUseStandardPictureInPicture(video) || canUseWebKitPictureInPicture(video);
}

function prepareVideoElementForBackgroundPlayback(
	video: SparklePictureInPictureVideoElement | null
) {
	if (!video) {
		return;
	}
	try {
		video.playsInline = true;
		video.setAttribute('playsinline', '');
		video.setAttribute('webkit-playsinline', '');
	} catch {
		// The media element may be detached during a source switch.
	}
	try {
		video.disablePictureInPicture = false;
	} catch {
		// Some browsers expose this as read-only.
	}
}

function isNativePictureInPictureActive(video: SparklePictureInPictureVideoElement | null) {
	if (!video) {
		return false;
	}
	const pipDocument = getPictureInPictureDocument();
	return (
		pipDocument?.pictureInPictureElement === video ||
		video.webkitPresentationMode === 'picture-in-picture'
	);
}

function isPlayerPictureInPictureStateActive(player: MediaPlayerInstance | null) {
	if (!player) {
		return false;
	}
	try {
		return player.state.pictureInPicture === true;
	} catch {
		return false;
	}
}

function dispatchMissingPictureInPictureLeave(video: SparklePictureInPictureVideoElement | null) {
	if (!video) {
		return false;
	}
	let dispatched = false;
	try {
		video.dispatchEvent(new Event('leavepictureinpicture'));
		dispatched = true;
	} catch {
		// Synthetic cleanup should not block native PiP teardown.
	}
	try {
		video.dispatchEvent(new Event('webkitpresentationmodechanged'));
		dispatched = true;
	} catch {
		// WebKit-only event may not exist on the current browser.
	}
	return dispatched;
}

function syncStalePlayerPictureInPictureState(player: MediaPlayerInstance | null) {
	const video = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	if (
		!video ||
		isNativePictureInPictureActive(video) ||
		!isPlayerPictureInPictureStateActive(player)
	) {
		return false;
	}
	return dispatchMissingPictureInPictureLeave(video);
}

function waitForNextFrame() {
	return new Promise<void>((resolve) => {
		if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
			setTimeout(resolve, 0);
			return;
		}
		window.requestAnimationFrame(() => resolve());
	});
}

function waitForTimeout(ms: number) {
	return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function waitForPictureInPictureExit(player: MediaPlayerInstance | null, timeoutMs = 500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const video = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
		if (!isNativePictureInPictureActive(video) && !isPlayerPictureInPictureStateActive(player)) {
			return true;
		}
		syncStalePlayerPictureInPictureState(player);
		await waitForNextFrame();
	}

	const video = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	return !isNativePictureInPictureActive(video) && !isPlayerPictureInPictureStateActive(player);
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 250) {
	return new Promise<void>((resolve) => {
		let settled = false;
		const done = () => {
			if (settled) {
				return;
			}
			settled = true;
			window.clearTimeout(timeout);
			resolve();
		};
		const timeout = window.setTimeout(done, timeoutMs);
		if (typeof video.requestVideoFrameCallback !== 'function') {
			return;
		}
		try {
			video.requestVideoFrameCallback(() => done());
		} catch {
			done();
		}
	});
}

async function restoreVideoAfterPictureInPicture(
	player: MediaPlayerInstance | null,
	mediaProvider: MediaProviderInstance | null
) {
	const video = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	if (!video || typeof document === 'undefined' || !document.contains(video)) {
		return;
	}

	prepareVideoElementForBackgroundPlayback(video);

	try {
		mediaProvider?.load(video);
	} catch {
		// Provider can already be attached; repaint nudges below still apply.
	}

	const wasPaused = video.paused;
	const time = Number.isFinite(video.currentTime) ? video.currentTime : null;
	const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
	const previousTransform = video.style.transform;
	const previousWillChange = video.style.willChange;

	try {
		video.style.willChange = 'transform';
		video.style.transform = previousTransform
			? `${previousTransform} translateZ(0)`
			: 'translateZ(0)';
		void video.offsetHeight;
	} catch {
		// Style repaint is opportunistic.
	}

	await waitForNextFrame();

	if (time !== null && duration !== null && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
		const maxTime = Math.max(0, duration - 0.05);
		const repaintTime =
			time < maxTime ? Math.min(maxTime, time + 0.001) : Math.max(0, time - 0.001);
		if (Math.abs(repaintTime - time) > 0) {
			try {
				video.currentTime = repaintTime;
				await waitForNextFrame();
				video.currentTime = time;
			} catch {
				// Some browsers reject seeks while restoring a detached PiP surface.
			}
		}
	}

	if (!wasPaused) {
		try {
			await video.play();
		} catch {
			// Playback might already be running or blocked; do not disturb room sync.
		}
	}

	await waitForVideoFrame(video);

	try {
		video.style.transform = previousTransform;
		video.style.willChange = previousWillChange;
	} catch {
		// Ignore style restore failures during teardown.
	}
}

async function enterNativePictureInPicture(player: MediaPlayerInstance | null) {
	const video = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	if (!video) {
		return false;
	}
	prepareVideoElementForBackgroundPlayback(video);
	if (isNativePictureInPictureActive(video)) {
		return true;
	}
	if (canUseStandardPictureInPicture(video)) {
		await video.requestPictureInPicture?.();
		return isNativePictureInPictureActive(video);
	}
	if (canUseWebKitPictureInPicture(video)) {
		await video.webkitSetPresentationMode?.('picture-in-picture');
		return true;
	}
	return false;
}

async function exitNativePictureInPicture(player: MediaPlayerInstance | null) {
	const video = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	const pipDocument = getPictureInPictureDocument();
	let exited = false;

	if (
		pipDocument?.pictureInPictureElement &&
		typeof pipDocument.exitPictureInPicture === 'function'
	) {
		try {
			await pipDocument.exitPictureInPicture();
			exited = true;
		} catch {
			// Safari/Chrome can reject during tab teardown; WebKit cleanup below may still apply.
		}
	}

	for (const candidate of getPageVideoElements(video)) {
		if (
			candidate.webkitPresentationMode === 'picture-in-picture' &&
			typeof candidate.webkitSetPresentationMode === 'function'
		) {
			try {
				await candidate.webkitSetPresentationMode('inline');
				exited = true;
			} catch {
				// Do not let native PiP cleanup block foreground restoration.
			}
		}
	}

	return exited;
}

async function enterPlayerPictureInPicture(player: MediaPlayerInstance | null, trigger?: Event) {
	if (!player || getSafePlayerPaused(player) !== false) {
		return false;
	}
	if (getSafePlayerPictureInPicture(player)) {
		return true;
	}

	try {
		await player.enterPictureInPicture(trigger);
		if (getSafePlayerPictureInPicture(player)) {
			return true;
		}
	} catch {
		// Vidstack may not have caught up to native/WebKit PiP support yet.
	}

	try {
		return await enterNativePictureInPicture(player);
	} catch {
		return false;
	}
}

async function exitPlayerPictureInPicture(player: MediaPlayerInstance | null, trigger?: Event) {
	if (!player) {
		return false;
	}

	let playerExited = false;
	try {
		await player.exitPictureInPicture(trigger);
		playerExited = true;
	} catch {
		// The player can report no active PiP while the native video element is still stuck there.
	}

	const nativeExited = await exitNativePictureInPicture(player);
	let staleStateSynced = syncStalePlayerPictureInPictureState(player);
	if (staleStateSynced) {
		await waitForPictureInPictureExit(player, 250);
	}
	if (getSafePlayerPictureInPicture(player)) {
		try {
			await player.exitPictureInPicture(trigger);
			playerExited = true;
			staleStateSynced = syncStalePlayerPictureInPictureState(player) || staleStateSynced;
			await waitForPictureInPictureExit(player);
			return true;
		} catch {
			staleStateSynced = syncStalePlayerPictureInPictureState(player) || staleStateSynced;
			await waitForPictureInPictureExit(player);
			return playerExited || nativeExited || staleStateSynced;
		}
	}
	if (playerExited || nativeExited || staleStateSynced) {
		await waitForPictureInPictureExit(player);
	}
	return playerExited || nativeExited || staleStateSynced;
}

function isPictureInPictureControlEvent(event: Event, root: HTMLElement | null | undefined) {
	if (typeof Element === 'undefined' || !(event.target instanceof Element)) {
		return false;
	}
	const pipControl = event.target.closest(
		'.vds-pip-button, [data-media-tooltip="pip"], media-pip-button'
	);
	return Boolean(pipControl && (!root || root.contains(pipControl)));
}

function isEditableKeyboardEventTarget(target: EventTarget | null) {
	if (typeof Element === 'undefined' || !(target instanceof Element)) {
		return false;
	}
	return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isProbablyIOSWebKit() {
	if (typeof navigator === 'undefined') {
		return false;
	}
	const platform = navigator.platform || '';
	const userAgent = navigator.userAgent || '';
	return (
		/iP(ad|hone|od)/.test(platform) ||
		(platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
		/iP(ad|hone|od)/.test(userAgent)
	);
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
	const format = getSubtitleFormat(track.src);
	return {
		annotated: false,
		cueForge: false,
		src: track.src,
		label: track.label || '',
		language: track.language || '',
		format,
		mode: track.mode,
		style: getSubtitleSelectionStyle(format)
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
	if (directSelected && (!directSelected.mode || directSelected.mode === 'showing')) {
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

function isAudibleChatMessage(message: Chat | undefined) {
	return Boolean(message && !message.isSystem && !message.isStateUpdate);
}

function getLatestAudibleChatTimestamp(messages: Chat[]) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isAudibleChatMessage(messages[i])) {
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
		const audio = audioRef.current;
		audio.srcObject = stream;
		return () => {
			if (audio.srcObject === stream) {
				audio.pause();
				audio.srcObject = null;
				audio.removeAttribute('src');
				audio.load();
			}
		};
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
		const audio = audioRef.current;
		return () => {
			if (audio) {
				audio.pause();
				audio.srcObject = null;
				audio.removeAttribute('src');
				audio.load();
			}
			sourceRef.current?.disconnect();
			gainRef.current?.disconnect();
			void audioContextRef.current?.close().catch(() => {});
		};
	}, []);

	return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
}

function StoryboardCanvasPreview({ thumbnailSrc }: { thumbnailSrc: string }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const drawRequestRef = useRef(0);
	const supportsCanvasTiles =
		typeof window === 'undefined' || typeof createImageBitmap === 'function';
	const thumbnails = useThumbnails(thumbnailSrc, 'anonymous') as StoryboardThumbnail[];
	const storyboardSpriteSources = useMemo(
		() => getStoryboardSpriteSources(thumbnails),
		[thumbnails]
	);
	const pointerRate = useSliderState('pointerRate');
	const pointing = useSliderState('pointing');
	const dragging = useSliderState('dragging');
	const duration = useMediaState('duration');
	const clipStartTime = useMediaState('clipStartTime');
	const previewTime =
		Number.isFinite(duration) && Number.isFinite(clipStartTime)
			? clipStartTime + pointerRate * duration
			: 0;
	const activeThumbnail = useMemo(
		() => findStoryboardThumbnail(thumbnails, previewTime),
		[thumbnails, previewTime]
	);
	const previewSize = useMemo(() => getStoryboardPreviewSize(activeThumbnail), [activeThumbnail]);
	const visible = Boolean(activeThumbnail && (pointing || dragging));
	const thumbnailStyle = useMemo(
		() =>
			({
				'--thumbnail-width': `${previewSize.cssWidth}px`,
				'--thumbnail-height': `${previewSize.cssHeight}px`,
				'--thumbnail-aspect-ratio': String(previewSize.cssWidth / previewSize.cssHeight)
			}) as CSSProperties,
		[previewSize]
	);

	useEffect(() => {
		if (!activeThumbnail || !visible || !supportsCanvasTiles) {
			return;
		}

		const activeSrc = activeThumbnail.url.href;
		const nearbySources = getNearbyStoryboardSpriteSources(activeSrc, storyboardSpriteSources);
		if (nearbySources.length <= 1) {
			return;
		}

		return scheduleStoryboardPrewarm(() => {
			for (const src of nearbySources.slice(1)) {
				prewarmStoryboardSprite(src);
			}
		});
	}, [activeThumbnail, storyboardSpriteSources, supportsCanvasTiles, visible]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !activeThumbnail || !visible || !supportsCanvasTiles) {
			return;
		}

		const requestId = drawRequestRef.current + 1;
		drawRequestRef.current = requestId;

		const drawSpriteBitmap = (bitmap: ImageBitmap) => {
			if (drawRequestRef.current !== requestId) {
				return;
			}

			if (canvas.width !== previewSize.bitmapWidth || canvas.height !== previewSize.bitmapHeight) {
				canvas.width = previewSize.bitmapWidth;
				canvas.height = previewSize.bitmapHeight;
			}

			const context = canvas.getContext('2d');
			if (!context) {
				return;
			}
			const sourceRect = clampStoryboardSourceRect(
				getStoryboardSourceRect(activeThumbnail, previewSize),
				bitmap
			);
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = 'medium';
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(
				bitmap,
				sourceRect.x,
				sourceRect.y,
				sourceRect.width,
				sourceRect.height,
				0,
				0,
				canvas.width,
				canvas.height
			);
		};

		void getStoryboardSpriteBitmap(activeThumbnail.url.href)
			.then(drawSpriteBitmap)
			.catch(() => {
				if (drawRequestRef.current === requestId) {
					const context = canvas.getContext('2d');
					context?.clearRect(0, 0, canvas.width, canvas.height);
				}
			});
	}, [activeThumbnail, previewSize, supportsCanvasTiles, visible]);

	if (!supportsCanvasTiles) {
		return (
			<TimeSlider.Thumbnail.Root src={thumbnailSrc} className="vds-slider-thumbnail vds-thumbnail">
				<TimeSlider.Thumbnail.Img />
			</TimeSlider.Thumbnail.Root>
		);
	}

	if (!activeThumbnail) {
		return null;
	}

	return (
		<div
			className="vds-slider-thumbnail vds-thumbnail sparkle-storyboard-thumbnail"
			style={thumbnailStyle}
		>
			<canvas
				ref={canvasRef}
				width={previewSize.bitmapWidth}
				height={previewSize.bitmapHeight}
				style={{ width: previewSize.cssWidth, height: previewSize.cssHeight }}
			/>
		</div>
	);
}

function OptimizedTimeSlider({ thumbnails }: { thumbnails: string | null }) {
	const [instance, setInstance] = useState<TimeSliderInstance | null>(null);
	const [width, setWidth] = useState(0);
	const {
		disableTimeSlider = false,
		noScrubGesture = false,
		seekStep = 10,
		sliderChaptersMinWidth = 325
	} = useDefaultLayoutContext();
	const label = useDefaultLayoutWord('Seek');

	useLayoutEffect(() => {
		const el = instance?.el;
		if (!el) {
			return;
		}

		const updateWidth = () => setWidth(el.clientWidth);
		updateWidth();

		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const observer = new ResizeObserver(updateWidth);
		observer.observe(el);
		return () => observer.disconnect();
	}, [instance]);

	return (
		<TimeSlider.Root
			className="vds-time-slider vds-slider"
			aria-label={label}
			disabled={disableTimeSlider}
			noSwipeGesture={noScrubGesture}
			keyStep={seekStep}
			ref={setInstance}
		>
			<TimeSlider.Chapters
				className="vds-slider-chapters"
				disabled={width < sliderChaptersMinWidth}
			>
				{(cues, forwardRef) =>
					cues.map((cue) => (
						<div className="vds-slider-chapter" key={cue.startTime} ref={forwardRef}>
							<TimeSlider.Track className="vds-slider-track" />
							<TimeSlider.TrackFill className="vds-slider-track-fill vds-slider-track" />
							<TimeSlider.Progress className="vds-slider-progress vds-slider-track" />
						</div>
					))
				}
			</TimeSlider.Chapters>
			<TimeSlider.Thumb className="vds-slider-thumb" />
			<TimeSlider.Preview className="vds-slider-preview">
				{thumbnails ? <StoryboardCanvasPreview thumbnailSrc={thumbnails} /> : null}
				<TimeSlider.ChapterTitle className="vds-slider-chapter-title" />
				<TimeSlider.Value className="vds-slider-value" />
			</TimeSlider.Preview>
		</TimeSlider.Root>
	);
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
					<button
						type="button"
						aria-label={label}
						aria-pressed={active}
						disabled={disabled}
						onClick={onClick}
						style={{ width: 40, height: 40, minWidth: 40, maxWidth: 40 }}
						className={`inline-flex flex-none cursor-pointer items-center justify-center rounded-xl border p-0 text-sm transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 ${
							active
								? 'border-primary/40 bg-primary text-primary-foreground shadow-sm'
								: 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
						}`}
					>
						<span className="flex h-5 w-5 items-center justify-center">{children}</span>
					</button>
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
		<div className="flex items-center gap-1 rounded-xl border bg-muted/35 p-1 shadow-sm">
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
		</div>
	);
}

function SubtitleLayerCheckbox({
	checked,
	label,
	onChange
}: {
	checked: boolean;
	label: string;
	onChange: (checked: boolean, trigger?: Event) => void;
}) {
	const readyForTriggerlessChangesRef = useRef(false);

	useEffect(() => {
		readyForTriggerlessChangesRef.current = false;
		const timer = window.setTimeout(() => {
			readyForTriggerlessChangesRef.current = true;
		}, 0);
		return () => {
			window.clearTimeout(timer);
			readyForTriggerlessChangesRef.current = false;
		};
	}, []);

	return (
		<DefaultMenuItem label={label}>
			<DefaultMenuCheckbox
				label={label}
				checked={checked}
				onChange={(nextChecked, trigger) => {
					if (nextChecked === checked || (!trigger && !readyForTriggerlessChangesRef.current)) {
						return;
					}
					onChange(nextChecked, trigger);
				}}
			/>
		</DefaultMenuItem>
	);
}

function SubtitlesMenuSection({
	activeFormat,
	extraSubtitleLayerSrcs,
	onFormatChange,
	onToggleTrack,
	selectedTrack,
	tracks
}: {
	activeFormat: SubtitleTrackFormat | null;
	extraSubtitleLayerSrcs: string[];
	onFormatChange: (format: SubtitleTrackFormat | 'off') => void;
	onToggleTrack: (track: SubtitleTrackInfo, checked: boolean) => void;
	selectedTrack: SelectedSubtitleTrack | null;
	tracks: SubtitleTrackInfo[];
}) {
	const formats = getAvailableSubtitleFormats(tracks);
	const formatOptions: Array<{ label: string; value: SubtitleTrackFormat | 'off' }> = [
		{ label: 'Off', value: 'off' },
		...formats.map((format) => ({ label: getSubtitleFormatName(format), value: format }))
	];
	const formatTracks = getSubtitleTracksByFormat(tracks, activeFormat);
	const selectedTrackSrcs = new Set([
		...(selectedTrack ? [selectedTrack.src] : []),
		...extraSubtitleLayerSrcs
	]);
	const formatToggleGroupRef = useRef<HTMLDivElement | null>(null);
	const offFormatButtonRef = useRef<HTMLButtonElement | null>(null);

	useLayoutEffect(() => {
		const group = formatToggleGroupRef.current;
		if (!group || typeof window === 'undefined') {
			return;
		}
		const menuRoot = group.closest<HTMLElement>('.vds-subtitles-settings-menu');
		const submenuItems = group.closest<HTMLElement>('.vds-menu-items[data-submenu]');
		const rootItems = group.closest<HTMLElement>('.vds-settings-menu-items[data-root]');

		const resetSubtitleMenuScroll = () => {
			if (submenuItems) {
				submenuItems.scrollTop = 0;
			}
			if (rootItems) {
				rootItems.scrollTop = 0;
			}
		};

		const dispatchResize = () => {
			const targets = new Set<HTMLElement>([group]);
			if (submenuItems) {
				targets.add(submenuItems);
			}
			if (rootItems) {
				targets.add(rootItems);
			}
			for (const target of targets) {
				target.dispatchEvent(new Event('vds-menu-resize', { bubbles: true }));
			}
		};

		let firstFrame = 0;
		let secondFrame = 0;
		let thirdFrame = 0;
		let timeout = 0;

		const cancelScheduledRefresh = () => {
			window.cancelAnimationFrame(firstFrame);
			window.cancelAnimationFrame(secondFrame);
			window.cancelAnimationFrame(thirdFrame);
			window.clearTimeout(timeout);
			firstFrame = 0;
			secondFrame = 0;
			thirdFrame = 0;
			timeout = 0;
		};

		const refreshSubtitleMenuLayout = (options: { resetScroll?: boolean } = {}) => {
			cancelScheduledRefresh();
			if (options.resetScroll) {
				resetSubtitleMenuScroll();
			}
			dispatchResize();
			firstFrame = window.requestAnimationFrame(() => {
				if (options.resetScroll) {
					resetSubtitleMenuScroll();
				}
				dispatchResize();
				secondFrame = window.requestAnimationFrame(() => {
					if (options.resetScroll) {
						resetSubtitleMenuScroll();
					}
					dispatchResize();
					thirdFrame = window.requestAnimationFrame(dispatchResize);
				});
			});
			timeout = window.setTimeout(dispatchResize, 120);
		};

		refreshSubtitleMenuLayout({ resetScroll: true });

		let resizeObserver: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => refreshSubtitleMenuLayout());
			resizeObserver.observe(submenuItems ?? group);
		}

		let mutationObserver: MutationObserver | null = null;
		if (typeof MutationObserver !== 'undefined') {
			mutationObserver = new MutationObserver(() => refreshSubtitleMenuLayout());
			for (const target of [menuRoot, submenuItems, rootItems]) {
				mutationObserver.observe(target ?? group, {
					attributeFilter: ['aria-hidden', 'class', 'data-open', 'hidden', 'style'],
					attributes: true
				});
			}
		}

		return () => {
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
			cancelScheduledRefresh();
		};
	}, [activeFormat, formatTracks.length]);

	if (formats.length === 0) {
		return null;
	}

	return (
		<>
			<DefaultMenuSection
				label="Format"
				value={activeFormat ? getSubtitleFormatName(activeFormat) : 'Off'}
			>
				<div
					aria-label="Subtitle format"
					className="sparkle-subtitle-format-toggle-group"
					data-subtitle-format-toggle-group="true"
					ref={formatToggleGroupRef}
					role="radiogroup"
				>
					{formatOptions.map((option) => {
						const checked = option.value === 'off' ? !activeFormat : activeFormat === option.value;
						return (
							<button
								key={option.value}
								aria-checked={checked}
								className="sparkle-subtitle-format-toggle"
								onClick={() => onFormatChange(option.value)}
								ref={option.value === 'off' ? offFormatButtonRef : undefined}
								role="radio"
								type="button"
							>
								{option.label}
							</button>
						);
					})}
				</div>
			</DefaultMenuSection>
			{activeFormat && formatTracks.length > 0 ? (
				<DefaultMenuSection label="Tracks" value={`${selectedTrackSrcs.size || 0}`}>
					{formatTracks.map((track) => (
						<SubtitleLayerCheckbox
							key={track.src}
							checked={selectedTrackSrcs.has(track.src)}
							label={track.settingsLabel}
							onChange={(checked, trigger) => {
								if (!checked && selectedTrackSrcs.size === 1 && selectedTrackSrcs.has(track.src)) {
									trigger?.preventDefault();
									trigger?.stopPropagation();
									trigger?.stopImmediatePropagation();
									offFormatButtonRef.current?.focus({ preventScroll: true });
									window.setTimeout(() => onToggleTrack(track, checked), 0);
									return;
								}
								onToggleTrack(track, checked);
							}}
						/>
					))}
				</DefaultMenuSection>
			) : null}
		</>
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
	addEventListener?: EventTarget['addEventListener'];
	freeTrack: () => void;
	setTrack?: (content: string) => void | Promise<void>;
	setTrackByUrl?: (url: string) => void | Promise<void>;
	destroy?: () => void | Promise<void>;
	_computeCanvasSize?: (width?: number, height?: number) => { width: number; height: number };
	ready?: Promise<void>;
	_canvas?: HTMLCanvasElement | null;
	_canvasctrl?: HTMLCanvasElement | OffscreenCanvas | null;
	_ctx?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | false | null;
	_destroyed?: boolean;
	_onmessage?: (event: MessageEvent) => void;
	_render?: (payload: JASSUBRenderPayload) => void;
	_worker?: Worker;
	busy?: boolean;
};

type JASSUBRenderPayload = {
	images?: Array<{ image?: { close?: () => void } | null }>;
	target?: string;
};

type ParsedSubtitleDocument = {
	content: string;
	cues: SubtitleMergeCue[];
	track: SubtitleTrackInfo;
};

type SubtitleMergeCue = {
	endTime: number;
	startTime: number;
	text: string;
};

type MergedSubtitleCue = SubtitleMergeCue;

type CaptionsParserModule = {
	parseText: (text: string, options?: { type?: 'ass' | 'vtt' }) => Promise<ParsedCaptionsResult>;
};

type AssParsedDocument = {
	content: string;
	eventColumns: string[];
	events: AssParsedEvent[];
	fontSections: string[];
	header: string;
	playResX: number | null;
	playResY: number | null;
	styleColumns: string[];
	styles: AssParsedStyle[];
	track: SubtitleTrackInfo;
};

type AssParsedStyle = {
	values: Record<string, string>;
};

type AssParsedEvent = {
	endTime: number;
	startTime: number;
	values: Record<string, string>;
};

type MergedSubtitleTrackState = {
	format: Extract<SubtitleTrackFormat, 'ass' | 'vtt'>;
	objectUrl: string;
	primarySrc: string;
	signature: string;
	track: TextTrack;
};

const JASSUB_SCRIPT_URL = '/scripts/jassub.es.js';
const ASS_STYLE_COLUMNS = [
	'Name',
	'Fontname',
	'Fontsize',
	'PrimaryColour',
	'SecondaryColour',
	'OutlineColour',
	'BackColour',
	'Bold',
	'Italic',
	'Underline',
	'StrikeOut',
	'ScaleX',
	'ScaleY',
	'Spacing',
	'Angle',
	'BorderStyle',
	'Outline',
	'Shadow',
	'Alignment',
	'MarginL',
	'MarginR',
	'MarginV',
	'Encoding'
] as const;
const ASS_EVENT_COLUMNS = [
	'Layer',
	'Start',
	'End',
	'Style',
	'Name',
	'MarginL',
	'MarginR',
	'MarginV',
	'Effect',
	'Text'
] as const;
const ASS_STYLE_DEFAULTS: Record<string, string> = {
	name: 'Default',
	fontname: 'Arial',
	fontsize: '20',
	primarycolour: '&H00FFFFFF',
	secondarycolour: '&H000000FF',
	outlinecolour: '&H00000000',
	backcolour: '&H00000000',
	bold: '0',
	italic: '0',
	underline: '0',
	strikeout: '0',
	scalex: '100',
	scaley: '100',
	spacing: '0',
	angle: '0',
	borderstyle: '1',
	outline: '2',
	shadow: '2',
	alignment: '2',
	marginl: '10',
	marginr: '10',
	marginv: '10',
	encoding: '1'
};
const ASS_EVENT_DEFAULTS: Record<string, string> = {
	layer: '0',
	start: '0:00:00.00',
	end: '0:00:00.00',
	style: 'Default',
	name: '',
	marginl: '0',
	marginr: '0',
	marginv: '0',
	effect: '',
	text: ''
};
const EMPTY_ASS_TRACK = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const ASS_RENDERER_FONT_NORMALIZATION_MARKER = '; Sparkle-Ass-Renderer-Fonts-Normalized: per-track';
let assRendererModulePromise: Promise<{ default: LibASSConstructor }> | null = null;
let captionsParserModulePromise: Promise<CaptionsParserModule> | null = null;

async function fetchAssRendererTrackContent(
	src: string,
	options: { language?: string | null; signal?: AbortSignal } = {}
) {
	const { language, signal } = options;
	const response = await fetch(src, { signal });
	if (!response.ok) {
		throw new Error(`Unable to load ASS subtitle track (${response.status})`);
	}
	const content = await response.text();
	return areAssRendererFontsNormalized(content)
		? content
		: normalizeAssRendererFonts(content, language);
}

function closeAssRenderImages(payload: JASSUBRenderPayload | null | undefined) {
	for (const image of payload?.images ?? []) {
		try {
			image.image?.close?.();
		} catch {
			// ImageBitmap.close() can throw after the browser has already detached it.
		}
	}
}

function isDetachedOffscreenCanvasError(error: unknown) {
	if (!(error instanceof Error || error instanceof DOMException)) {
		return false;
	}
	return error.name === 'InvalidStateError' && /OffscreenCanvas|detached/i.test(error.message);
}

function canRenderAssFrame(instance: JASSUBManagedInstance) {
	return !instance._destroyed && Boolean(instance._ctx && instance._canvasctrl);
}

function getAssCanvasScaleFactor(instance: JASSUBManagedInstance) {
	const prescaleFactor =
		(instance as { prescaleFactor?: number }).prescaleFactor &&
		(instance as { prescaleFactor?: number }).prescaleFactor! > 0
			? (instance as { prescaleFactor?: number }).prescaleFactor!
			: 1;
	const dpr = window.devicePixelRatio || 1;
	return dpr * prescaleFactor;
}

function releaseAssRendererCanvas(instance: JASSUBManagedInstance) {
	try {
		if (instance._canvasctrl && 'width' in instance._canvasctrl) {
			instance._canvasctrl.width = 0;
			instance._canvasctrl.height = 0;
		}
	} catch {
		// Transferred OffscreenCanvas instances can be unavailable during teardown.
	}
	try {
		if (instance._canvas) {
			instance._canvas.width = 0;
			instance._canvas.height = 0;
			const parent = instance._canvas.parentElement;
			if (parent?.classList.contains('JASSUB')) {
				parent.remove();
			} else {
				instance._canvas.remove();
			}
		}
	} catch {
		// The renderer may have already removed its canvas while destroying.
	}
}

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
		const destroy = instance.destroy?.bind(instance);
		const computeCanvasSize = instance._computeCanvasSize?.bind(instance);
		const onmessage = instance._onmessage?.bind(instance);
		const render = instance._render?.bind(instance);
		let destroyed = false;
		let trackRequestId = 0;

		if (computeCanvasSize) {
			instance._computeCanvasSize = (width = 0, height = 0) => {
				if (width <= 0 || height <= 0) {
					return { width: 0, height: 0 };
				}
				const scale = getAssCanvasScaleFactor(instance);
				return {
					width: Math.round(width * scale),
					height: Math.round(height * scale)
				};
			};
		}

		if (render) {
			instance._render = (payload: JASSUBRenderPayload) => {
				if (destroyed || !canRenderAssFrame(instance)) {
					closeAssRenderImages(payload);
					instance.busy = false;
					return;
				}
				try {
					render(payload);
				} catch (error) {
					closeAssRenderImages(payload);
					if (isDetachedOffscreenCanvasError(error)) {
						instance.busy = false;
						return;
					}
					throw error;
				}
			};
		}

		if (onmessage) {
			instance._onmessage = (event: MessageEvent) => {
				const payload = event.data as JASSUBRenderPayload | undefined;
				if (destroyed || instance._destroyed) {
					closeAssRenderImages(payload);
					return;
				}
				if (payload?.target === 'render' && !canRenderAssFrame(instance)) {
					closeAssRenderImages(payload);
					instance.busy = false;
					return;
				}
				try {
					onmessage(event);
				} catch (error) {
					closeAssRenderImages(payload);
					if (payload?.target === 'render' && isDetachedOffscreenCanvasError(error)) {
						instance.busy = false;
						return;
					}
					throw error;
				}
			};
		}

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
		};

		instance.destroy = () => {
			if (destroyed) {
				return;
			}
			destroyed = true;
			trackRequestId++;
			const worker = instance._worker;
			if (worker) {
				worker.onmessage = null;
				worker.onerror = null;
			}
			try {
				return void Promise.resolve(destroy?.())
					.catch(() => undefined)
					.finally(() => releaseAssRendererCanvas(instance));
			} catch {
				// JASSUB may already be half-torn-down after a fast track switch.
				releaseAssRendererCanvas(instance);
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

function loadCaptionsParserModule() {
	captionsParserModulePromise ??= import('media-captions').then((module) => ({
		parseText: module.parseText
	}));
	return captionsParserModulePromise;
}

class ManagedLibASSTextRenderer implements TextRenderer {
	readonly priority = 1;
	private readonly typeRE = /(?:^|\.)s?s?ass(?:$|[?#])/i;
	private instance: JASSUBManagedInstance | null = null;
	private loadRequestId = 0;
	private loadPromise: Promise<void> | null = null;
	private track: TextTrack | null = null;
	private trackAbortController: AbortController | null = null;
	private trackRequestId = 0;
	private video: HTMLVideoElement | null = null;

	constructor(
		readonly loader: () => Promise<{ default: LibASSConstructor }>,
		readonly config?: LibASSConfig
	) {}

	canRender(track: TextTrack, video: HTMLVideoElement | null) {
		return Boolean(
			video &&
			track.src &&
			((typeof track.type === 'string' && this.typeRE.test(track.type)) ||
				this.typeRE.test(track.src))
		);
	}

	attach(video: HTMLVideoElement | null) {
		if (!video) {
			return;
		}
		this.video = video;
		this.ensureInstance();
	}

	changeTrack(track: TextTrack | null) {
		if (!track?.src || track.readyState === 3) {
			this.track = null;
			this.freeTrack();
			return;
		}

		if (this.track === track) {
			return;
		}

		this.track = track;
		if (!this.instance) {
			this.ensureInstance();
			return;
		}
		this.setInstanceTrack(track);
	}

	detach() {
		this.loadRequestId++;
		this.loadPromise = null;
		this.track = null;
		this.video = null;
		this.cancelPendingTrackLoad();
		this.disposeInstance();
	}

	private ensureInstance() {
		const track = this.track;
		const trackSrc = track?.src;
		if (!this.video || !track || !trackSrc || this.instance || this.loadPromise) {
			return;
		}

		const requestId = ++this.loadRequestId;
		const video = this.video;
		const trackLanguage = track.language;
		const trackAbortController = new AbortController();
		this.trackAbortController = trackAbortController;
		this.loadPromise = this.loader()
			.then(async (module) => {
				const subContent = await fetchAssRendererTrackContent(trackSrc, {
					language: trackLanguage,
					signal: trackAbortController.signal
				});
				if (
					this.loadRequestId !== requestId ||
					this.video !== video ||
					this.track !== track ||
					!this.track?.src
				) {
					return;
				}

				const instance = new module.default({
					...this.config,
					video,
					subContent
				}) as JASSUBManagedInstance;
				this.instance = instance;
				instance.addEventListener?.('ready', () => {
					const canvas = instance._canvas;
					if (canvas) {
						canvas.style.pointerEvents = 'none';
					}
				});
				instance.addEventListener?.('error', (event) => {
					console.warn('ASS subtitle renderer error', (event as ErrorEvent).error);
				});
			})
			.catch((error) => {
				if (trackAbortController.signal.aborted) {
					return;
				}
				console.warn('Unable to load ASS subtitle renderer', error);
			})
			.finally(() => {
				if (this.loadRequestId === requestId) {
					this.loadPromise = null;
				}
				if (this.trackAbortController === trackAbortController) {
					this.trackAbortController = null;
				}
				if (!this.instance && this.video && this.track?.src && this.track !== track) {
					this.ensureInstance();
				}
			});
	}

	private setInstanceTrack(track: TextTrack) {
		const instance = this.instance;
		const src = track.src;
		if (!instance || !src) {
			return;
		}
		const requestId = ++this.trackRequestId;
		this.cancelPendingTrackLoad();
		const trackAbortController = new AbortController();
		this.trackAbortController = trackAbortController;
		void Promise.resolve(instance.ready)
			.then(() =>
				fetchAssRendererTrackContent(src, {
					language: track.language,
					signal: trackAbortController.signal
				})
			)
			.then((content) => {
				if (
					trackAbortController.signal.aborted ||
					this.trackRequestId !== requestId ||
					this.instance !== instance ||
					this.track?.src !== src
				) {
					return;
				}
				if (instance.setTrack) {
					return instance.setTrack(content);
				}
				return instance.setTrackByUrl?.(src);
			})
			.catch((error) => {
				if (!trackAbortController.signal.aborted) {
					console.warn('Unable to start ASS subtitle track', error);
				}
			})
			.finally(() => {
				if (this.trackAbortController === trackAbortController) {
					this.trackAbortController = null;
				}
			});
	}

	private cancelPendingTrackLoad() {
		this.trackAbortController?.abort();
		this.trackAbortController = null;
	}

	private freeTrack() {
		this.trackRequestId++;
		this.cancelPendingTrackLoad();
		try {
			this.instance?.freeTrack();
		} catch {
			// JASSUB may already be between canvas/worker states during a track change.
		}
	}

	private disposeInstance() {
		const instance = this.instance;
		if (!instance) {
			return;
		}
		this.instance = null;
		this.trackRequestId++;
		this.cancelPendingTrackLoad();
		try {
			instance.freeTrack();
		} catch {
			// JASSUB may already be between canvas/worker states during teardown.
		}
		try {
			void Promise.resolve(instance.destroy?.()).catch(() => undefined);
		} catch {
			// JASSUB may already be half-torn-down after a fast media switch.
		}
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

function getSafePlayerCanPictureInPicture(player: MediaPlayerInstance | null) {
	const videoElement = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	if (canUseNativePictureInPicture(videoElement)) {
		return true;
	}
	if (!player) {
		return false;
	}
	try {
		return player.state.canPictureInPicture === true;
	} catch {
		return false;
	}
}

function getSafePlayerPictureInPicture(player: MediaPlayerInstance | null) {
	const videoElement = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	if (isNativePictureInPictureActive(videoElement)) {
		return true;
	}
	if (!player) {
		return false;
	}
	try {
		return player.state.pictureInPicture === true;
	} catch {
		return false;
	}
}

function getSafePlayerDuration(player: MediaPlayerInstance | null) {
	if (!player) {
		return null;
	}
	try {
		const duration = player.duration;
		return Number.isFinite(duration) && duration > 0 ? duration : null;
	} catch {
		return null;
	}
}

function getSafePlayerPlaybackRate(player: MediaPlayerInstance | null) {
	if (!player) {
		return 1;
	}
	try {
		const playbackRate = player.playbackRate;
		return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
	} catch {
		return 1;
	}
}

function setSafePlayerAutoPictureInPicture(player: MediaPlayerInstance | null, enabled: boolean) {
	const videoElement = getPlayerVideoElement(player) as SparklePictureInPictureVideoElement | null;
	prepareVideoElementForBackgroundPlayback(videoElement);
	if (!videoElement || !('autoPictureInPicture' in videoElement)) {
		return false;
	}

	try {
		videoElement.autoPictureInPicture = enabled;
		return videoElement.autoPictureInPicture === enabled;
	} catch {
		return false;
	}
}

function updateAutoPictureInPicturePreference(
	player: MediaPlayerInstance | null,
	playing = getSafePlayerPaused(player) === false
) {
	return setSafePlayerAutoPictureInPicture(
		player,
		playing && getSafePlayerCanPictureInPicture(player)
	);
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

function getSparkleMediaSession() {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
		return null;
	}
	return navigator.mediaSession;
}

function setSparkleMediaSessionActionHandler(
	mediaSession: MediaSession,
	action: SparkleMediaSessionAction,
	handler: MediaSessionActionHandler | null
) {
	try {
		mediaSession.setActionHandler(action as MediaSessionAction, handler);
	} catch {
		// Browsers can expose Media Session while omitting individual actions.
	}
}

function clearSparkleMediaSessionActionHandlers(mediaSession: MediaSession) {
	for (const action of mediaSessionActions) {
		setSparkleMediaSessionActionHandler(mediaSession, action, null);
	}
}

function updateSparkleMediaSessionPlaybackState(
	mediaSession: MediaSession,
	player: MediaPlayerInstance | null
) {
	const paused = getSafePlayerPaused(player);

	try {
		mediaSession.playbackState = paused === false ? 'playing' : paused === true ? 'paused' : 'none';
	} catch {
		// Playback state is advisory; player controls should keep working if this fails.
	}
}

function updateSparkleMediaSessionPositionState(
	mediaSession: MediaSession,
	player: MediaPlayerInstance | null
) {
	if (!mediaSession.setPositionState) {
		return;
	}

	const position = getSafePlayerCurrentTime(player);
	const duration = getSafePlayerDuration(player);
	if (position === null || duration === null) {
		return;
	}

	try {
		mediaSession.setPositionState({
			duration,
			playbackRate: getSafePlayerPlaybackRate(player),
			position: clampNumber(position, 0, duration)
		});
	} catch {
		// Some platforms reject position state during provider teardown.
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

type PendingAudioSwitchPlayback = {
	audio: string;
	time: number;
	paused: boolean;
};

function useLatestRef<T>(value: T) {
	const ref = useRef(value);
	useLayoutEffect(() => {
		ref.current = value;
	});
	return ref;
}

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
	const wordleSocketRef = useRef<WebSocket | null>(null);
	const pendingWordleStateRef = useRef<WordleSyncState | null>(null);
	const pendingMediaSwitchRef = useRef<string | null>(null);
	const youtubeStateRef = useRef<YouTubeSyncState>(DEFAULT_YOUTUBE_SYNC_STATE);
	const youtubeStateStorageKeyRef = useRef('');
	const chessStateRef = useRef<ChessSyncState>(DEFAULT_CHESS_SYNC_STATE);
	const chessStateStorageKeyRef = useRef('');
	const wordleStateRef = useRef<WordleSyncState>(DEFAULT_WORDLE_SYNC_STATE);
	const wordleStateStorageKeyRef = useRef('');
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
	const subtitlesManuallyDisabledRef = useRef(false);
	const mergedSubtitleTrackRef = useRef<MergedSubtitleTrackState | null>(null);
	const mergedSubtitleRequestIdRef = useRef(0);
	const prevTrackSrcRef = useRef<string | null>('');
	const lastTickedRef = useRef(0);
	const roomPlayersCountRef = useRef(0);
	const roomPlayersRef = useRef<RoomPlayer[]>([]);
	const lastSentTimeRef = useRef(-100);
	const suppressNextPlaybackSyncRef = useRef(false);
	const awaitingInitialPlaybackSyncRef = useRef(false);
	const pendingRemotePlaybackSyncRef = useRef<PendingRemotePlaybackSync | null>(null);
	const pendingAudioSwitchPlaybackRef = useRef<PendingAudioSwitchPlayback | null>(null);
	const audioSwitchPlaybackRestoringRef = useRef(false);
	const inBgRef = useRef(false);
	const exitedRef = useRef(false);
	const interactedRef = useRef(interacted);
	const playerCanPlayRef = useRef(false);
	const controlsShowingRef = useRef(false);
	const chatFocusedSecsRef = useRef(0);
	const volumeInitializedRef = useRef(false);
	const volumeRestoringRef = useRef(false);
	const volumeCanPlayRestoredRef = useRef(false);
	const autoPictureInPictureRequestIdRef = useRef(0);
	const autoPictureInPicturePendingRef = useRef(false);
	const autoPictureInPictureExitPendingRef = useRef(false);
	const shouldExitAutoPictureInPictureRef = useRef(false);
	const playbackSyncSuppressionTimerRef = useRef<number | null>(null);
	const onRoomMediaChangedRef = useLatestRef(onRoomMediaChanged);
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
	const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
	const [selectedSubtitleTrack, setSelectedSubtitleTrackState] =
		useState<SelectedSubtitleTrack | null>(null);
	const [extraSubtitleLayerSrcs, setExtraSubtitleLayerSrcs] = useState<string[]>([]);
	const [supportedCodecs, setSupportedCodecs] = useState<string[]>([]);
	const [copiedRoomLink, setCopiedRoomLink] = useState(false);
	const [exited, setExited] = useState(false);
	const [moveToast, setMoveToast] = useState<MoveToastState | null>(null);
	const [audioRemountKey, setAudioRemountKey] = useState(0);
	const [name, setName] = useState('');
	const [profileNameDraft, setProfileNameDraft] = useState('');
	const [profileId, setProfileId] = useState('');
	const [playerId, setPlayerId] = useState('');
	const [controlsChatPickerOpen, setControlsChatPickerOpen] = useState(false);
	const lastSavedNameRef = useRef('');
	const nameInitializedRef = useRef(false);
	const profileSettingsOpenRef = useRef(false);
	const [initialVolume] = useState(() =>
		normalizePlayerVolume(setGetLsNumber(PLAYER_VOLUME_STORAGE_KEY, DEFAULT_PLAYER_VOLUME))
	);
	const controlsShowing = useMediaState('controlsVisible', playerElementRef);
	const playerCanPlay = useMediaState('canPlay', playerElementRef);
	const playerPaused = useMediaState('paused', playerElementRef);
	const playerWidth = useMediaState('width', playerElementRef);
	const playerHeight = useMediaState('height', playerElementRef);
	const floatingTabsTranslucent = playerPaused === false;
	const playerSmallLayout = isSmallPlayerLayout(playerWidth, playerHeight);
	const [playerVolume, setPlayerVolume] = useState(initialVolume);
	const [playerMuted, setPlayerMuted] = useState(initialVolume === 0);
	const [renderNow, setRenderNow] = useState(0);
	const staticBaseUrl = data.staticBaseUrl;
	const backendBaseUrl = data.backendBaseUrl;
	const BASE_STATIC = `${staticBaseUrl}/${job.Id}`;
	const assRendererConfig = useMemo<JASSUBRendererConfig>(() => {
		const availableFonts: Record<string, string> = {};
		const latinFontUrl = getPublicAssetUrl(ASS_DEFAULT_LATIN_FONT_FILE);
		const arabicFontUrl = getPublicAssetUrl(ASS_ARABIC_FONT_FILE);

		availableFonts[ASS_DEFAULT_LATIN_FONT.toLowerCase()] = latinFontUrl;
		for (const family of ASS_ARABIC_FONT_ALIASES) {
			availableFonts[family.toLowerCase()] = arabicFontUrl;
		}
		for (const { family, filename } of ASS_SCRIPT_FALLBACK_FONTS) {
			availableFonts[family.toLowerCase()] = getPublicAssetUrl(filename);
		}

		for (const [family, filename] of [defaultFallback, ...Object.values(fallbackFontsMap)]) {
			if (!family || !filename) {
				continue;
			}
			const fontUrl = getPublicAssetUrl(filename);
			availableFonts[family.toLowerCase()] = fontUrl;
		}

		const fallbackFontUrls = Object.values(availableFonts);
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
			libassMemoryLimit: ASS_BITMAP_CACHE_LIMIT_MB,
			libassGlyphLimit: ASS_GLYPH_CACHE_LIMIT_MB,
			fallbackFont: ASS_MISSING_GLYPH_FALLBACK_FONT.toLowerCase(),
			availableFonts,
			fonts: Array.from(new Set([...fallbackFontUrls, ...attachmentFonts])),
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
	const mediaSessionTitle = getMediaSessionTitle(data);
	const mediaSessionArtist = getMediaSessionArtist(data);
	const mediaSessionAlbum = job.Title.episode?.se || 'Sparkle';
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
	const wordleRoomId = room;
	const wordleSyncRoom = `wordle:${wordleRoomId}`;
	const wordleStateStorageKey = `sparkle:wordle-sync-state:${wordleRoomId}`;
	const [wordleState, setWordleState] = useState<WordleSyncState>(DEFAULT_WORDLE_SYNC_STATE);

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
	const currentWordlePlayer = currentChessPlayer;
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
					await onRoomMediaChangedRef.current?.(record.mediaId, record.mediaUpdated);
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
	}, [backendBaseUrl, job.Id, onRoomMediaChangedRef, room, router]);

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

	const playSoundEffect = useCallback(
		async (id: string | undefined, playerId: string | undefined) => {
			if (!id) {
				return;
			}

			const { getSoundEffect } = await import('@/lib/player/sound-effects');
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
		},
		[]
	);
	const playSoundEffectRef = useLatestRef(playSoundEffect);
	const pulseSoundEffectBadgeRef = useLatestRef(pulseSoundEffectBadge);
	const clearMergedSubtitleTrack = useCallback(
		(restoreMode: 'disabled' | 'none' | 'showing' = 'disabled') => {
			mergedSubtitleRequestIdRef.current++;
			const mergedTrack = mergedSubtitleTrackRef.current;
			mergedSubtitleTrackRef.current = null;
			if (!mergedTrack) {
				return;
			}

			const textTracks = playerElementRef.current?.textTracks;
			if (restoreMode === 'none' || !textTracks) {
				if (textTracks) {
					removePlayerTextTrack(textTracks, mergedTrack.track);
					const lingeringMergedTrack = toArray(textTracks).find(
						(track) => track?.src === mergedTrack.objectUrl
					);
					removePlayerTextTrack(textTracks, lingeringMergedTrack);
				}
				URL.revokeObjectURL(mergedTrack.objectUrl);
				return;
			}
			restoreSubtitleTextTrackOrder(textTracks, subtitleTracksRef.current, {
				restoreMode,
				restoreSrc: mergedTrack.primarySrc
			});
			URL.revokeObjectURL(mergedTrack.objectUrl);
		},
		[]
	);
	const updateSelectedSubtitleTrack = useCallback((track: SelectedSubtitleTrack | null) => {
		const currentTrack = selectedSubtitleTrackRef.current;
		const sameTrack =
			currentTrack?.src === track?.src &&
			currentTrack?.label === track?.label &&
			currentTrack?.language === track?.language &&
			currentTrack?.format === track?.format;
		selectedSubtitleTrackRef.current = track;
		setSelectedSubtitleTrackState((current) =>
			current?.src === track?.src &&
			current?.label === track?.label &&
			current?.language === track?.language &&
			current?.format === track?.format
				? current
				: track
		);
		if (sameTrack) {
			return;
		}
		if (!track) {
			setExtraSubtitleLayerSrcs((current) => (current.length === 0 ? current : []));
			return;
		}
		setExtraSubtitleLayerSrcs((current) => {
			const next = getStoredSubtitleLayerSrcs(subtitleTracksRef.current, track);
			return areStringArraysEqual(next, current) ? current : next;
		});
	}, []);
	const applySubtitleTrackSelection = useCallback(
		(primaryTrack: SubtitleTrackInfo | null, layerTracks: SubtitleTrackInfo[] = []) => {
			if (!primaryTrack) {
				subtitlesManuallyDisabledRef.current = true;
				clearMergedSubtitleTrack('disabled');
				disablePlayerSubtitleTextTracks(playerElementRef.current, subtitleTracksRef.current);
				saveStoredSubtitleSelectionOff();
				updateSelectedSubtitleTrack(null);
				return;
			}

			subtitlesManuallyDisabledRef.current = false;
			const selectedTrack: SelectedSubtitleTrack = { ...primaryTrack, mode: 'showing' };
			const nextLayerSrcs = isStackableSubtitleFormat(primaryTrack.format)
				? sanitizeSubtitleLayerSelection(
						layerTracks.map((track) => track.src),
						subtitleTracksRef.current,
						selectedTrack
					)
				: [];
			if (isStackableSubtitleFormat(primaryTrack.format)) {
				saveStoredSubtitleLayerSelections(
					primaryTrack.format,
					getSubtitleLayerTracks(nextLayerSrcs, subtitleTracksRef.current)
				);
			}
			saveStoredSubtitleSelection(selectedTrack);
			showPlayerSubtitleTextTrack(
				playerElementRef.current,
				subtitleTracksRef.current,
				selectedTrack
			);
			updateSelectedSubtitleTrack(selectedTrack);
			setExtraSubtitleLayerSrcs((current) =>
				areStringArraysEqual(nextLayerSrcs, current) ? current : nextLayerSrcs
			);
		},
		[clearMergedSubtitleTrack, updateSelectedSubtitleTrack]
	);

	const changeSubtitleFormat = useCallback(
		(format: SubtitleTrackFormat | 'off') => {
			if (format === 'off') {
				applySubtitleTrackSelection(null);
				return;
			}

			const tracks = subtitleTracksRef.current;
			const storedSelection = getStoredSubtitleSelection();
			const primaryTrack = pickSubtitleTrackForFormat(
				tracks,
				format,
				isStoredSubtitleSelectionDisabled(storedSelection) ? null : storedSelection
			);
			if (!primaryTrack) {
				applySubtitleTrackSelection(null);
				return;
			}
			const selectedTrack: SelectedSubtitleTrack = { ...primaryTrack, mode: 'showing' };
			const layerTracks = getSubtitleLayerTracks(
				getStoredSubtitleLayerSrcs(tracks, selectedTrack),
				tracks
			);
			applySubtitleTrackSelection(primaryTrack, layerTracks);
		},
		[applySubtitleTrackSelection]
	);

	const toggleSubtitleTrack = useCallback(
		(track: SubtitleTrackInfo, checked: boolean) => {
			const selectedTrack = selectedSubtitleTrackRef.current;
			const currentLayerTracks = getSubtitleLayerTracks(
				extraSubtitleLayerSrcs,
				subtitleTracksRef.current
			).filter((layerTrack) => layerTrack.format === track.format);

			if (checked) {
				if (!selectedTrack || selectedTrack.format !== track.format) {
					applySubtitleTrackSelection(track);
					return;
				}
				if (selectedTrack.src === track.src) {
					return;
				}
				if (!isStackableSubtitleFormat(track.format)) {
					applySubtitleTrackSelection(track);
					return;
				}
				applySubtitleTrackSelection(
					subtitleTracksRef.current.find((candidate) => candidate.src === selectedTrack.src) ??
						track,
					[...currentLayerTracks, track]
				);
				return;
			}

			if (!selectedTrack || selectedTrack.format !== track.format) {
				return;
			}
			if (selectedTrack.src === track.src) {
				if (!isStackableSubtitleFormat(track.format) || currentLayerTracks.length === 0) {
					applySubtitleTrackSelection(null);
					return;
				}
				const [nextPrimaryTrack, ...nextLayerTracks] = currentLayerTracks;
				applySubtitleTrackSelection(nextPrimaryTrack, nextLayerTracks);
				return;
			}
			applySubtitleTrackSelection(
				subtitleTracksRef.current.find((candidate) => candidate.src === selectedTrack.src) ?? null,
				currentLayerTracks.filter((layerTrack) => layerTrack.src !== track.src)
			);
		},
		[applySubtitleTrackSelection, extraSubtitleLayerSrcs]
	);

	useEffect(() => {
		const selectedTrack = selectedSubtitleTrackRef.current;
		if (!selectedTrack) {
			return;
		}
		setExtraSubtitleLayerSrcs((current) => {
			const currentSanitized = sanitizeSubtitleLayerSelection(
				current,
				subtitleTracksRef.current,
				selectedTrack
			);
			if (areStringArraysEqual(currentSanitized, current)) {
				return current;
			}
			const next = getStoredSubtitleLayerSrcs(subtitleTracksRef.current, selectedTrack);
			return areStringArraysEqual(next, currentSanitized) ? currentSanitized : next;
		});
	}, [subtitleTracks]);

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
			if (nameInitializedRef.current) {
				return;
			}
			nameInitializedRef.current = true;
			const stored = window.localStorage.getItem('name');
			const generatedName = window.localStorage.getItem(GENERATED_NAME_STORAGE_KEY);
			if (stored === '') {
				lastSavedNameRef.current = stored;
				setName(stored);
				return;
			}
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
	}, [discordUser]);

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
			let nextProfileId = storedId ?? '';
			if (storedId) {
				setProfileId(storedId);
			} else {
				nextProfileId = randomString(14);
				window.localStorage.setItem('id', nextProfileId);
				setProfileId(nextProfileId);
			}

			setPlayerId(getSessionPlayerId(room, nextProfileId));
		}, 0);
		return () => window.clearTimeout(timer);
	}, [discordUserId, room]);

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
		if (!profileId || socketRef.current?.readyState !== WebSocket.OPEN) {
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

	const sendSettings = useCallback(
		(options: { includeAudio?: boolean } = {}) => {
			const selectedTrack = subtitlesManuallyDisabledRef.current
				? null
				: getSelectedSubtitleTrack(
						playerEl,
						getPlayerVideoElement(playerEl),
						subtitleTracksRef.current,
						selectedSubtitleTrackRef.current
					);
			send({
				type: SyncTypes.SubtitleSwitch,
				subtitle: selectedTrack?.src
			});
			if (options.includeAudio !== false) {
				send({
					type: SyncTypes.AudioSwitch,
					audio: effectiveAudio
				});
			}
			send({
				type: SyncTypes.CodecSwitch,
				codec: `${selectedCodec},${videoSrc?.sCodec}`
			});
		},
		[effectiveAudio, playerEl, send, selectedCodec, videoSrc?.sCodec]
	);

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
		let cancelled = false;
		let animationFrame: number | null = null;
		let attempts = 0;
		const loadProvider = () => {
			if (cancelled) {
				return;
			}
			try {
				playerEl.startLoading();
			} catch {
				// The player may already be loading while a source switch is in flight.
			}
			const videoElement = getPlayerVideoElement(playerEl);
			if (videoElement) {
				prepareVideoElementForBackgroundPlayback(
					videoElement as SparklePictureInPictureVideoElement
				);
				mediaProviderEl.load(videoElement);
			}
			const needsRetry =
				videoElement && !videoElement.currentSrc && videoElement.readyState === 0 && attempts < 30;
			if (needsRetry) {
				attempts += 1;
				animationFrame = window.requestAnimationFrame(loadProvider);
			}
		};
		animationFrame = window.requestAnimationFrame(loadProvider);
		return () => {
			cancelled = true;
			if (animationFrame !== null) {
				window.cancelAnimationFrame(animationFrame);
			}
		};
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
			const current = youtubeStateRef.current;
			const timestamp = nextTabbedSyncUpdatedAt(current);
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
				const nextState = mergeTabbedSyncStates(
					current,
					incoming,
					normalizeYouTubeSyncState,
					MAX_YOUTUBE_TABS
				);
				const shouldRepairIncoming = !areTabbedSyncStatesEqual(nextState, incoming);
				if (areTabbedSyncStatesEqual(nextState, current)) {
					if (shouldRepairIncoming) {
						sendYouTubeSnapshot(nextState, false);
					}
					return;
				}
				applyYouTubeState(nextState);
				if (shouldRepairIncoming) {
					sendYouTubeSnapshot(nextState, false);
				}
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
			const current = chessStateRef.current;
			const timestamp = nextTabbedSyncUpdatedAt(current);
			const existingTab =
				current.tabs.find((tab) => tab.id === tabId) ??
				createDefaultChessTab(tabId, currentChessPlayer);
			const nextTab = normalizeChessTabSyncState(
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
			const nextTabs =
				patch.open === false
					? [
							...current.tabs.filter((tab) => tab.id !== tabId),
							{ ...nextTab, open: false, closeRequest: null }
						]
					: [...current.tabs.filter((tab) => tab.id !== tabId), nextTab];
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
				const nextState = mergeTabbedSyncStates(
					current,
					incoming,
					normalizeChessSyncState,
					MAX_CHESS_TABS
				);
				const shouldRepairIncoming = !areTabbedSyncStatesEqual(nextState, incoming);
				if (areTabbedSyncStatesEqual(nextState, current)) {
					if (shouldRepairIncoming) {
						sendChessSnapshot(nextState, false);
					}
					return;
				}
				applyChessState(nextState);
				if (shouldRepairIncoming) {
					sendChessSnapshot(nextState, false);
				}
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

	const applyWordleState = useCallback((nextState: WordleSyncState) => {
		const normalized = normalizeWordleSyncState(nextState);
		wordleStateRef.current = normalized;
		setWordleState(normalized);
		saveStoredWordleSyncState(wordleStateStorageKeyRef.current, normalized);
	}, []);

	const sendWordleSnapshot = useCallback((nextState: WordleSyncState, queue = true) => {
		const socket = wordleSocketRef.current;
		if (queue) {
			pendingWordleStateRef.current = nextState;
		}
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(
			JSON.stringify({
				type: SyncTypes.WordleSync,
				wordle: nextState
			})
		);
		if (pendingWordleStateRef.current === nextState) {
			pendingWordleStateRef.current = null;
		}
	}, []);

	const updateWordleState = useCallback(
		(tabId: string, patch: Partial<WordleTabSyncState>) => {
			const current = wordleStateRef.current;
			const timestamp = nextTabbedSyncUpdatedAt(current);
			const existingTab =
				current.tabs.find((tab) => tab.id === tabId) ??
				createDefaultWordleTab(tabId, currentWordlePlayer);
			const nextTab = normalizeWordleTabSyncState(
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
			const nextTabs =
				patch.open === false
					? [...current.tabs.filter((tab) => tab.id !== tabId), { ...nextTab, open: false }]
					: [...current.tabs.filter((tab) => tab.id !== tabId), nextTab];
			const nextState = normalizeWordleSyncState({
				tabs: nextTabs.slice(-MAX_WORDLE_TABS),
				updatedAt: timestamp
			});
			applyWordleState(nextState);
			sendWordleSnapshot(nextState);
		},
		[applyWordleState, currentWordlePlayer, sendWordleSnapshot]
	);

	const openNewWordleTab = useCallback(() => {
		if (!socketConnected || !currentWordlePlayer) {
			return;
		}
		const id = randomString(10);
		updateWordleState(id, createDefaultWordleTab(id, currentWordlePlayer));
	}, [currentWordlePlayer, socketConnected, updateWordleState]);

	useEffect(() => {
		wordleStateStorageKeyRef.current = wordleStateStorageKey;
		const stored = readStoredWordleSyncState(wordleStateStorageKey);
		const timer = window.setTimeout(() => {
			applyWordleState(stored);
			pendingWordleStateRef.current = null;
		}, 0);
		return () => window.clearTimeout(timer);
	}, [applyWordleState, wordleStateStorageKey]);

	useEffect(() => {
		if (!playerId || !socketConnected) {
			return;
		}

		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;
		let disposed = false;
		const playerWordleId = `${playerId}-wordle`;
		const socketUrl = getBackendWebSocketUrl(
			backendBaseUrl,
			`/sync/${encodeURIComponent(wordleSyncRoom)}/${encodeURIComponent(playerWordleId)}`
		);

		const clearReconnectTimer = () => {
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const connectWordleSocket = () => {
			if (disposed) {
				return;
			}
			const existingSocket = wordleSocketRef.current;
			if (
				existingSocket &&
				(existingSocket.readyState === WebSocket.CONNECTING ||
					existingSocket.readyState === WebSocket.OPEN)
			) {
				return;
			}
			clearReconnectTimer();
			const socket = new WebSocket(socketUrl);
			wordleSocketRef.current = socket;

			socket.onopen = () => {
				if (wordleSocketRef.current !== socket) {
					socket.close();
					return;
				}
				reconnectAttempt = 0;
				const pendingState = pendingWordleStateRef.current;
				if (pendingState) {
					socket.send(JSON.stringify({ type: SyncTypes.WordleSync, wordle: pendingState }));
					pendingWordleStateRef.current = null;
				}
				socket.send(JSON.stringify({ type: SyncTypes.NewPlayer }));
			};

			socket.onmessage = (event: MessageEvent) => {
				if (wordleSocketRef.current !== socket) {
					return;
				}
				const payload: SendPayload = JSON.parse(event.data);
				if (payload.type !== SyncTypes.WordleSync || !payload.wordle) {
					return;
				}
				const incoming = normalizeWordleSyncState(payload.wordle);
				const current = wordleStateRef.current;
				if (incoming.updatedAt === 0 && isMeaningfulWordleState(current)) {
					sendWordleSnapshot(current, false);
					return;
				}
				const nextState = mergeTabbedSyncStates(
					current,
					incoming,
					normalizeWordleSyncState,
					MAX_WORDLE_TABS
				);
				const shouldRepairIncoming = !areTabbedSyncStatesEqual(nextState, incoming);
				if (areTabbedSyncStatesEqual(nextState, current)) {
					if (shouldRepairIncoming) {
						sendWordleSnapshot(nextState, false);
					}
					return;
				}
				applyWordleState(nextState);
				if (shouldRepairIncoming) {
					sendWordleSnapshot(nextState, false);
				}
			};

			socket.onerror = () => {
				if (wordleSocketRef.current === socket) {
					socket.close();
				}
			};

			socket.onclose = () => {
				if (wordleSocketRef.current !== socket) {
					return;
				}
				wordleSocketRef.current = null;
				if (disposed) {
					return;
				}
				const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
				reconnectAttempt += 1;
				reconnectTimer = window.setTimeout(() => {
					reconnectTimer = null;
					connectWordleSocket();
				}, delay);
			};
		};

		connectWordleSocket();

		return () => {
			disposed = true;
			clearReconnectTimer();
			const socket = wordleSocketRef.current;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				if (socket.readyState !== WebSocket.CLOSED) {
					socket.close();
				}
			}
			if (wordleSocketRef.current === socket) {
				wordleSocketRef.current = null;
			}
		};
	}, [
		applyWordleState,
		backendBaseUrl,
		playerId,
		sendWordleSnapshot,
		socketConnected,
		wordleSyncRoom
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
	const handleVoiceBroadcastRef = useLatestRef(handleVoiceBroadcast);
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

		const assRenderer = new ManagedLibASSTextRenderer(loadAssRendererModule, assRendererConfig);
		playerEl.textRenderers.add(assRenderer);

		return () => {
			playerEl.textRenderers.remove(assRenderer);
			assRenderer.detach();
		};
	}, [assRendererConfig, playerEl]);

	useLayoutEffect(() => {
		if (!playerEl) {
			return;
		}

		const selectedTrack = selectedSubtitleTrack;
		const currentMergedTrack = mergedSubtitleTrackRef.current;
		if (currentMergedTrack && currentMergedTrack.primarySrc !== selectedTrack?.src) {
			clearMergedSubtitleTrack('disabled');
		}

		if (!selectedTrack) {
			clearMergedSubtitleTrack('disabled');
			return;
		}

		const stackableTracks = getStackableSubtitleTracks(subtitleTracks, selectedTrack);
		const primaryTrack = stackableTracks.find((track) => track.src === selectedTrack.src);
		const companionTracks = extraSubtitleLayerSrcs
			.map((src) => stackableTracks.find((track) => track.src === src) ?? null)
			.filter((track): track is SubtitleTrackInfo => Boolean(track));
		const mergeTracks = primaryTrack ? [primaryTrack, ...companionTracks] : [];
		const mergeFormat = primaryTrack?.format;
		if (
			!primaryTrack ||
			companionTracks.length === 0 ||
			(mergeFormat !== 'ass' && mergeFormat !== 'vtt')
		) {
			clearMergedSubtitleTrack('showing');
			return;
		}

		const signature = getMergedSubtitleSignature(mergeTracks);
		if (mergedSubtitleTrackRef.current?.signature === signature) {
			return;
		}

		const textTracks = playerEl.textTracks;
		if (!textTracks?.add) {
			return;
		}

		const requestId = ++mergedSubtitleRequestIdRef.current;
		const abortController = new AbortController();

		void buildMergedSubtitleContent(mergeTracks, abortController.signal)
			.then((content) => {
				if (
					abortController.signal.aborted ||
					mergedSubtitleRequestIdRef.current !== requestId ||
					!content
				) {
					return;
				}

				const objectUrl = URL.createObjectURL(
					new Blob([content], { type: getSubtitleBlobMimeType(mergeFormat) })
				);
				const previousMergedTrack = mergedSubtitleTrackRef.current;
				if (previousMergedTrack) {
					removePlayerTextTrack(textTracks, previousMergedTrack.track);
					URL.revokeObjectURL(previousMergedTrack.objectUrl);
				}

				const mergedTextTrack = createSubtitleTextTrack(primaryTrack, {
					default: false,
					id: primaryTrack.src,
					src: objectUrl,
					type: mergeFormat
				});
				restoreSubtitleTextTrackOrder(textTracks, subtitleTracks, {
					replacement: {
						mode: 'showing',
						primarySrc: primaryTrack.src,
						textTrack: mergedTextTrack
					}
				});
				mergedSubtitleTrackRef.current = {
					format: mergeFormat,
					objectUrl,
					primarySrc: primaryTrack.src,
					signature,
					track: mergedTextTrack
				};
			})
			.catch((error) => {
				if (!abortController.signal.aborted) {
					console.warn('Unable to merge subtitle layers', error);
					clearMergedSubtitleTrack('showing');
				}
			});

		return () => {
			abortController.abort();
		};
	}, [
		clearMergedSubtitleTrack,
		extraSubtitleLayerSrcs,
		playerEl,
		selectedSubtitleTrack,
		subtitleTracks
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
			clearMergedSubtitleTrack('none');
			if (typeof textTracks.clear === 'function') {
				textTracks.clear();
			}
			const subtitleTracks: SubtitleTrackInfo[] = [];
			updateSelectedSubtitleTrack(null);
			setSubtitleTracks([]);
			prevTrackSrcRef.current = '';
			let defaultSubtitleTextTrack: any = null;
			if (job.Streams) {
				const sortedJob = { ...job, Streams: [...job.Streams] };
				sortedJob.Streams = sortTracks(sortedJob);
				const subtitleStreams = sortedJob.Streams.filter(
					(stream) => stream.CodecType === 'subtitle'
				).sort((a, b) => compareSubtitleStreams(a, b, job.Files));
				const storedSubtitleSelection = getStoredSubtitleSelection();
				subtitlesManuallyDisabledRef.current =
					isStoredSubtitleSelectionDisabled(storedSubtitleSelection);
				const defaultSubtitleStream = pickPrioritySubtitleStream(
					subtitleStreams,
					storedSubtitleSelection
				);
				for (const stream of subtitleStreams) {
					const cueForgeSubtitle = getCueForgeSubtitleInfo(stream);
					const src = `${BASE_STATIC}/${stream.Location}`;
					const format = getSubtitleFormat(src);
					const track: SubtitleTrackInfo = {
						annotated: Boolean(cueForgeSubtitle?.annotated),
						cueForge: Boolean(cueForgeSubtitle),
						src,
						label: formatSubtitlePair(stream, true),
						settingsLabel: '',
						kind: 'subtitles',
						type: format,
						language: getSubtitleLanguage(stream),
						default: stream === defaultSubtitleStream,
						format,
						style: getSubtitleSelectionStyle(format)
					};
					subtitleTracks.push(track);
					const textTrack = createSubtitleTextTrack(track);
					addUniquePlayerTextTrack(textTracks, textTrack);
					if (track.default) {
						defaultSubtitleTextTrack = textTrack;
					}
				}
			}
			const subtitleTracksWithSettingsLabels = withSubtitleSettingsLabels(subtitleTracks);
			subtitleTracksRef.current = subtitleTracksWithSettingsLabels;
			setSubtitleTracks(subtitleTracksWithSettingsLabels);
			const defaultSubtitleTrack =
				subtitleTracksWithSettingsLabels.find((track) => track.default) ?? null;
			if (defaultSubtitleTrack) {
				subtitlesManuallyDisabledRef.current = false;
				setPlayerTextTrackMode(
					defaultSubtitleTextTrack ??
						findPlayerTextTrackByOriginalSrc(textTracks, defaultSubtitleTrack.src),
					'showing'
				);
				updateSelectedSubtitleTrack({ ...defaultSubtitleTrack, mode: 'showing' });
			}
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
			clearMergedSubtitleTrack('none');
		};
	}, [BASE_STATIC, clearMergedSubtitleTrack, job, playerEl, updateSelectedSubtitleTrack]);

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
		if (pendingAudioSwitchPlaybackRef.current) {
			return;
		}
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

	const updateMediaSessionState = useCallback(() => {
		const mediaSession = getSparkleMediaSession();
		if (!mediaSession) {
			return;
		}
		const player = playerElementRef.current;
		updateSparkleMediaSessionPlaybackState(mediaSession, player);
		updateSparkleMediaSessionPositionState(mediaSession, player);
	}, []);

	useEffect(() => {
		const mediaSession = getSparkleMediaSession();
		if (!mediaSession || !playerSrcUrl) {
			return;
		}

		if (typeof MediaMetadata !== 'undefined') {
			mediaSession.metadata = new MediaMetadata({
				title: mediaSessionTitle,
				artist: mediaSessionArtist,
				album: mediaSessionAlbum,
				artwork: getMediaSessionArtwork(posterSrc)
			});
		}

		const play = () => {
			const player = playerElementRef.current;
			if (!player) {
				return;
			}
			Promise.resolve(player.play())
				.then(updateMediaSessionState)
				.catch((error) => {
					console.warn('Unable to play from media session', error);
				});
		};

		const pause = () => {
			const player = playerElementRef.current;
			if (!player) {
				return;
			}
			Promise.resolve(player.pause())
				.then(updateMediaSessionState)
				.catch((error) => {
					console.warn('Unable to pause from media session', error);
				});
		};

		const seekToTime = (time: number) => {
			const player = playerElementRef.current;
			if (!player) {
				return;
			}

			const duration = getSafePlayerDuration(player);
			const targetTime = duration
				? clampNumber(time, 0, duration)
				: Math.max(0, Number.isFinite(time) ? time : 0);

			if (setSafePlayerCurrentTime(player, targetTime)) {
				updateTime();
				updateMediaSessionState();
			}
		};

		const seekBy = (offset: number) => {
			const player = playerElementRef.current;
			const currentTime = getSafePlayerCurrentTime(player);
			if (currentTime === null) {
				return;
			}
			seekToTime(currentTime + offset);
		};

		const enterPictureInPicture = () => {
			const player = playerElementRef.current;
			if (
				!player ||
				getSafePlayerPaused(player) !== false ||
				getSafePlayerPictureInPicture(player)
			) {
				return;
			}

			Promise.resolve(enterPlayerPictureInPicture(player))
				.then(updateMediaSessionState)
				.catch(() => undefined);
		};

		setSparkleMediaSessionActionHandler(mediaSession, 'play', play);
		setSparkleMediaSessionActionHandler(mediaSession, 'pause', pause);
		setSparkleMediaSessionActionHandler(mediaSession, 'seekbackward', (details) => {
			seekBy(-(details.seekOffset || MEDIA_SESSION_SEEK_SECONDS));
		});
		setSparkleMediaSessionActionHandler(mediaSession, 'seekforward', (details) => {
			seekBy(details.seekOffset || MEDIA_SESSION_SEEK_SECONDS);
		});
		setSparkleMediaSessionActionHandler(mediaSession, 'seekto', (details) => {
			if (typeof details.seekTime === 'number') {
				seekToTime(details.seekTime);
			}
		});
		setSparkleMediaSessionActionHandler(mediaSession, 'stop', () => {
			pause();
			seekToTime(0);
		});
		setSparkleMediaSessionActionHandler(
			mediaSession,
			'enterpictureinpicture',
			enterPictureInPicture
		);

		updateMediaSessionState();
		const positionTimer = window.setInterval(updateMediaSessionState, 10_000);

		return () => {
			window.clearInterval(positionTimer);
			clearSparkleMediaSessionActionHandlers(mediaSession);
			try {
				mediaSession.metadata = null;
				mediaSession.playbackState = 'none';
			} catch {
				// Browser session state can be unavailable while a tab is closing.
			}
		};
	}, [
		mediaSessionAlbum,
		mediaSessionArtist,
		mediaSessionTitle,
		playerSrcUrl,
		posterSrc,
		updateMediaSessionState,
		updateTime
	]);

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
		if (pendingAudioSwitchPlaybackRef.current) {
			return false;
		}
		if (audioSwitchPlaybackRestoringRef.current) {
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
	const restorePendingAudioSwitchPlayback = useCallback(() => {
		const pending = pendingAudioSwitchPlaybackRef.current;
		const player = playerElementRef.current;
		if (!pending || !player || pending.audio !== effectiveAudio || !getSafePlayerCanPlay(player)) {
			return;
		}

		audioSwitchPlaybackRestoringRef.current = true;
		const finishAudioSwitchPlaybackRestore = () => {
			window.setTimeout(() => {
				if (pendingAudioSwitchPlaybackRef.current === pending) {
					pendingAudioSwitchPlaybackRef.current = null;
				}
				if (!pendingAudioSwitchPlaybackRef.current) {
					audioSwitchPlaybackRestoringRef.current = false;
				}
				updateAutoPictureInPicturePreference(player, !pending.paused);
				updateMediaSessionState();
			}, 0);
		};
		const time = Math.max(0, pending.time);
		if (time > 0) {
			setSafePlayerCurrentTime(player, time);
		}
		lastSentTimeRef.current = Math.ceil(time);
		setCurrentlyWatching((value) =>
			value ? { ...value, duration: Math.ceil(time), paused: pending.paused } : null
		);

		const currentlyPaused = getSafePlayerPaused(player);
		if (pending.paused) {
			if (currentlyPaused === false) {
				armPlaybackSyncSuppression();
				Promise.resolve(player.pause())
					.catch((error) => {
						clearPlaybackSyncSuppression();
						console.warn('Unable to preserve pause state after audio track switch', error);
					})
					.finally(finishAudioSwitchPlaybackRestore);
			} else {
				finishAudioSwitchPlaybackRestore();
			}
			return;
		}

		if (currentlyPaused !== false) {
			armPlaybackSyncSuppression();
			Promise.resolve(player.play())
				.catch((error) => {
					clearPlaybackSyncSuppression();
					console.warn('Unable to resume after audio track switch', error);
				})
				.finally(finishAudioSwitchPlaybackRestore);
		} else {
			finishAudioSwitchPlaybackRestore();
		}
	}, [
		armPlaybackSyncSuppression,
		clearPlaybackSyncSuppression,
		effectiveAudio,
		setCurrentlyWatching,
		updateMediaSessionState
	]);
	const applyRemotePlaybackSyncRef = useLatestRef(applyRemotePlaybackSync);
	const sendProfileRef = useLatestRef(sendProfile);
	const sendSettingsRef = useLatestRef(sendSettings);
	const updateLastTickedRef = useLatestRef(updateLastTicked);
	const updateSelectedSubtitleTrackRef = useLatestRef(updateSelectedSubtitleTrack);

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
				profileSyncedRef.current = sendProfileRef.current();
				awaitingInitialPlaybackSyncRef.current = true;
				send({ type: SyncTypes.NewPlayer });
				sendSettingsRef.current();
				const pendingMediaID = pendingMediaSwitchRef.current;
				if (pendingMediaID && pendingMediaID !== job.Id) {
					pendingMediaSwitchRef.current = null;
					send({
						type: SyncTypes.BroadcastSync,
						broadcast: { type: BroadcastTypes.MoveTo, moveTo: pendingMediaID }
					});
				}
				updateLastTickedRef.current(true);
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
						void onRoomMediaChangedRef.current?.(target.Id, state.timestamp);
						return;
					}
					setMoveToast({
						seconds: moveSeconds,
						job: target,
						firedBy: state.firedBy,
						timestamp: state.timestamp
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
								if (next !== prev && inBgRef.current && isAudibleChatMessage(state.chat)) {
									notificationAudioRef.current?.play().catch(() => {});
								}
								return next;
							}
							const chats = state.chats ?? [];
							if (
								inBgRef.current &&
								getLatestAudibleChatTimestamp(prev) !== getLatestAudibleChatTimestamp(chats)
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
						updateLastTickedRef.current(true, players.length);
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
						updateLastTickedRef.current(true, playersCount);
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
						updateLastTickedRef.current(true, playersCount);
						break;
					}
					case SyncTypes.PauseSync:
						awaitingInitialPlaybackSyncRef.current = false;
						if (typeof state.paused === 'boolean') {
							applyRemotePlaybackSyncRef.current({ paused: state.paused });
							persistControlState(state);
						}
						break;
					case SyncTypes.TimeSync:
						if (state.time !== undefined) {
							applyRemotePlaybackSyncRef.current({ time: state.time });
							persistControlState(state);
						}
						break;
					case SyncTypes.BroadcastSync:
						switch (broadcast?.type) {
							case BroadcastTypes.MoveTo:
								if (broadcast.moveTo === '') {
									void onRoomMediaChangedRef.current?.('', state.timestamp);
									break;
								}
								mediaSelectionRef.current?.updateList(broadcast.moveTo, (jobs: LibraryJob[]) => {
									initiateMoveTo(jobs);
								});
								break;
							case BroadcastTypes.VoiceSignal:
								void handleVoiceBroadcastRef.current(state.firedBy?.id, broadcast);
								break;
							case BroadcastTypes.SoundEffect:
								playSoundEffectRef.current(
									resolveBroadcastSoundEffectId(broadcast.soundEffect, playerId),
									state.firedBy?.id
								);
								pulseSoundEffectBadgeRef.current(state.firedBy?.id);
								break;
						}
						break;
					case SyncTypes.ExitSync:
						clearReconnectTimer();
						setExited(true);
						exitedRef.current = true;
						setInteracted(false);
						setSocketConnected(false);
						awaitingInitialPlaybackSyncRef.current = false;
						socketRef.current = null;
						socketUrlRef.current = null;
						socket.onopen = null;
						socket.onmessage = null;
						socket.onerror = null;
						socket.onclose = null;
						if (socket.readyState !== WebSocket.CLOSED) {
							socket.close();
						}
						window.location.reload();
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

			socket.onclose = (event) => {
				if (socketRef.current !== socket) {
					return;
				}
				console.log(`Socket closed, ${room}`);
				const intentionallyDisconnected =
					event.code === 1000 && event.reason === 'replaced by a newer connection';
				setSocketConnected(false);
				awaitingInitialPlaybackSyncRef.current = false;
				socketRef.current = null;
				socketUrlRef.current = null;
				if (intentionallyDisconnected) {
					clearReconnectTimer();
					exitedRef.current = true;
					interactedRef.current = false;
					setExited(true);
					setInteracted(false);
					window.location.reload();
					return;
				}
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
			setCurrentlyWatching,
			setInteracted,
			updatePfp,
			applyRemotePlaybackSyncRef,
			handleVoiceBroadcastRef,
			onRoomMediaChangedRef,
			playSoundEffectRef,
			pulseSoundEffectBadgeRef,
			sendProfileRef,
			sendSettingsRef,
			updateLastTickedRef
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
			await onRoomMediaChanged?.(moveToast.job.Id, moveToast.timestamp);
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

	const disconnectRoomPlayer = useCallback(
		(targetId: string) => {
			if (!targetId || targetId === playerId) {
				return;
			}
			send({
				type: SyncTypes.ExitSync,
				targetId
			});
			addSystemMessage('Disconnect request sent.');
		},
		[addSystemMessage, playerId, send]
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
			options: {
				allowClear?: boolean;
				allowDisabledOverride?: boolean;
				storeLanguage?: boolean;
			} = {}
		) => {
			const nextTrack = selectedFromVidstackTrack(track, subtitleTracksRef.current);
			const nextMode = mode ?? track?.mode;
			if (nextTrack && (!nextMode || nextMode === 'showing')) {
				if (subtitlesManuallyDisabledRef.current && !options.allowDisabledOverride) {
					disablePlayerSubtitleTextTracks(playerElementRef.current, subtitleTracksRef.current);
					return;
				}
				subtitlesManuallyDisabledRef.current = false;
				updateSelectedSubtitleTrack(nextTrack);
			} else if (options.allowClear) {
				subtitlesManuallyDisabledRef.current = true;
				updateSelectedSubtitleTrack(null);
			}
			if (options.storeLanguage && selectedSubtitleTrackRef.current) {
				saveStoredSubtitleSelection(selectedSubtitleTrackRef.current);
			}
		};

		const handleTextTrackChange = (event: Event) => {
			setSelectedSubtitleTrack((event as CustomEvent).detail);
		};

		const dedupeCaptionTracks = () => {
			removeDuplicateCaptionTextTracks(playerEl.textTracks);
		};

		const handleTextTrackChangeRequest = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			if (detail?.mode !== 'showing') {
				subtitlesManuallyDisabledRef.current = true;
				disablePlayerSubtitleTextTracks(playerElementRef.current, subtitleTracksRef.current);
				saveStoredSubtitleSelectionOff();
				updateSelectedSubtitleTrack(null);
				return;
			}
			let requestedTrack = null;
			try {
				requestedTrack =
					typeof detail.index === 'number' ? playerEl.textTracks?.[detail.index] : null;
			} catch {
				requestedTrack = null;
			}
			setSelectedSubtitleTrack(requestedTrack, detail.mode, {
				allowClear: true,
				allowDisabledOverride: true,
				storeLanguage: true
			});
		};

		playerEl.addEventListener?.('text-track-change', handleTextTrackChange);
		playerEl.addEventListener?.('media-text-track-change-request', handleTextTrackChangeRequest);
		try {
			dedupeCaptionTracks();
			playerEl.textTracks?.addEventListener?.('add', dedupeCaptionTracks);
			playerEl.textTracks?.addEventListener?.('mode-change', handleTextTrackChange);
			playerEl.textTracks?.addEventListener?.('mode-change', dedupeCaptionTracks);
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
				playerEl.textTracks?.removeEventListener?.('add', dedupeCaptionTracks);
				playerEl.textTracks?.removeEventListener?.('mode-change', handleTextTrackChange);
				playerEl.textTracks?.removeEventListener?.('mode-change', dedupeCaptionTracks);
			} catch {
				// Text tracks can disappear during provider teardown.
			}
		};
	}, [playerEl, updateSelectedSubtitleTrack]);

	useEffect(() => {
		if (!playerEl || !selectedSubtitleTrack) {
			return;
		}
		let cancelled = false;
		const restoreSelectedTrack = async () => {
			for (let attempt = 0; attempt < 8; attempt++) {
				if (
					cancelled ||
					playerElementRef.current !== playerEl ||
					selectedSubtitleTrackRef.current?.src !== selectedSubtitleTrack.src
				) {
					return;
				}
				showPlayerSubtitleTextTrack(playerEl, subtitleTracksRef.current, selectedSubtitleTrack);
				await new Promise((resolve) => window.setTimeout(resolve, attempt < 2 ? 0 : 100));
			}
		};
		void restoreSelectedTrack();
		return () => {
			cancelled = true;
		};
	}, [playerEl, selectedSubtitleTrack, subtitleTracks]);

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
		restorePendingAudioSwitchPlayback();
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
	}, [
		applyRemotePlaybackSync,
		playerCanPlay,
		playerEl,
		restoreInitialVolume,
		restorePendingAudioSwitchPlayback
	]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		updateAutoPictureInPicturePreference(playerEl);

		return () => {
			setSafePlayerAutoPictureInPicture(playerEl, false);
		};
	}, [playerCanPlay, playerEl]);

	useEffect(() => {
		if (!playerEl) {
			return;
		}
		const player = playerEl;

		const enterAutoPictureInPicture = async (trigger?: Event) => {
			if (getSafePlayerPaused(player) !== false || getSafePlayerPictureInPicture(player)) {
				return;
			}

			if (updateAutoPictureInPicturePreference(player, true)) {
				await waitForTimeout(250);
				if (document.hidden && getSafePlayerPictureInPicture(player)) {
					shouldExitAutoPictureInPictureRef.current = true;
					return;
				}
			}

			if (autoPictureInPicturePendingRef.current || !getSafePlayerCanPictureInPicture(player)) {
				return;
			}

			const requestId = ++autoPictureInPictureRequestIdRef.current;
			autoPictureInPicturePendingRef.current = true;
			try {
				const entered = await enterPlayerPictureInPicture(player, trigger);
				if (entered && autoPictureInPictureRequestIdRef.current === requestId && document.hidden) {
					shouldExitAutoPictureInPictureRef.current = true;
				}
				if (autoPictureInPictureRequestIdRef.current !== requestId && !document.hidden) {
					shouldExitAutoPictureInPictureRef.current = false;
					await exitPlayerPictureInPicture(player, trigger);
					await restoreVideoAfterPictureInPicture(player, mediaProviderEl);
				}
			} catch {
				// Auto PiP is browser/permission dependent; playback should continue normally.
			} finally {
				if (autoPictureInPictureRequestIdRef.current === requestId) {
					autoPictureInPicturePendingRef.current = false;
				}
			}
		};

		const exitAutoPictureInPicture = async (trigger?: Event, force = false) => {
			autoPictureInPictureRequestIdRef.current += 1;
			autoPictureInPicturePendingRef.current = false;
			const shouldRestoreAutoPictureInPicture = shouldExitAutoPictureInPictureRef.current;
			const hadPictureInPicture = getSafePlayerPictureInPicture(player);
			shouldExitAutoPictureInPictureRef.current = false;
			if (!force && !shouldRestoreAutoPictureInPicture && !hadPictureInPicture) {
				updateAutoPictureInPicturePreference(player);
				return;
			}
			if (autoPictureInPictureExitPendingRef.current && !force) {
				return;
			}
			autoPictureInPictureExitPendingRef.current = true;

			try {
				if (force || shouldRestoreAutoPictureInPicture || hadPictureInPicture) {
					setSafePlayerAutoPictureInPicture(player, false);
					await exitPlayerPictureInPicture(player, trigger);
				}
			} catch {
				// Returning to the app should never be blocked by PiP cleanup.
			} finally {
				try {
					if (!document.hidden) {
						await restoreVideoAfterPictureInPicture(player, mediaProviderEl);
					}
					updateAutoPictureInPicturePreference(player);
				} finally {
					autoPictureInPictureExitPendingRef.current = false;
				}
			}
		};

		const handleForeground = (event?: Event) => {
			inBgRef.current = false;
			void exitAutoPictureInPicture(event, true);
		};

		const handleBackground = (event?: Event) => {
			inBgRef.current = true;
			void enterAutoPictureInPicture(event);
		};

		const visibilityChange = (event: Event) => {
			const paused = getSafePlayerPaused(player);
			if (document.hidden) {
				send({ state: 'bg', type: SyncTypes.StateSync, paused: paused ?? true });
				inBgRef.current = true;
				handleBackground(event);
			} else {
				handleForeground(event);
				void refreshRoomMedia();
				send({ state: 'fg', type: SyncTypes.StateSync, paused: paused ?? true });
				inBgRef.current = false;
			}
		};
		document.addEventListener('visibilitychange', visibilityChange);
		const pageHide = (event: PageTransitionEvent) => {
			handleBackground(event);
		};
		window.addEventListener('pagehide', pageHide);
		const pageShow = (event: PageTransitionEvent) => {
			handleForeground(event);
		};
		window.addEventListener('pageshow', pageShow);
		const windowFocus = (event: FocusEvent) => {
			if (!document.hidden && inBgRef.current) {
				handleForeground(event);
			}
		};
		window.addEventListener('focus', windowFocus);
		const windowBlur = (event: FocusEvent) => {
			if (!document.hidden && isProbablyIOSWebKit()) {
				handleBackground(event);
			}
		};
		window.addEventListener('blur', windowBlur);
		const pictureInPictureControlActivation = (event: Event) => {
			if (
				!isPictureInPictureControlEvent(event, player.el) ||
				!getSafePlayerPictureInPicture(player)
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			void exitAutoPictureInPicture(event, true);
		};
		const pictureInPictureControlKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			pictureInPictureControlActivation(event);
		};
		const pictureInPictureShortcutKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.key.toLowerCase() !== 'i' ||
				isEditableKeyboardEventTarget(event.target) ||
				!getSafePlayerPictureInPicture(player)
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			void exitAutoPictureInPicture(event, true);
		};
		player.el?.addEventListener('pointerup', pictureInPictureControlActivation, true);
		player.el?.addEventListener('click', pictureInPictureControlActivation, true);
		player.el?.addEventListener('keydown', pictureInPictureControlKeyDown, true);
		document.addEventListener('keydown', pictureInPictureShortcutKeyDown, true);
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
			const selectedTrack = subtitlesManuallyDisabledRef.current
				? null
				: getSelectedSubtitleTrack(
						player,
						videoElement,
						subtitleTracksRef.current,
						selectedSubtitleTrackRef.current
					);
			if (subtitlesManuallyDisabledRef.current) {
				disablePlayerSubtitleTextTracks(player, subtitleTracksRef.current);
			}
			if (selectedTrack?.src !== selectedSubtitleTrackRef.current?.src) {
				updateSelectedSubtitleTrackRef.current(selectedTrack);
			}
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
			window.removeEventListener('pagehide', pageHide);
			window.removeEventListener('pageshow', pageShow);
			window.removeEventListener('focus', windowFocus);
			window.removeEventListener('blur', windowBlur);
			player.el?.removeEventListener('pointerup', pictureInPictureControlActivation, true);
			player.el?.removeEventListener('click', pictureInPictureControlActivation, true);
			player.el?.removeEventListener('keydown', pictureInPictureControlKeyDown, true);
			document.removeEventListener('keydown', pictureInPictureShortcutKeyDown, true);
			document.removeEventListener('mousemove', mouseMove);
			player.el?.removeEventListener('mouseleave', mouseLeave);
		};
	}, [
		applyRemotePlaybackSync,
		chatFocused,
		mediaProviderEl,
		playerEl,
		refreshRoomMedia,
		send,
		updateLastTicked,
		updateSelectedSubtitleTrackRef,
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
			const player = playerElementRef.current;
			pendingAudioSwitchPlaybackRef.current = {
				audio: curr,
				time: getSafePlayerCurrentTime(player) ?? 0,
				paused: getSafePlayerPaused(player) ?? true
			};
			setAudioRemountKey((value) => value + 1);
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

	function saveProfileName(nextDraftName: string) {
		if (discordUser) {
			send({
				type: SyncTypes.ProfileSync,
				name: displayName,
				profileId,
				discordUser
			});
			return;
		}
		const nextName = nextDraftName.trim();
		setName(nextName);
		send({
			type: SyncTypes.ProfileSync,
			name: nextName,
			profileId
		});
		window.localStorage.setItem('name', nextName);
		if (nextName !== lastSavedNameRef.current) {
			lastSavedNameRef.current = nextName;
			window.localStorage.removeItem(GENERATED_NAME_STORAGE_KEY);
			addSystemMessage(nextName ? `Name updated: ${nextName}` : 'Name cleared');
		}
	}

	function handleProfileSettingsOpenChange(open: boolean) {
		const wasOpen = profileSettingsOpenRef.current;
		profileSettingsOpenRef.current = open;
		if (open) {
			if (!wasOpen) {
				setProfileNameDraft(displayName);
			}
			return;
		}
		if (wasOpen) {
			saveProfileName(profileNameDraft);
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
		if (socketCommunicating || !playerElementRef.current) {
			return;
		}
		startWatchRoomConnection();
	}

	function handleDisconnectRoomPlayer(target: RoomPlayer) {
		disconnectRoomPlayer(target.id);
	}

	const resetChatFocusTimer = useCallback(() => {
		chatFocusedSecsRef.current = 0;
		setChatFocusedSecs(0);
	}, []);

	const handleControlsChatPickerOpenChange = useCallback(
		(open: boolean) => {
			setControlsChatPickerOpen(open);
			if (open) {
				playerEl?.controls?.pause?.();
				resetChatFocusTimer();
				return;
			}
			playerEl?.controls?.resume?.();
			resetChatFocusTimer();
		},
		[playerEl, resetChatFocusTimer]
	);
	const showJoinOverlay = !socketConnected;
	const mediaPlayerClassName = `media-player relative w-full bg-slate-900 ${discord ? 'h-[100dvh]' : 'aspect-video'} ${getSafePlayerPaused(playerEl) === false && chatFocusedSecs > hideControlsOnChatFocused && !controlsChatPickerOpen ? 'chat-controls-hidden' : ''}`;
	const selectedSubtitleLayerCount = getSelectedSubtitleLayerCount(
		subtitleTracks,
		selectedSubtitleTrack,
		extraSubtitleLayerSrcs
	);
	const mediaPlayerStyle: CSSProperties & Record<`--${string}`, string> = {
		'--sparkle-subtitle-font-scale': String(getMergedSubtitleFontScale(selectedSubtitleLayerCount))
	};
	const activeSubtitleFormat = selectedSubtitleTrack?.format ?? null;
	const subtitlesSettingsSummary = selectedSubtitleTrack
		? `${selectedSubtitleLayerCount} ${getSubtitleFormatName(selectedSubtitleTrack.format)}`
		: 'Off';
	const subtitlesSettingsMenu =
		subtitleTracks.length > 0 ? (
			<Menu.Root className="vds-player-settings-menu vds-subtitles-settings-menu vds-menu">
				<DefaultMenuButton
					label="Subtitles"
					hint={subtitlesSettingsSummary}
					Icon={defaultLayoutIcons.Menu.Captions}
				/>
				<Menu.Items className="vds-menu-items">
					<SubtitlesMenuSection
						activeFormat={activeSubtitleFormat}
						extraSubtitleLayerSrcs={extraSubtitleLayerSrcs}
						onFormatChange={changeSubtitleFormat}
						onToggleTrack={toggleSubtitleTrack}
						selectedTrack={selectedSubtitleTrack}
						tracks={subtitleTracks}
					/>
				</Menu.Items>
			</Menu.Root>
		) : null;
	const videoSettingsMenu = (
		<Menu.Root className="vds-player-settings-menu vds-video-settings-menu vds-menu">
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
				showPlayerCount
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
					resetChatFocusTimer();
				}}
				onPickerOpenChange={handleControlsChatPickerOpenChange}
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
			<div className="relative z-30 w-full">
				<div
					className={`transition-[filter,opacity] duration-300 ${
						showJoinOverlay ? 'pointer-events-none blur-sm' : 'filter-none'
					}`}
				>
					{mounted && thumbnailVttSrc && playerSrcUrl ? (
						<MediaPlayer
							className={mediaPlayerClassName}
							key={`${playerSrcUrl}:${audioRemountKey}:${thumbnailVttSrc}`}
							src={playerSrcUrl}
							style={mediaPlayerStyle}
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
								updateMediaSessionState();
							}}
							onSeeking={() => {
								supRef.current?.seekingHandler();
							}}
							onPause={() => {
								supRef.current?.pauseHandler();
								supPlayingRef.current = false;
								const isAudioSwitchPlaybackEvent =
									Boolean(pendingAudioSwitchPlaybackRef.current) ||
									audioSwitchPlaybackRestoringRef.current;
								const shouldSyncPlayback = shouldSendPlaybackSync();
								updateAutoPictureInPicturePreference(playerEl, false);
								if (shouldSyncPlayback) {
									send({ paused: true, type: SyncTypes.PauseSync });
								}
								if (!isAudioSwitchPlaybackEvent) {
									setCurrentlyWatching((value) => (value ? { ...value, paused: true } : null));
								}
								updateMediaSessionState();
							}}
							onPlay={() => {
								supRef.current?.playHandler();
								if (supRef.current) {
									supPlayingRef.current = true;
								}
								const isAudioSwitchPlaybackEvent =
									Boolean(pendingAudioSwitchPlaybackRef.current) ||
									audioSwitchPlaybackRestoringRef.current;
								if (!isAudioSwitchPlaybackEvent) {
									startWatchRoomConnection();
								}
								const shouldSyncPlayback = shouldSendPlaybackSync();
								if (shouldSyncPlayback && interactedRef.current) {
									send({ paused: false, type: SyncTypes.PauseSync });
								}
								if (!isAudioSwitchPlaybackEvent) {
									setCurrentlyWatching((value) => (value ? { ...value, paused: false } : null));
								}
								updateAutoPictureInPicturePreference(playerEl, true);
								updateMediaSessionState();
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
									timeSlider: <OptimizedTimeSlider thumbnails={thumbnailVttSrc} />,
									settingsMenuItemsStart: videoSettingsMenu,
									settingsMenuItemsEnd: subtitlesSettingsMenu,
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
								disabled={!playerEl}
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
							resetChatFocusTimer();
						}}
					/>
				</div>

				<div className="order-2 mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-2 max-[760px]:justify-center">
					<div className="order-2 flex min-w-0 justify-start min-[761px]:order-1">
						{voiceSupported ? <VoiceControls voice={voice} /> : null}
					</div>
					<RoomNavigationInput
						inputId="room-navigation-input"
						className="order-1 w-full max-w-xl max-[760px]:mx-auto max-[760px]:mb-1 min-[761px]:order-2 min-[761px]:w-auto min-[761px]:flex-1 min-[761px]:max-w-lg"
					/>
					<div className="order-3 flex min-w-0 items-center justify-end gap-2">
						<Tooltip.Provider delayDuration={0}>
							<Tooltip.Root>
								<Tooltip.Trigger asChild>
									<Button
										variant={theme === 'dark' ? 'outline' : 'default'}
										className="h-10 w-28 flex-none justify-center px-3"
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

				<div className="order-1 flex flex-wrap justify-center gap-4">
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
									isCurrentUser ? 'Open profile settings' : `Open user actions for ${player.name}`
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
													{voiceSupported ? 'Microphone volume' : 'Room user'}
												</Dialog.Description>
											</div>
										</div>
										{voiceSupported ? (
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
																setRemoteMicVolume(
																	player.id,
																	Number(event.currentTarget.value) / 100
																)
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
										) : null}
										<div className="flex flex-wrap items-center justify-between gap-2">
											<Button
												variant="destructive"
												className="min-h-9"
												onClick={() => handleDisconnectRoomPlayer(player)}
											>
												Disconnect user
											</Button>
											{voiceSupported ? (
												<Button
													variant="outline"
													className="gap-2"
													disabled={remoteMicVolume === DEFAULT_REMOTE_MIC_VOLUME}
													onClick={() => setRemoteMicVolume(player.id, DEFAULT_REMOTE_MIC_VOLUME)}
												>
													<IconRefresh data-icon="inline-start" stroke={2} />
													Reset
												</Button>
											) : null}
										</div>
									</Dialog.Content>
								</Dialog.Root>
							);
						}
						return (
							<Dialog.Root key={player.id} onOpenChange={handleProfileSettingsOpenChange}>
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
												name={discordUser ? displayName : profileNameDraft}
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
												value={discordUser ? displayName : profileNameDraft}
												onChange={(event) => setProfileNameDraft(event.target.value)}
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

				<Card className="order-3 mt-auto w-full max-w-[90rem] self-center">
					<CardHeader className="max-sm:pb-0 max-sm:pl-4 max-sm:pr-4 max-sm:pt-4">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
								<Tooltip.Provider delayDuration={0}>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<Button
												type="button"
												variant="outline"
												className="h-auto min-h-9 gap-2 px-3 py-2"
												disabled={!socketConnected || !currentWordlePlayer}
												onClick={openNewWordleTab}
											>
												<IconKeyboard size={18} stroke={2} />
												<span>Wordle</span>
											</Button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											<p>Open synced Wordle game</p>
										</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>
							</div>
						</div>
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
								translucent={floatingTabsTranslucent}
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
								translucent={floatingTabsTranslucent}
								onStateChange={(patch) => updateChessState(tab.id, patch)}
								onNotification={sendChessNotification}
							/>
						))
				: null}

			{socketConnected
				? wordleState.tabs
						.filter((tab) => tab.open)
						.map((tab, index) => (
							<WordleFloatingTab
								key={tab.id}
								roomId={wordleRoomId}
								initialIndex={index}
								state={tab}
								currentPlayer={currentWordlePlayer}
								translucent={floatingTabsTranslucent}
								onStateChange={(patch) => updateWordleState(tab.id, patch)}
							/>
						))
				: null}

			{moveToast ? (
				<div className="fixed bottom-4 left-1/2 z-[100] w-[90%] max-w-xl -translate-x-1/2">
					<MoveToast
						key={`${moveToast.job?.Id ?? 'unknown'}-${moveToast.seconds}-${moveToast.timestamp ?? 0}-${moveToast.firedBy?.id ?? 'room'}`}
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
