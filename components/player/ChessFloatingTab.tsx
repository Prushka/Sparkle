'use client';

import {
	type ChangeEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import Image from 'next/image';
import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import {
	IconChess,
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconCircleCheck,
	IconCircleX,
	IconClock,
	IconCrown,
	IconFlag,
	IconGripVertical,
	IconHeartHandshake,
	IconPlayerPlayFilled,
	IconRefresh,
	IconScale,
	IconUserMinus,
	IconUserPlus,
	IconX
} from '@tabler/icons-react';
import type {
	ChessBoardTheme,
	ChessClockSyncState,
	ChessColor,
	ChessMoveSyncState,
	ChessPieceSet,
	ChessPlayerSyncState,
	ChessResultSyncState,
	ChessSettingsSyncState,
	ChessTabSyncState
} from '@/lib/player/t';
import {
	CHESS_NOTIFICATION_SOUND_IDS,
	type ChessNotificationSoundId
} from '@/lib/player/chess-notifications';
import { Button } from '@/components/ui/button';

type ChessTabLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

type ChessFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: ChessTabSyncState;
	currentPlayer: ChessPlayerSyncState | null;
	onStateChange: (patch: Partial<ChessTabSyncState>) => void;
	onNotification: (soundId: ChessNotificationSoundId) => void;
};

type PromotionChoice = {
	from: Square;
	to: Square;
	options: PieceSymbol[];
};

type ChessSelectProps = {
	label: string;
	value: string | number;
	disabled?: boolean;
	onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
	children: ReactNode;
};

const MIN_WIDTH = 760;
const MIN_HEIGHT = 540;
const DEFAULT_WIDTH = 880;
const DEFAULT_HEIGHT = 680;
const COLLAPSED_HEIGHT = 44;
const CLOSE_CONFIRMATION_MS = 60_000;
const CHESS_PIECE_SET_OPTIONS: { value: ChessPieceSet; label: string }[] = [
	{ value: 'cartoon', label: 'Cartoon' },
	{ value: 'mushroom', label: 'Mushroom' },
	{ value: 'sushi', label: 'Sushi' },
	{ value: 'space', label: 'Space' }
];
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;
const PROMOTION_ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n'];

const PIECE_ASSET_NAMES: Record<PieceSymbol, string> = {
	k: 'king',
	q: 'queen',
	r: 'rook',
	b: 'bishop',
	n: 'knight',
	p: 'pawn'
};

const BOARD_THEMES: Record<
	ChessBoardTheme,
	{
		light: string;
		dark: string;
		border: string;
		accent: string;
	}
> = {
	green: {
		light: 'bg-emerald-50',
		dark: 'bg-emerald-600',
		border: 'border-emerald-900/20',
		accent: 'bg-emerald-400/45'
	},
	blue: {
		light: 'bg-sky-50',
		dark: 'bg-sky-600',
		border: 'border-sky-950/20',
		accent: 'bg-cyan-300/45'
	},
	walnut: {
		light: 'bg-stone-100',
		dark: 'bg-amber-700',
		border: 'border-amber-950/25',
		accent: 'bg-yellow-300/45'
	}
};

let chessTabZIndexCounter = 140;

type FloatingZIndexWindow = Window & {
	__sparkleFloatingTabZIndex?: number;
};

function nextFloatingTabZIndex() {
	if (typeof window === 'undefined') {
		chessTabZIndexCounter += 1;
		return chessTabZIndexCounter;
	}
	const zWindow = window as FloatingZIndexWindow;
	const current = Math.max(zWindow.__sparkleFloatingTabZIndex ?? 140, chessTabZIndexCounter);
	const next = current + 1;
	zWindow.__sparkleFloatingTabZIndex = next;
	chessTabZIndexCounter = next;
	return next;
}

function readStoredLayout(storageKey: string): ChessTabLayout | null {
	if (typeof window === 'undefined') {
		return null;
	}
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (!stored) {
			return null;
		}
		const parsed = JSON.parse(stored) as Partial<ChessTabLayout>;
		if (
			typeof parsed.x !== 'number' ||
			typeof parsed.y !== 'number' ||
			typeof parsed.width !== 'number' ||
			typeof parsed.height !== 'number'
		) {
			return null;
		}
		return parsed as ChessTabLayout;
	} catch {
		return null;
	}
}

function readStoredCollapsed(storageKey: string) {
	if (typeof window === 'undefined') {
		return false;
	}
	return window.localStorage.getItem(storageKey) === 'true';
}

function getDefaultLayout(initialIndex = 0): ChessTabLayout {
	if (typeof window === 'undefined') {
		return { x: 32, y: 88, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
	}
	const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 32));
	const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 32));
	const offset = Math.min(180, Math.max(0, initialIndex) * 34);
	return {
		x: Math.max(16, window.innerWidth - width - 32 - offset),
		y: Math.min(88 + offset, Math.max(16, window.innerHeight - height - 24)),
		width,
		height
	};
}

function clampLayout(layout: ChessTabLayout, visibleHeight = layout.height): ChessTabLayout {
	if (typeof window === 'undefined') {
		return layout;
	}
	const width = Math.min(
		Math.max(layout.width, MIN_WIDTH),
		Math.max(MIN_WIDTH, window.innerWidth - 16)
	);
	const height = Math.min(
		Math.max(layout.height, MIN_HEIGHT),
		Math.max(MIN_HEIGHT, window.innerHeight - 16)
	);
	const boxHeight = Math.max(0, Math.min(visibleHeight, window.innerHeight - 16));
	return {
		x: Math.min(Math.max(8, layout.x), Math.max(8, window.innerWidth - width - 8)),
		y: Math.min(Math.max(8, layout.y), Math.max(8, window.innerHeight - boxHeight - 8)),
		width,
		height
	};
}

