'use client';

import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import {
	IconArrowsDiagonal,
	IconChess,
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
import { Button } from '@/components/ui/button';

type ChessTabLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type ChessFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: ChessTabSyncState;
	currentPlayer: ChessPlayerSyncState | null;
	onStateChange: (patch: Partial<ChessTabSyncState>) => void;
};

type PromotionChoice = {
	from: Square;
	to: Square;
	options: PieceSymbol[];
};

const MIN_WIDTH = 420;
const MIN_HEIGHT = 540;
const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 680;
const CLOSE_CONFIRMATION_MS = 60_000;
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;
const PROMOTION_ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n'];

const PIECE_GLYPHS: Record<ChessPieceSet, Record<Color, Record<PieceSymbol, string>>> = {
	classic: {
		w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
		b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
	},
	letters: {
		w: { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' },
		b: { k: 'k', q: 'q', r: 'r', b: 'b', n: 'n', p: 'p' }
	},
	neo: {
		w: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
		b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
	}
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

function clampLayout(layout: ChessTabLayout): ChessTabLayout {
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
	return {
		x: Math.min(Math.max(8, layout.x), Math.max(8, window.innerWidth - width - 8)),
		y: Math.min(Math.max(8, layout.y), Math.max(8, window.innerHeight - height - 8)),
		width,
		height
	};
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

function playerLabel(player: ChessPlayerSyncState | null | undefined) {
	return player?.name || 'Open seat';
}

function colorName(color: ChessColor) {
	return color === 'w' ? 'White' : 'Black';
}

function otherColor(color: ChessColor): ChessColor {
	return color === 'w' ? 'b' : 'w';
}

function getPlayerColor(
	tab: ChessTabSyncState,
	playerId: string | null | undefined
): ChessColor | null {
	if (!playerId) {
		return null;
	}
	if (tab.white?.id === playerId) {
		return 'w';
	}
	if (tab.black?.id === playerId) {
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
	const isSelf = Boolean(currentPlayer && player?.id === currentPlayer.id);
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

export function ChessFloatingTab({
	roomId,
	initialIndex = 0,
	state,
	currentPlayer,
	onStateChange
}: ChessFloatingTabProps) {
	const storageKey = `sparkle:chess-tab-layout:${roomId}:${state.id}`;
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
		width: number;
		height: number;
	} | null>(null);
	const [layoutReady, setLayoutReady] = useState(false);
	const [layout, setLayout] = useState<ChessTabLayout>({
		x: 32,
		y: 88,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT
	});
	const [zIndex, setZIndex] = useState(() => ++chessTabZIndexCounter);
	const [selectedSquareState, setSelectedSquare] = useState<Square | null>(null);
	const [promotion, setPromotion] = useState<PromotionChoice | null>(null);
	const [clockNow, setClockNow] = useState(() => getNowMs());

	const game = useMemo(() => buildChessFromMoves(state.moves), [state.moves]);
	const myColor = getPlayerColor(state, currentPlayer?.id);
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
		Boolean(closeRequest && currentPlayer && closeRequest.requestedBy.id !== currentPlayer.id) &&
		isParticipant;
	const closeSecondsLeft = closeRequest
		? Math.max(0, Math.ceil((closeRequest.expiresAt - clockNow) / 1000))
		: 0;
	const drawOffer = state.drawOffer;
	const canAnswerDrawOffer =
		Boolean(drawOffer && currentPlayer && drawOffer.offeredBy.id !== currentPlayer.id) &&
		isParticipant;

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
	}, [activeColor, liveClocks, onStateChange, state.phase, state.result, state.settings.timed]);

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
				const next = clampLayout(typeof updater === 'function' ? updater(current) : updater);
				if (isSameLayout(current, next)) {
					return current;
				}
				saveLayout(next);
				return next;
			});
		},
		[saveLayout]
	);

	const bringToFront = useCallback(() => {
		chessTabZIndexCounter += 1;
		setZIndex(chessTabZIndexCounter);
	}, []);

	useLayoutEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			setLayout(clampLayout(readStoredLayout(storageKey) ?? getDefaultLayout(initialIndex)));
			setLayoutReady(true);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [initialIndex, storageKey]);

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

	function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			width: layout.width,
			height: layout.height
		};
	}

	function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
		const resize = resizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) {
			return;
		}
		updateLayout({
			...layout,
			width: resize.width + event.clientX - resize.startX,
			height: resize.height + event.clientY - resize.startY
		});
	}

	function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
		if (resizeRef.current?.pointerId === event.pointerId) {
			resizeRef.current = null;
		}
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

	function joinSeat(color: ChessColor) {
		if (!currentPlayer || state.phase !== 'setup') {
			return;
		}
		onStateChange({
			white:
				color === 'w' ? currentPlayer : state.white?.id === currentPlayer.id ? null : state.white,
			black:
				color === 'b' ? currentPlayer : state.black?.id === currentPlayer.id ? null : state.black
		});
	}

	function leaveSeat() {
		if (!currentPlayer || state.phase !== 'setup') {
			return;
		}
		onStateChange({
			white: state.white?.id === currentPlayer.id ? null : state.white,
			black: state.black?.id === currentPlayer.id ? null : state.black
		});
	}

	function swapSeats() {
		if (state.phase !== 'setup') {
			return;
		}
		onStateChange({ white: state.black, black: state.white });
	}

	function startGame() {
		if (!state.white || !state.black || !isParticipant) {
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
	}

	function offerOrAnswerDraw(accept = false) {
		if (!currentPlayer || !isParticipant || state.phase !== 'playing') {
			return;
		}
		if (accept && drawOffer && drawOffer.offeredBy.id !== currentPlayer.id) {
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
			return;
		}
		onStateChange({
			drawOffer: {
				offeredBy: currentPlayer,
				offeredAt: getNowMs()
			}
		});
	}

	function declineDraw() {
		if (!canAnswerDrawOffer) {
			return;
		}
		onStateChange({ drawOffer: null });
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
	}

	function confirmClose() {
		if (!closeResponder) {
			return;
		}
		onStateChange({ open: false, closeRequest: null });
	}

	function cancelClose() {
		if (!closeResponder) {
			return;
		}
		onStateChange({ closeRequest: null });
	}

	if (!state.open || !layoutReady) {
		return null;
	}

	return (
		<div
			ref={panelRef}
			data-chess-tab={state.id}
			className="fixed flex min-h-[540px] min-w-[420px] overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
			onFocusCapture={bringToFront}
			onPointerDownCapture={bringToFront}
			style={{
				left: layout.x,
				top: layout.y,
				width: layout.width,
				height: layout.height,
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
						onClick={requestClose}
						disabled={!isParticipant || Boolean(closeRequest)}
						aria-label="Close chess tab"
					>
						<IconX size={17} stroke={2} />
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
					<div className="grid min-h-full gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
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
								className={`grid aspect-square w-full shrink-0 grid-cols-8 overflow-hidden rounded-md border ${theme.border}`}
							>
								{squares.map((square) => {
									const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number]);
									const rankIndex = Number(square[1]) - 1;
									const isLight = (fileIndex + rankIndex) % 2 === 0;
									const piece = game.get(square);
									const selected = selectedSquare === square;
									const legal = legalTargets.has(square);
									const pieceText = piece
										? (PIECE_GLYPHS[state.settings.pieceSet]?.[piece.color]?.[piece.type] ??
											PIECE_GLYPHS.classic[piece.color][piece.type])
										: '';
									return (
										<button
											key={square}
											type="button"
											className={`relative flex aspect-square min-h-0 min-w-0 items-center justify-center text-[2.6rem] font-black leading-none ${
												isLight ? theme.light : theme.dark
											} ${piece?.color === 'w' ? 'text-zinc-50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]' : 'text-zinc-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]'}`}
											onClick={() => handleSquareClick(square)}
											disabled={!isMyTurn || Boolean(closeRequest)}
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
											<span className="relative z-10">{pieceText}</span>
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

						<div className="flex min-h-0 flex-col gap-3">
							{state.phase === 'setup' ? (
								<div className="flex flex-col gap-3">
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
										<label className="grid gap-1 text-xs font-bold text-muted-foreground">
											Pieces
											<select
												value={state.settings.pieceSet}
												onChange={(event) =>
													updateSettings({ pieceSet: event.target.value as ChessPieceSet })
												}
												className="h-9 rounded-md border bg-background px-2 text-sm font-semibold text-foreground"
											>
												<option value="classic">Classic</option>
												<option value="neo">Iconic</option>
												<option value="letters">Letters</option>
											</select>
										</label>
										<label className="grid gap-1 text-xs font-bold text-muted-foreground">
											Board
											<select
												value={state.settings.boardTheme}
												onChange={(event) =>
													updateSettings({ boardTheme: event.target.value as ChessBoardTheme })
												}
												className="h-9 rounded-md border bg-background px-2 text-sm font-semibold text-foreground"
											>
												<option value="green">Green</option>
												<option value="blue">Blue</option>
												<option value="walnut">Walnut</option>
											</select>
										</label>
										<label className="flex items-center justify-between gap-2 text-sm font-semibold">
											Timed
											<input
												type="checkbox"
												checked={state.settings.timed}
												onChange={(event) => updateSettings({ timed: event.target.checked })}
												className="h-4 w-4"
											/>
										</label>
										<div className="grid grid-cols-2 gap-2">
											<label className="grid gap-1 text-xs font-bold text-muted-foreground">
												Minutes
												<select
													value={state.settings.minutes}
													disabled={!state.settings.timed}
													onChange={(event) =>
														updateSettings({ minutes: Number(event.target.value) })
													}
													className="h-9 rounded-md border bg-background px-2 text-sm font-semibold text-foreground disabled:opacity-50"
												>
													{[1, 3, 5, 10, 15, 30, 60].map((minutes) => (
														<option key={minutes} value={minutes}>
															{minutes}
														</option>
													))}
												</select>
											</label>
											<label className="grid gap-1 text-xs font-bold text-muted-foreground">
												Increment
												<select
													value={state.settings.incrementSeconds}
													disabled={!state.settings.timed}
													onChange={(event) =>
														updateSettings({ incrementSeconds: Number(event.target.value) })
													}
													className="h-9 rounded-md border bg-background px-2 text-sm font-semibold text-foreground disabled:opacity-50"
												>
													{[0, 1, 2, 5, 10, 30].map((seconds) => (
														<option key={seconds} value={seconds}>
															{seconds}s
														</option>
													))}
												</select>
											</label>
										</div>
									</div>

									<Button
										type="button"
										className="h-10 gap-2"
										onClick={startGame}
										disabled={!state.white || !state.black || !isParticipant}
									>
										<IconPlayerPlayFilled size={17} />
										Start
									</Button>
								</div>
							) : (
								<div className="flex min-h-0 flex-1 flex-col gap-3">
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

									<div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background">
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
									className="h-12 text-2xl"
									onClick={() => {
										makeMove(promotion.from, promotion.to, piece);
										setPromotion(null);
										setSelectedSquare(null);
									}}
								>
									{PIECE_GLYPHS[state.settings.pieceSet]?.[myColor ?? 'w']?.[piece] ??
										PIECE_GLYPHS.classic[myColor ?? 'w'][piece]}
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

			<div
				className="absolute bottom-0 right-0 flex h-7 w-7 cursor-nwse-resize touch-none items-end justify-end p-1.5 text-muted-foreground/70"
				onPointerDown={handleResizeStart}
				onPointerMove={handleResizeMove}
				onPointerUp={handleResizeEnd}
				onPointerCancel={handleResizeEnd}
				aria-hidden="true"
			>
				<IconArrowsDiagonal size={15} stroke={2} />
			</div>
		</div>
	);
}