function constrainResizeSize(width: number, height: number) {
	if (typeof window === 'undefined') {
		return {
			width: Math.max(width, MIN_WIDTH),
			height: Math.max(height, MIN_HEIGHT)
		};
	}
	return {
		width: Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - 16)),
		height: Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - 16))
	};
}

function resizeLayoutFromCorner(
	start: ChessTabLayout,
	corner: ResizeCorner,
	deltaX: number,
	deltaY: number
) {
	const right = start.x + start.width;
	const bottom = start.y + start.height;
	if (corner === 'top-left') {
		const size = constrainResizeSize(start.width - deltaX, start.height - deltaY);
		return clampLayout({
			x: right - size.width,
			y: bottom - size.height,
			width: size.width,
			height: size.height
		});
	}
	if (corner === 'top-right') {
		const size = constrainResizeSize(start.width + deltaX, start.height - deltaY);
		return clampLayout({
			x: start.x,
			y: bottom - size.height,
			width: size.width,
			height: size.height
		});
	}
	if (corner === 'bottom-left') {
		const size = constrainResizeSize(start.width - deltaX, start.height + deltaY);
		return clampLayout({
			x: right - size.width,
			y: start.y,
			width: size.width,
			height: size.height
		});
	}
	return clampLayout({
		...start,
		width: start.width + deltaX,
		height: start.height + deltaY
	});
}

function isSameLayout(a: ChessTabLayout, b: ChessTabLayout) {
	return (
		Math.abs(a.x - b.x) < 0.5 &&
		Math.abs(a.y - b.y) < 0.5 &&
		Math.abs(a.width - b.width) < 0.5 &&
		Math.abs(a.height - b.height) < 0.5
	);
}

function getNowMs() {
	return Date.now();
}

function getPieceAsset(color: ChessColor, piece: PieceSymbol, pieceSet: ChessPieceSet) {
	const side = color === 'w' ? 'first' : 'second';
	const extension = pieceSet === 'cartoon' ? 'png' : 'svg';
	return `/media/chess/${pieceSet}/${side}/${PIECE_ASSET_NAMES[piece]}.${extension}`;
}

function pieceColorName(color: ChessColor) {
	return color === 'w' ? 'White' : 'Black';
}

function playerLabel(player: ChessPlayerSyncState | null | undefined) {
	return player?.name || 'Open seat';
}

function colorName(color: ChessColor) {
	return color === 'w' ? 'White' : 'Black';
}

function otherColor(color: ChessColor): ChessColor {
	return color === 'w' ? 'b' : 'w';
}

function isSameChessPlayer(
	left: ChessPlayerSyncState | null | undefined,
	right: ChessPlayerSyncState | null | undefined
) {
	if (!left || !right) {
		return false;
	}
	return (
		left.id === right.id ||
		Boolean(left.profileId && right.profileId && left.profileId === right.profileId)
	);
}

function getPlayerColor(
	tab: ChessTabSyncState,
	player: ChessPlayerSyncState | null | undefined
): ChessColor | null {
	if (!player) {
		return null;
	}
	if (isSameChessPlayer(tab.white, player)) {
		return 'w';
	}
	if (isSameChessPlayer(tab.black, player)) {
		return 'b';
	}
	return null;
}

function squareFromParts(file: string, rank: string): Square {
	return `${file}${rank}` as Square;
}

function buildChessFromMoves(moves: ChessMoveSyncState[]) {
	const game = new Chess();
	for (const move of moves) {
		try {
			const result = game.move({
				from: move.from as Square,
				to: move.to as Square,
				promotion: (move.promotion || undefined) as PieceSymbol | undefined
			});
			if (!result) {
				return new Chess();
			}
		} catch {
			return new Chess();
		}
	}
	return game;
}

function getGameResult(game: Chess): ChessResultSyncState | null {
	if (game.isCheckmate()) {
		const winner = otherColor(game.turn() as ChessColor);
		return {
			winner,
			reason: 'checkmate',
			message: `${colorName(winner)} wins by checkmate`
		};
	}
	if (game.isStalemate()) {
		return { winner: 'draw', reason: 'stalemate', message: 'Draw by stalemate' };
	}
	if (game.isThreefoldRepetition()) {
		return { winner: 'draw', reason: 'threefold', message: 'Draw by threefold repetition' };
	}
	if (game.isInsufficientMaterial()) {
		return {
			winner: 'draw',
			reason: 'insufficient-material',
			message: 'Draw by insufficient material'
		};
	}
	if (game.isDrawByFiftyMoves()) {
		return { winner: 'draw', reason: 'fifty-move', message: 'Draw by the fifty-move rule' };
	}
	if (game.isDraw()) {
		return { winner: 'draw', reason: 'draw', message: 'Draw' };
	}
	return null;
}

function getLiveClocks(tab: ChessTabSyncState, turn: ChessColor, now: number): ChessClockSyncState {
	const clocks = tab.clocks;
	if (!tab.settings.timed || tab.phase !== 'playing' || clocks.lastTickAt <= 0) {
		return clocks;
	}
	const elapsed = Math.max(0, now - clocks.lastTickAt);
	if (turn === 'w') {
		return { ...clocks, w: Math.max(0, clocks.w - elapsed) };
	}
	return { ...clocks, b: Math.max(0, clocks.b - elapsed) };
}

function formatClock(ms: number) {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function buildResignationResult(loser: ChessColor): ChessResultSyncState {
	const winner = otherColor(loser);
	return {
		winner,
		reason: 'resignation',
		message: `${colorName(loser)} resigned`
	};
}

function buildTimeoutResult(loser: ChessColor): ChessResultSyncState {
	const winner = otherColor(loser);
	return {
		winner,
		reason: 'timeout',
		message: `${colorName(winner)} wins on time`
	};
}

function boardSquares(orientation: ChessColor) {
	const ranks = orientation === 'w' ? [...RANKS].reverse() : [...RANKS];
	const files = orientation === 'w' ? [...FILES] : [...FILES].reverse();
	return ranks.flatMap((rank) => files.map((file) => squareFromParts(file, rank)));
}

function SeatButton({
	color,
	player,
	currentPlayer,
	disabled,
	onJoin,
	onLeave
}: {
	color: ChessColor;
	player: ChessPlayerSyncState | null;
	currentPlayer: ChessPlayerSyncState | null;
	disabled: boolean;
	onJoin: () => void;
	onLeave: () => void;
}) {
	const isSelf = isSameChessPlayer(player, currentPlayer);
	return (
		<div className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background/80 px-2.5 py-2">
			<div className="min-w-0">
				<div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
					{colorName(color)}
				</div>
				<div className="truncate text-sm font-semibold">{playerLabel(player)}</div>
			</div>
			{isSelf ? (
				<Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onLeave}>
					<IconUserMinus size={17} stroke={2} />
				</Button>
			) : (
				<Button
					type="button"
					size="icon"
					variant="outline"
					className="h-8 w-8"
					disabled={disabled || Boolean(player)}
					onClick={onJoin}
				>
					<IconUserPlus size={17} stroke={2} />
				</Button>
			)}
		</div>
	);
}

function ChessSelect({ label, value, disabled = false, onChange, children }: ChessSelectProps) {
	return (
		<label className="grid gap-1 text-xs font-bold text-muted-foreground">
			{label}
			<span className="relative block">
				<select
					value={value}
					disabled={disabled}
					onChange={onChange}
					className="h-9 w-full appearance-none rounded-md border bg-background py-0 pl-2 pr-9 text-sm font-semibold text-foreground outline-none disabled:opacity-50"
				>
					{children}
				</select>
				<IconChevronDown
					size={16}
					stroke={2}
					className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground ${
						disabled ? 'opacity-50' : ''
					}`}
				/>
			</span>
		</label>
	);
}

function ChessCheckbox({
	label,
	checked,
	onChange
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex items-center justify-between gap-3 text-sm font-semibold">
			<span>{label}</span>
			<span className="relative h-5 w-5 shrink-0">
				<input
					type="checkbox"
					checked={checked}
					onChange={(event) => onChange(event.target.checked)}
					aria-label={label}
					className="absolute inset-0 m-0 h-5 w-5 appearance-none rounded border border-input bg-background checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				{checked ? (
					<IconCheck
						size={14}
						stroke={3}
						className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-primary-foreground"
					/>
				) : null}
			</span>
		</label>
	);
}

export function ChessFloatingTab({
	roomId,
	initialIndex = 0,
	state,
	currentPlayer,
	onStateChange,
	onNotification
}: ChessFloatingTabProps) {
	const storageKey = `sparkle:chess-tab-layout:${roomId}:${state.id}`;
	const collapsedStorageKey = `sparkle:chess-tab-collapsed:${roomId}:${state.id}`;
	const panelRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		x: number;
		y: number;
	} | null>(null);
	const resizeRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		x: number;
		y: number;
		width: number;
		height: number;
		corner: ResizeCorner;
	} | null>(null);
	const resizeCleanupRef = useRef<(() => void) | null>(null);
	const [layoutReady, setLayoutReady] = useState(false);
	const [layout, setLayout] = useState<ChessTabLayout>({
		x: 32,
		y: 88,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT
	});
	const [zIndex, setZIndex] = useState(nextFloatingTabZIndex);
	const [selectedSquareState, setSelectedSquare] = useState<Square | null>(null);
	const [promotion, setPromotion] = useState<PromotionChoice | null>(null);
	const [clockNow, setClockNow] = useState(() => getNowMs());
	const [collapsed, setCollapsed] = useState(false);

	const game = useMemo(() => buildChessFromMoves(state.moves), [state.moves]);
	const myColor = getPlayerColor(state, currentPlayer);
	const activeColor = game.turn() as ChessColor;
	const isMyTurn = state.phase === 'playing' && myColor === activeColor;
	const isParticipant = Boolean(myColor);
	const orientation = myColor ?? 'w';
	const squares = useMemo(() => boardSquares(orientation), [orientation]);
	const selectedPiece = selectedSquareState ? game.get(selectedSquareState) : undefined;
	const selectedSquare =
		state.phase === 'playing' && selectedPiece?.color === myColor ? selectedSquareState : null;
	const legalMoves = useMemo<Move[]>(() => {
		if (!selectedSquare) {
			return [];
		}
		return game.moves({ square: selectedSquare, verbose: true });
	}, [game, selectedSquare]);
	const legalTargets = useMemo(() => new Set(legalMoves.map((move) => move.to)), [legalMoves]);
	const liveClocks = getLiveClocks(state, activeColor, clockNow);
	const currentStatus = useMemo(() => {
		if (state.result) {
			return state.result.message;
		}
		if (state.phase === 'setup') {
			return 'Waiting to start';
		}
		if (game.isCheck()) {
			return `${colorName(activeColor)} to move, in check`;
		}
		return `${colorName(activeColor)} to move`;
	}, [activeColor, game, state.phase, state.result]);
	const theme = BOARD_THEMES[state.settings.boardTheme] ?? BOARD_THEMES.green;
	const closeRequest = state.closeRequest;
	const closeResponder =
		Boolean(
			closeRequest && currentPlayer && !isSameChessPlayer(closeRequest.requestedBy, currentPlayer)
		) && isParticipant;
	const closeSecondsLeft = closeRequest
		? Math.max(0, Math.ceil((closeRequest.expiresAt - clockNow) / 1000))
		: 0;
	const drawOffer = state.drawOffer;
	const canAnswerDrawOffer =
		Boolean(drawOffer && currentPlayer && !isSameChessPlayer(drawOffer.offeredBy, currentPlayer)) &&
		isParticipant;
	const panelCollapsed = collapsed && !closeRequest;
	const canStartGame = Boolean(
		state.white &&
		state.black &&
		currentPlayer &&
		(isSameChessPlayer(state.white, currentPlayer) || isSameChessPlayer(state.black, currentPlayer))
	);

	useEffect(() => {
		return () => {
			resizeCleanupRef.current?.();
			resizeCleanupRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!state.settings.timed && !state.closeRequest) {
			return;
		}
		const timer = window.setInterval(() => setClockNow(getNowMs()), 500);
		return () => window.clearInterval(timer);
	}, [state.closeRequest, state.settings.timed]);

	useEffect(() => {
		if (!state.settings.timed || state.phase !== 'playing' || state.result) {
			return;
		}
		if (liveClocks[activeColor] > 0) {
			return;
		}
		onStateChange({
			phase: 'ended',
			result: buildTimeoutResult(activeColor),
			clocks: { ...liveClocks, lastTickAt: 0 },
			drawOffer: null
		});
		if (myColor === activeColor) {
			onNotification(CHESS_NOTIFICATION_SOUND_IDS.gameOver);
		}
	}, [
		activeColor,
		liveClocks,
		myColor,
		onNotification,
		onStateChange,
		state.phase,
		state.result,
		state.settings.timed
	]);

	useEffect(() => {
		if (!closeRequest || !isParticipant) {
			return;
		}
		const delay = Math.max(0, closeRequest.expiresAt - getNowMs());
		const timer = window.setTimeout(() => {
			onStateChange({ open: false, closeRequest: null });
		}, delay);
		return () => window.clearTimeout(timer);
	}, [closeRequest, isParticipant, onStateChange]);

	const saveLayout = useCallback(
		(next: ChessTabLayout) => {
			if (typeof window === 'undefined') {
				return;
			}
			window.localStorage.setItem(storageKey, JSON.stringify(next));
		},
		[storageKey]
	);

	const updateLayout = useCallback(
		(updater: ChessTabLayout | ((current: ChessTabLayout) => ChessTabLayout)) => {
			setLayout((current) => {
				const next = clampLayout(
					typeof updater === 'function' ? updater(current) : updater,
					panelCollapsed ? COLLAPSED_HEIGHT : undefined
				);
				if (isSameLayout(current, next)) {
					return current;
				}
				saveLayout(next);
				return next;
			});
		},
		[panelCollapsed, saveLayout]
	);

	const bringToFront = useCallback(() => {
		setZIndex(nextFloatingTabZIndex());
	}, []);

	const toggleCollapsed = useCallback(() => {
		const nextCollapsed = !collapsed;
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(collapsedStorageKey, String(nextCollapsed));
		}
		setCollapsed(nextCollapsed);
		setLayout((current) => {
			const next = clampLayout(
				current,
				nextCollapsed && !closeRequest ? COLLAPSED_HEIGHT : undefined
			);
			if (isSameLayout(current, next)) {
				return current;
			}
			saveLayout(next);
			return next;
		});
	}, [closeRequest, collapsed, collapsedStorageKey, saveLayout]);

	useLayoutEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			const storedCollapsed = readStoredCollapsed(collapsedStorageKey);
			setLayout(
				clampLayout(
					readStoredLayout(storageKey) ?? getDefaultLayout(initialIndex),
					storedCollapsed && !closeRequest ? COLLAPSED_HEIGHT : undefined
				)
			);
			setCollapsed(storedCollapsed);
			setLayoutReady(true);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [closeRequest, collapsedStorageKey, initialIndex, storageKey]);

	useEffect(() => {
		if (!state.open) {
			return;
		}
		const handleResize = () => updateLayout((current) => current);
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [state.open, updateLayout]);

	function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: layout.x,
			y: layout.y
		};
	}

	function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		updateLayout({
			...layout,
			x: drag.x + event.clientX - drag.startX,
			y: drag.y + event.clientY - drag.startY
		});
	}

	function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
		if (dragRef.current?.pointerId === event.pointerId) {
			dragRef.current = null;
		}
	}

	function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>, corner: ResizeCorner) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Window listeners below keep resize working when pointer capture is unavailable.
		}
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: layout.x,
			y: layout.y,
			width: layout.width,
			height: layout.height,
			corner
		};
		resizeCleanupRef.current?.();

		const handleWindowResizeMove = (moveEvent: PointerEvent) => {
			applyResize(moveEvent.pointerId, moveEvent.clientX, moveEvent.clientY);
		};
		const handleWindowResizeEnd = (endEvent: PointerEvent) => {
			finishResize(endEvent.pointerId);
		};

		window.addEventListener('pointermove', handleWindowResizeMove);
		window.addEventListener('pointerup', handleWindowResizeEnd);
		window.addEventListener('pointercancel', handleWindowResizeEnd);
		resizeCleanupRef.current = () => {
			window.removeEventListener('pointermove', handleWindowResizeMove);
			window.removeEventListener('pointerup', handleWindowResizeEnd);
			window.removeEventListener('pointercancel', handleWindowResizeEnd);
		};
	}

	function applyResize(pointerId: number, clientX: number, clientY: number) {
		const resize = resizeRef.current;
		if (!resize || resize.pointerId !== pointerId) {
			return;
		}
		updateLayout(
			resizeLayoutFromCorner(
				resize,
				resize.corner,
				clientX - resize.startX,
				clientY - resize.startY
			)
		);
	}

	function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
		applyResize(event.pointerId, event.clientX, event.clientY);
	}

	function finishResize(pointerId: number) {
		if (resizeRef.current?.pointerId === pointerId) {
			resizeRef.current = null;
			resizeCleanupRef.current?.();
			resizeCleanupRef.current = null;
		}
	}

	function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
		finishResize(event.pointerId);
	}

	function updateSettings(patch: Partial<ChessSettingsSyncState>) {
		if (state.phase !== 'setup') {
			return;
		}
		onStateChange({
			settings: {
				...state.settings,
				...patch
			}
		});
	}

	function updatePieceSet(pieceSet: ChessPieceSet) {
		if (state.phase === 'setup') {
			updateSettings({ pieceSet });
			return;
		}
		onStateChange({
			settings: {
				...state.settings,
				pieceSet
			}
		});
	}

	function joinSeat(color: ChessColor) {
		if (!currentPlayer || state.phase !== 'setup') {
			return;
		}
		onStateChange({
			white:
				color === 'w'
					? currentPlayer
					: isSameChessPlayer(state.white, currentPlayer)
						? null
						: state.white,
			black:
				color === 'b'
					? currentPlayer
					: isSameChessPlayer(state.black, currentPlayer)
						? null
						: state.black
		});
	}

	function leaveSeat() {
		if (!currentPlayer || state.phase !== 'setup') {
			return;
		}
		onStateChange({
			white: isSameChessPlayer(state.white, currentPlayer) ? null : state.white,
			black: isSameChessPlayer(state.black, currentPlayer) ? null : state.black
		});
	}

	function swapSeats() {
		if (state.phase !== 'setup') {
			return;
		}
		onStateChange({ white: state.black, black: state.white });
	}

	function startGame() {
		if (!canStartGame) {
			return;
		}
		const started = new Chess();
		const duration = state.settings.minutes * 60_000;
		const now = getNowMs();
		onStateChange({
			phase: 'playing',
			fen: started.fen(),
			moves: [],
			clocks: {
				w: duration,
				b: duration,
				lastTickAt: state.settings.timed ? now : 0
			},
			result: null,
			drawOffer: null,
			closeRequest: null
		});
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.start);
	}

	function resetGame() {
		if (!isParticipant) {
			return;
		}
		const duration = state.settings.minutes * 60_000;
		onStateChange({
			phase: 'setup',
			fen: 'start',
			moves: [],
			clocks: { w: duration, b: duration, lastTickAt: 0 },
			result: null,
			drawOffer: null,
			closeRequest: null
		});
	}

	function makeMove(from: Square, to: Square, promotionPiece?: PieceSymbol) {
		if (!isMyTurn || closeRequest) {
			return;
		}
		const nextGame = buildChessFromMoves(state.moves);
		const now = getNowMs();
		let nextClocks = getLiveClocks(state, nextGame.turn() as ChessColor, now);
		let move: Move;
		try {
			const result = nextGame.move({ from, to, promotion: promotionPiece });
			if (!result) {
				return;
			}
			move = result;
		} catch {
			return;
		}
		if (state.settings.timed) {
			const movedColor = move.color as ChessColor;
			const increment = state.settings.incrementSeconds * 1000;
			nextClocks = {
				...nextClocks,
				[movedColor]: nextClocks[movedColor] + increment,
				lastTickAt: now
			};
		}
		const result = getGameResult(nextGame);
		if (result) {
			nextClocks = { ...nextClocks, lastTickAt: 0 };
		}
		onStateChange({
			phase: result ? 'ended' : 'playing',
			fen: nextGame.fen(),
			moves: [
				...state.moves,
				{
					from: move.from,
					to: move.to,
					promotion: move.promotion,
					san: move.san
				}
			],
			clocks: nextClocks,
			result,
			drawOffer: null
		});
		if (result) {
			onNotification(CHESS_NOTIFICATION_SOUND_IDS.gameOver);
		} else if (move.captured) {
			onNotification(CHESS_NOTIFICATION_SOUND_IDS.capture);
		} else if (nextGame.isCheck()) {
			onNotification(CHESS_NOTIFICATION_SOUND_IDS.check);
		} else {
			onNotification(CHESS_NOTIFICATION_SOUND_IDS.move);
		}
	}

	function handleSquareClick(square: Square) {
		if (!isMyTurn || promotion || closeRequest) {
			return;
		}
		const piece = game.get(square);
		if (!selectedSquare) {
			if (piece?.color === myColor) {
				setSelectedSquare(square);
			}
			return;
		}
		if (piece?.color === myColor) {
			setSelectedSquare(square);
			return;
		}
		const matches = legalMoves.filter((move) => move.to === square);
		if (matches.length === 0) {
			setSelectedSquare(null);
			return;
		}
		const promotionMoves = matches.filter((move) => move.promotion);
		if (promotionMoves.length > 0) {
			const options = PROMOTION_ORDER.filter((pieceSymbol) =>
				promotionMoves.some((move) => move.promotion === pieceSymbol)
			);
			setPromotion({ from: selectedSquare, to: square, options });
			return;
		}
		makeMove(selectedSquare, square);
		setSelectedSquare(null);
	}

	function resign() {
		if (!myColor || state.phase !== 'playing') {
			return;
		}
		onStateChange({
			phase: 'ended',
			result: buildResignationResult(myColor),
			clocks: { ...liveClocks, lastTickAt: 0 },
			drawOffer: null
		});
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.resign);
	}

	function offerOrAnswerDraw(accept = false) {
		if (!currentPlayer || !isParticipant || state.phase !== 'playing') {
			return;
		}
		if (accept && drawOffer && !isSameChessPlayer(drawOffer.offeredBy, currentPlayer)) {
			onStateChange({
				phase: 'ended',
				result: {
					winner: 'draw',
					reason: 'agreement',
					message: 'Draw by agreement'
				},
				clocks: { ...liveClocks, lastTickAt: 0 },
				drawOffer: null
			});
			onNotification(CHESS_NOTIFICATION_SOUND_IDS.draw);
			return;
		}
		onStateChange({
			drawOffer: {
				offeredBy: currentPlayer,
				offeredAt: getNowMs()
			}
		});
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.draw);
	}

	function declineDraw() {
		if (!canAnswerDrawOffer) {
			return;
		}
		onStateChange({ drawOffer: null });
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.closeCancel);
	}

	function requestClose() {
		if (!currentPlayer || !isParticipant) {
			return;
		}
		const players = [state.white, state.black].filter(Boolean);
		if (players.length < 2) {
			onStateChange({ open: false, closeRequest: null });
			return;
		}
		const now = getNowMs();
		onStateChange({
			closeRequest: {
				requestedBy: currentPlayer,
				requestedAt: now,
				expiresAt: now + CLOSE_CONFIRMATION_MS
			}
		});
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.closeRequest);
	}

	function confirmClose() {
		if (!closeResponder) {
			return;
		}
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.closeConfirm);
		onStateChange({ open: false, closeRequest: null });
	}

	function cancelClose() {
		if (!closeResponder) {
			return;
		}
		onStateChange({ closeRequest: null });
		onNotification(CHESS_NOTIFICATION_SOUND_IDS.closeCancel);
	}

	if (!state.open || !layoutReady) {
		return null;
	}

	return (
		<div
			ref={panelRef}
			data-chess-tab={state.id}
			data-collapsed={panelCollapsed ? 'true' : 'false'}
			className={`fixed flex min-w-[760px] overflow-hidden rounded-lg border border-border bg-background shadow-2xl ${
				panelCollapsed ? 'min-h-11' : 'min-h-[540px]'
			}`}
			onFocusCapture={bringToFront}
			onPointerDownCapture={bringToFront}
			style={{
				left: layout.x,
				top: layout.y,
				width: layout.width,
				height: panelCollapsed ? COLLAPSED_HEIGHT : layout.height,
				zIndex
			}}
		>
			<div className="flex min-h-0 w-full flex-col">
				<div
					className="flex h-11 shrink-0 cursor-move items-center gap-2 border-b bg-muted/65 px-2"
					onPointerDown={handleDragStart}
					onPointerMove={handleDragMove}
					onPointerUp={handleDragEnd}
					onPointerCancel={handleDragEnd}
				>
					<IconGripVertical className="shrink-0 text-muted-foreground" size={18} stroke={2} />
					<IconChess className="shrink-0 text-foreground" size={20} stroke={2} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-bold">Chess</div>
						<div className="truncate text-[11px] font-medium text-muted-foreground">
							{currentStatus}
						</div>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={toggleCollapsed}
						aria-label={panelCollapsed ? 'Expand chess tab' : 'Collapse chess tab'}
						aria-expanded={!panelCollapsed}
					>
						{panelCollapsed ? (
							<IconChevronDown size={17} stroke={2} />
						) : (
							<IconChevronUp size={17} stroke={2} />
						)}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={requestClose}
						disabled={!isParticipant || Boolean(closeRequest)}
						aria-label="Close chess tab"
					>
						<IconX size={17} stroke={2} />
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3" aria-hidden={panelCollapsed}>
					<div
						className={
							state.phase === 'setup'
								? 'mx-auto grid min-h-full w-full max-w-2xl content-start gap-3'
								: 'grid min-h-full min-w-[720px] grid-cols-[minmax(0,1fr)_260px] gap-3'
						}
					>
						{state.phase === 'setup' ? null : (
							<div className="flex min-w-0 flex-col gap-2">
								<div className="grid grid-cols-2 gap-2">
									<div
										className={`rounded-md border bg-background px-3 py-2 ${
											activeColor === 'b' && state.phase === 'playing' ? 'border-primary' : ''
										}`}
									>
										<div className="truncate text-sm font-semibold">{playerLabel(state.black)}</div>
										<div className="mt-1 flex items-center gap-1 text-xs font-bold text-muted-foreground">
											<IconClock size={14} stroke={2} />
											{state.settings.timed ? formatClock(liveClocks.b) : 'Untimed'}
										</div>
									</div>
									<div
										className={`rounded-md border bg-background px-3 py-2 ${
											activeColor === 'w' && state.phase === 'playing' ? 'border-primary' : ''
										}`}
									>
										<div className="truncate text-sm font-semibold">{playerLabel(state.white)}</div>
										<div className="mt-1 flex items-center gap-1 text-xs font-bold text-muted-foreground">
											<IconClock size={14} stroke={2} />
											{state.settings.timed ? formatClock(liveClocks.w) : 'Untimed'}
										</div>
									</div>
								</div>

								<div
									data-chess-board="true"
									className={`grid aspect-square w-full shrink-0 grid-cols-8 overflow-hidden rounded-md border ${theme.border}`}
								>
									{squares.map((square) => {
										const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number]);
										const rankIndex = Number(square[1]) - 1;
										const isLight = (fileIndex + rankIndex) % 2 === 0;
										const piece = game.get(square);
										const selected = selectedSquare === square;
										const legal = legalTargets.has(square);
										const pieceAsset = piece
											? getPieceAsset(
													piece.color as ChessColor,
													piece.type,
													state.settings.pieceSet
												)
											: '';
										return (
											<button
												key={square}
												type="button"
												className={`relative flex aspect-square min-h-0 min-w-0 items-center justify-center ${
													isLight ? theme.light : theme.dark
												} ${!isMyTurn || closeRequest ? 'cursor-default' : 'cursor-pointer'}`}
												onClick={() => handleSquareClick(square)}
												aria-disabled={!isMyTurn || Boolean(closeRequest)}
												aria-label={square}
											>
												{selected ? (
													<span className="absolute inset-1 rounded bg-primary/30" />
												) : null}
												{legal ? (
													<span
														className={`absolute rounded-full ${piece ? 'inset-2 border-4 border-primary/55' : `h-3 w-3 ${theme.accent}`}`}
													/>
												) : null}
												{piece ? (
													<Image
														src={pieceAsset}
														alt={`${pieceColorName(piece.color as ChessColor)} ${PIECE_ASSET_NAMES[piece.type]}`}
														width={96}
														height={96}
														unoptimized
														draggable={false}
														className="relative z-10 h-[84%] w-[84%] select-none object-contain drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
													/>
												) : null}
												<span
													className={`absolute bottom-1 right-1 text-[10px] font-bold ${
														isLight ? 'text-black/35' : 'text-white/55'
													}`}
												>
													{orientation === 'w'
														? square === `${square[0]}1`
															? square[0]
															: ''
														: square === `${square[0]}8`
															? square[0]
															: ''}
												</span>
											</button>
										);
									})}
								</div>

								<div className="rounded-md border bg-background px-3 py-2 text-sm font-semibold">
									{currentStatus}
								</div>
							</div>
						)}

						<div
							className={
								state.phase === 'setup' ? 'grid content-start gap-3' : 'flex min-h-0 flex-col gap-3'
							}
						>
							{state.phase === 'setup' ? (
								<div className="flex flex-col gap-3">
									<div className="rounded-md border bg-background p-4">
										<div className="flex items-center justify-between gap-3">
											<div className="min-w-0">
												<div className="text-base font-bold">Game Setup</div>
												<div className="text-xs font-semibold text-muted-foreground">
													{state.white && state.black
														? 'Ready to start'
														: 'Waiting for two players'}
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-1">
												{(['k', 'q', 'n'] as PieceSymbol[]).map((piece) => (
													<Image
														key={piece}
														src={getPieceAsset(
															piece === 'n' ? 'b' : 'w',
															piece,
															state.settings.pieceSet
														)}
														alt=""
														width={64}
														height={64}
														unoptimized
														draggable={false}
														className="h-10 w-10 object-contain drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
													/>
												))}
											</div>
										</div>
									</div>

									<div className="grid gap-2">
										<SeatButton
											color="w"
											player={state.white}
											currentPlayer={currentPlayer}
											disabled={!currentPlayer}
											onJoin={() => joinSeat('w')}
											onLeave={leaveSeat}
										/>
										<SeatButton
											color="b"
											player={state.black}
											currentPlayer={currentPlayer}
											disabled={!currentPlayer}
											onJoin={() => joinSeat('b')}
											onLeave={leaveSeat}
										/>
										<Button
											type="button"
											variant="outline"
											className="h-9 gap-2"
											onClick={swapSeats}
											disabled={!state.white && !state.black}
										>
											<IconRefresh size={17} stroke={2} />
											Swap
										</Button>
									</div>

									<div className="grid gap-2 rounded-md border bg-background p-3">
										<ChessSelect
											label="Board"
											value={state.settings.boardTheme}
											onChange={(event) =>
												updateSettings({ boardTheme: event.target.value as ChessBoardTheme })
											}
										>
											<option value="green">Green</option>
											<option value="blue">Blue</option>
											<option value="walnut">Walnut</option>
										</ChessSelect>
										<ChessSelect
											label="Pieces"
											value={state.settings.pieceSet}
											onChange={(event) => updatePieceSet(event.target.value as ChessPieceSet)}
										>
											{CHESS_PIECE_SET_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</ChessSelect>
										<ChessCheckbox
											label="Timed"
											checked={state.settings.timed}
											onChange={(checked) => updateSettings({ timed: checked })}
										/>
										<div className="grid grid-cols-2 gap-2">
											<ChessSelect
												label="Minutes"
												value={state.settings.minutes}
												disabled={!state.settings.timed}
												onChange={(event) =>
													updateSettings({ minutes: Number(event.target.value) })
												}
											>
												{[1, 3, 5, 10, 15, 30, 60].map((minutes) => (
													<option key={minutes} value={minutes}>
														{minutes}
													</option>
												))}
											</ChessSelect>
											<ChessSelect
												label="Increment"
												value={state.settings.incrementSeconds}
												disabled={!state.settings.timed}
												onChange={(event) =>
													updateSettings({ incrementSeconds: Number(event.target.value) })
												}
											>
												{[0, 1, 2, 5, 10, 30].map((seconds) => (
													<option key={seconds} value={seconds}>
														{seconds}s
													</option>
												))}
											</ChessSelect>
										</div>
									</div>

									<Button
										type="button"
										className="h-10 gap-2"
										onClick={startGame}
										disabled={!canStartGame}
									>
										<IconPlayerPlayFilled size={17} />
										Start
									</Button>
								</div>
							) : (
								<div className="flex min-h-0 flex-1 flex-col gap-3">
									<div className="rounded-md border bg-background p-3">
										<ChessSelect
											label="Pieces"
											value={state.settings.pieceSet}
											onChange={(event) => updatePieceSet(event.target.value as ChessPieceSet)}
										>
											{CHESS_PIECE_SET_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</ChessSelect>
									</div>
									<div className="grid gap-2">
										{state.phase === 'playing' ? (
											<>
												<Button
													type="button"
													variant="outline"
													className="h-9 gap-2"
													onClick={() => offerOrAnswerDraw(canAnswerDrawOffer)}
													disabled={!isParticipant || Boolean(drawOffer && !canAnswerDrawOffer)}
												>
													<IconScale size={17} stroke={2} />
													{canAnswerDrawOffer
														? 'Accept Draw'
														: drawOffer
															? 'Draw Offered'
															: 'Offer Draw'}
												</Button>
												{canAnswerDrawOffer ? (
													<Button
														type="button"
														variant="ghost"
														className="h-9 gap-2"
														onClick={declineDraw}
													>
														<IconCircleX size={17} stroke={2} />
														Decline
													</Button>
												) : null}
												<Button
													type="button"
													variant="destructive"
													className="h-9 gap-2"
													onClick={resign}
													disabled={!isParticipant}
												>
													<IconFlag size={17} stroke={2} />
													Resign
												</Button>
											</>
										) : (
											<Button
												type="button"
												variant="outline"
												className="h-9 gap-2"
												onClick={resetGame}
												disabled={!isParticipant}
											>
												<IconRefresh size={17} stroke={2} />
												New Game
											</Button>
										)}
									</div>

									<div
										data-chess-moves="true"
										className="min-h-0 flex-1 overflow-auto rounded-md border bg-background"
									>
										<div className="sticky top-0 border-b bg-background px-3 py-2 text-sm font-bold">
											Moves
										</div>
										{state.moves.length === 0 ? (
											<div className="px-3 py-6 text-center text-sm font-medium text-muted-foreground">
												No moves yet
											</div>
										) : (
											<div className="grid gap-1 px-3 py-2 text-sm">
												{Array.from({ length: Math.ceil(state.moves.length / 2) }, (_, index) => {
													const whiteMove = state.moves[index * 2];
													const blackMove = state.moves[index * 2 + 1];
													return (
														<div
															key={`${index}-${whiteMove?.from ?? 'move'}`}
															className="grid grid-cols-[3rem_1fr_1fr] gap-x-2"
														>
															<div className="py-1 text-xs font-bold text-muted-foreground">
																{index + 1}.
															</div>
															<div className="rounded px-1 py-1 font-semibold">
																{whiteMove?.san || ''}
															</div>
															<div className="rounded px-1 py-1 font-semibold">
																{blackMove?.san || ''}
															</div>
														</div>
													);
												})}
											</div>
										)}
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{promotion ? (
				<div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
					<div className="grid gap-3 rounded-lg border bg-background p-4 shadow-xl">
						<div className="text-sm font-bold">Promote pawn</div>
						<div className="grid grid-cols-4 gap-2">
							{promotion.options.map((piece) => (
								<Button
									key={piece}
									type="button"
									variant="outline"
									className="h-14 w-14 p-1"
									onClick={() => {
										makeMove(promotion.from, promotion.to, piece);
										setPromotion(null);
										setSelectedSquare(null);
									}}
								>
									<Image
										src={getPieceAsset(myColor ?? 'w', piece, state.settings.pieceSet)}
										alt={PIECE_ASSET_NAMES[piece]}
										width={64}
										height={64}
										unoptimized
										draggable={false}
										className="h-full w-full object-contain"
									/>
								</Button>
							))}
						</div>
					</div>
				</div>
			) : null}

			{closeRequest ? (
				<div className="absolute inset-0 z-30 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
					<div className="grid max-w-sm gap-3 rounded-lg border bg-background p-4 text-center shadow-xl">
						<IconCrown className="mx-auto text-muted-foreground" size={28} stroke={2} />
						<div className="text-base font-bold">Close chess tab?</div>
						<div className="text-sm font-medium text-muted-foreground">
							{closeRequest.requestedBy.name} requested to close this tab. Auto confirms in{' '}
							{closeSecondsLeft}s.
						</div>
						{closeResponder ? (
							<div className="grid grid-cols-2 gap-2">
								<Button type="button" variant="outline" className="gap-2" onClick={cancelClose}>
									<IconCircleX size={17} stroke={2} />
									Cancel
								</Button>
								<Button type="button" className="gap-2" onClick={confirmClose}>
									<IconCircleCheck size={17} stroke={2} />
									Confirm
								</Button>
							</div>
						) : (
							<div className="flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground">
								<IconHeartHandshake size={15} stroke={2} />
								Waiting for the other player
							</div>
						)}
					</div>
				</div>
			) : null}

			{panelCollapsed ? null : (
				<>
					<div
						className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
						onPointerDown={(event) => handleResizeStart(event, 'top-left')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
					<div
						className="absolute right-0 top-0 z-10 h-4 w-4 cursor-nesw-resize touch-none"
						onPointerDown={(event) => handleResizeStart(event, 'top-right')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
					<div
						className="absolute bottom-0 left-0 h-4 w-4 cursor-nesw-resize touch-none"
						onPointerDown={(event) => handleResizeStart(event, 'bottom-left')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
					<div
						className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
						onPointerDown={(event) => handleResizeStart(event, 'bottom-right')}
						onPointerMove={handleResizeMove}
						onPointerUp={handleResizeEnd}
						onPointerCancel={handleResizeEnd}
						aria-hidden="true"
					/>
				</>
			)}
		</div>
	);
}
