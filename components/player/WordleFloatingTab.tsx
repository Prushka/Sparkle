'use client';

import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import {
	IconBackspace,
	IconChevronDown,
	IconChevronUp,
	IconCornerDownLeft,
	IconGripVertical,
	IconKeyboard,
	IconPlayerPlayFilled,
	IconRefresh,
	IconUserMinus,
	IconUserPlus,
	IconUsers,
	IconX
} from '@tabler/icons-react';
import {
	randomString,
	type WordleBoardSyncState,
	type WordleMode,
	type WordlePlayerSyncState,
	type WordleResultSyncState,
	type WordleRowSyncState,
	type WordleSettingsSyncState,
	type WordleTabSyncState,
	type WordleTileStatus
} from '@/lib/player/t';
import { isValidWordleWord, WORDLE_WORDS } from '@/lib/player/wordleWords';
import { Button } from '@/components/ui/button';

type WordleTabLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type WordleFloatingTabProps = {
	roomId: string;
	initialIndex?: number;
	state: WordleTabSyncState;
	currentPlayer: WordlePlayerSyncState | null;
	onStateChange: (patch: Partial<WordleTabSyncState>) => void;
};

type LocalGuessMap = Record<string, Record<number, string>>;

const WORD_LENGTH = 5;
const DEFAULT_WIDTH = 610;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 304;
const MIN_HEIGHT = 430;
const COLLAPSED_HEIGHT = 44;
const VIEWPORT_MARGIN = 8;
const DEFAULT_TURNS = 6;
const MAX_TURNS = 10;
const KEY_ROWS = [
	['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
	['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
	['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE']
] as const;

let wordleTabZIndexCounter = 160;

type FloatingZIndexWindow = Window & {
	__sparkleFloatingTabZIndex?: number;
};

type WordleTileStyle = CSSProperties & {
	'--wordle-delay'?: string;
};

function nextFloatingTabZIndex() {
	if (typeof window === 'undefined') {
		wordleTabZIndexCounter += 1;
		return wordleTabZIndexCounter;
	}
	const zWindow = window as FloatingZIndexWindow;
	const current = Math.max(zWindow.__sparkleFloatingTabZIndex ?? 160, wordleTabZIndexCounter);
	const next = current + 1;
	zWindow.__sparkleFloatingTabZIndex = next;
	wordleTabZIndexCounter = next;
	return next;
}

function readStoredLayout(storageKey: string): WordleTabLayout | null {
	if (typeof window === 'undefined') {
		return null;
	}
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (!stored) {
			return null;
		}
		const parsed = JSON.parse(stored) as Partial<WordleTabLayout>;
		if (
			typeof parsed.x !== 'number' ||
			typeof parsed.y !== 'number' ||
			typeof parsed.width !== 'number' ||
			typeof parsed.height !== 'number'
		) {
			return null;
		}
		return parsed as WordleTabLayout;
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

function getDefaultLayout(initialIndex = 0): WordleTabLayout {
	if (typeof window === 'undefined') {
		return { x: 40, y: 88, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
	}
	const width = Math.min(
		DEFAULT_WIDTH,
		Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
	);
	const height = Math.min(
		DEFAULT_HEIGHT,
		Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2)
	);
	const offset = initialIndex * 28;
	return {
		x: Math.min(
			Math.max(VIEWPORT_MARGIN, 40 + offset),
			Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
		),
		y: Math.min(
			Math.max(VIEWPORT_MARGIN, 88 + offset),
			Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
		),
		width,
		height
	};
}

function clampLayout(layout: WordleTabLayout, visibleHeight = layout.height): WordleTabLayout {
	if (typeof window === 'undefined') {
		return layout;
	}
	const width = Math.min(
		Math.max(layout.width, MIN_WIDTH),
		Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
	);
	const height = Math.min(
		Math.max(layout.height, MIN_HEIGHT),
		Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2)
	);
	const clampedVisibleHeight = Math.min(visibleHeight, height);
	return {
		x: Math.min(
			Math.max(layout.x, VIEWPORT_MARGIN),
			Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
		),
		y: Math.min(
			Math.max(layout.y, VIEWPORT_MARGIN),
			Math.max(VIEWPORT_MARGIN, window.innerHeight - clampedVisibleHeight - VIEWPORT_MARGIN)
		),
		width,
		height
	};
}

function isSameLayout(a: WordleTabLayout, b: WordleTabLayout) {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function createRows(turns: number): WordleRowSyncState[] {
	return Array.from({ length: turns }, () => ({
		statuses: Array.from({ length: WORD_LENGTH }, () => 'empty' as WordleTileStatus),
		typed: 0,
		submitted: false
	}));
}

function createBoard(turns: number, playerId?: string): WordleBoardSyncState {
	return {
		id: randomString(10),
		...(playerId ? { playerId } : {}),
		rows: createRows(turns),
		currentRow: 0,
		solved: false,
		finished: false,
		finishedAt: 0
	};
}

function getAnswer(answerIndex: number) {
	return WORDLE_WORDS[Math.abs(answerIndex) % WORDLE_WORDS.length] ?? 'CRANE';
}

function hashToAnswerIndex(value: string) {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return hash % WORDLE_WORDS.length;
}

function isSameWordlePlayer(
	left: WordlePlayerSyncState | null | undefined,
	right: WordlePlayerSyncState | null | undefined
) {
	return Boolean(left && right && left.id === right.id);
}

function playerLabel(player: WordlePlayerSyncState | null | undefined) {
	return player?.name || 'Player';
}

function clampTurns(turns: number) {
	return Math.max(1, Math.min(MAX_TURNS, Math.round(turns || DEFAULT_TURNS)));
}

function scoreGuess(guess: string, answer: string): WordleTileStatus[] {
	const statuses: WordleTileStatus[] = Array.from({ length: WORD_LENGTH }, () => 'absent');
	const remaining = new Map<string, number>();

	for (let index = 0; index < WORD_LENGTH; index += 1) {
		const guessLetter = guess[index];
		const answerLetter = answer[index];
		if (guessLetter === answerLetter) {
			statuses[index] = 'correct';
			continue;
		}
		remaining.set(answerLetter, (remaining.get(answerLetter) ?? 0) + 1);
	}

	for (let index = 0; index < WORD_LENGTH; index += 1) {
		if (statuses[index] === 'correct') {
			continue;
		}
		const guessLetter = guess[index];
		const count = remaining.get(guessLetter) ?? 0;
		if (count > 0) {
			statuses[index] = 'present';
			remaining.set(guessLetter, count - 1);
		}
	}

	return statuses;
}

function updateBoardTyped(
	board: WordleBoardSyncState,
	turns: number,
	typed: number,
	playerId?: string
): WordleBoardSyncState {
	if (board.finished || board.currentRow >= turns) {
		return board;
	}
	const rows = [...board.rows];
	const row = rows[board.currentRow] ?? createRows(turns)[board.currentRow];
	rows[board.currentRow] = {
		...row,
		statuses: Array.from({ length: WORD_LENGTH }, (_, index) =>
			index < typed ? 'typed' : 'empty'
		),
		typed,
		submitted: false,
		...(playerId ? { playerId } : {})
	};
	return { ...board, rows };
}

function submitBoardRow(
	board: WordleBoardSyncState,
	turns: number,
	guess: string,
	answerIndex: number,
	playerId?: string
): WordleBoardSyncState {
	const rowIndex = Math.min(board.currentRow, turns - 1);
	const statuses = scoreGuess(guess, getAnswer(answerIndex));
	const solved = statuses.every((status) => status === 'correct');
	const nextRow = Math.min(turns, rowIndex + 1);
	const finished = solved || nextRow >= turns;
	const rows = [...board.rows];
	rows[rowIndex] = {
		statuses,
		typed: WORD_LENGTH,
		submitted: true,
		guess,
		...(playerId ? { playerId } : {})
	};
	return {
		...board,
		rows,
		currentRow: nextRow,
		solved,
		finished,
		finishedAt: finished ? Date.now() : 0
	};
}

function rotateTurn(players: WordlePlayerSyncState[], currentId: string) {
	if (players.length === 0) {
		return '';
	}
	const currentIndex = players.findIndex((player) => player.id === currentId);
	return players[(currentIndex + 1 + players.length) % players.length]?.id ?? players[0].id;
}

function buildCompetitiveResult(
	boards: WordleBoardSyncState[],
	players: WordlePlayerSyncState[]
): WordleResultSyncState | null {
	const playerBoards = players
		.map((player) => boards.find((board) => board.playerId === player.id))
		.filter((board): board is WordleBoardSyncState => Boolean(board));
	if (playerBoards.length === 0 || playerBoards.some((board) => !board.finished)) {
		return null;
	}
	const solved = playerBoards.filter((board) => board.solved);
	if (solved.length === 0) {
		return { winnerIds: [], message: 'No solves' };
	}
	const bestRow = Math.min(...solved.map((board) => board.currentRow));
	const bestBoards = solved.filter((board) => board.currentRow === bestRow);
	const fastestTime = Math.min(
		...bestBoards.map((board) => board.finishedAt || Number.MAX_SAFE_INTEGER)
	);
	const winners = bestBoards.filter(
		(board) => (board.finishedAt || Number.MAX_SAFE_INTEGER) === fastestTime
	);
	const names = winners
		.map((board) => players.find((player) => player.id === board.playerId))
		.filter((player): player is WordlePlayerSyncState => Boolean(player))
		.map((player) => playerLabel(player));
	return {
		winnerIds: winners.map((board) => board.playerId).filter((id): id is string => Boolean(id)),
		message: names.length > 0 ? `${names.join(', ')} win in ${bestRow}` : `Solved in ${bestRow}`
	};
}

function tileClass(status: WordleTileStatus, mini: boolean) {
	const base = mini
		? 'wordle-tile flex aspect-square items-center justify-center border text-[0px] transition-colors duration-200'
		: 'wordle-tile flex aspect-square items-center justify-center border-2 text-[2rem] font-black uppercase leading-none transition-[background-color,border-color,color,transform] duration-200';
	switch (status) {
		case 'correct':
			return `${base} border-[#6aaa64] bg-[#6aaa64] text-white`;
		case 'present':
			return `${base} border-[#c9b458] bg-[#c9b458] text-white`;
		case 'absent':
			return `${base} border-[#787c7e] bg-[#787c7e] text-white`;
		case 'typed':
			return `${base} border-muted-foreground/55 bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--muted-foreground)/0.12)]`;
		default:
			return `${base} border-muted-foreground/35 bg-background text-foreground`;
	}
}

function tileAnimationClass(
	status: WordleTileStatus,
	letter: string,
	submitted: boolean,
	mini: boolean
) {
	if (mini) {
		return '';
	}
	if (submitted && status !== 'empty' && status !== 'typed') {
		return 'wordle-tile-flip';
	}
	if (letter && status === 'typed') {
		return 'wordle-tile-pop';
	}
	return '';
}

function tileAnimationStyle(
	submitted: boolean,
	mini: boolean,
	cellIndex: number
): WordleTileStyle | undefined {
	if (mini || !submitted) {
		return undefined;
	}
	return { '--wordle-delay': `${cellIndex * 85}ms` };
}

function keyClass(status: WordleTileStatus | undefined, wide = false) {
	const base = `flex h-11 min-w-0 ${wide ? 'flex-[2_1_0]' : 'flex-1'} items-center justify-center rounded text-xs font-black uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50`;
	switch (status) {
		case 'correct':
			return `${base} bg-[#6aaa64] text-white`;
		case 'present':
			return `${base} bg-[#c9b458] text-white`;
		case 'absent':
			return `${base} bg-[#787c7e] text-white`;
		default:
			return `${base} bg-muted text-foreground hover:bg-muted/80`;
	}
}

function boardFailed(board: WordleBoardSyncState, turns: number) {
	return board.finished && !board.solved && board.currentRow >= turns;
}

function readLocalGuesses(storageKey: string): LocalGuessMap {
	if (typeof window === 'undefined' || !storageKey) {
		return {};
	}
	try {
		const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as LocalGuessMap;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		return parsed;
	} catch {
		return {};
	}
}

function saveLocalGuesses(storageKey: string, guesses: LocalGuessMap) {
	if (typeof window === 'undefined' || !storageKey) {
		return;
	}
	window.localStorage.setItem(storageKey, JSON.stringify(guesses));
}

export function WordleFloatingTab({
	roomId,
	initialIndex = 0,
	state,
	currentPlayer,
	onStateChange
}: WordleFloatingTabProps) {
	const storageKey = `sparkle:wordle-tab-layout:${roomId}:${state.id}`;
	const collapsedStorageKey = `sparkle:wordle-tab-collapsed:${roomId}:${state.id}`;
	const localGuessStorageKey = currentPlayer
		? `sparkle:wordle-guesses:${roomId}:${state.id}:${currentPlayer.id}`
		: '';
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
	const dragCleanupRef = useRef<(() => void) | null>(null);
	const resizeCleanupRef = useRef<(() => void) | null>(null);
	const [layoutReady, setLayoutReady] = useState(false);
	const [layout, setLayout] = useState<WordleTabLayout>({
		x: 40,
		y: 88,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT
	});
	const [zIndex, setZIndex] = useState(nextFloatingTabZIndex);
	const [collapsed, setCollapsed] = useState(false);
	const [draft, setDraft] = useState('');
	const [message, setMessage] = useState('');
	const [localGuesses, setLocalGuesses] = useState<LocalGuessMap>({});

	const turns = clampTurns(state.settings.turns);
	const isParticipant = Boolean(
		currentPlayer && state.players.some((player) => isSameWordlePlayer(player, currentPlayer))
	);
	const activePlayer = state.players.find((player) => player.id === state.turnPlayerId) ?? null;
	const myBoard =
		currentPlayer && state.settings.mode === 'competitive'
			? (state.boards.find((board) => board.playerId === currentPlayer.id) ?? null)
			: null;
	const coopActiveBoard =
		state.settings.mode === 'coop'
			? (state.boards.find((board) => board.id === state.activeBoardId) ??
				state.boards.at(-1) ??
				null)
			: null;
	const activeBoard = state.settings.mode === 'competitive' ? myBoard : coopActiveBoard;
	const canType = Boolean(
		currentPlayer &&
		isParticipant &&
		state.phase === 'playing' &&
		activeBoard &&
		!activeBoard.finished &&
		(state.settings.mode === 'competitive' || state.turnPlayerId === currentPlayer.id)
	);
	const panelCollapsed = collapsed;
	const compactLayout = !panelCollapsed && layout.width < 560;
	const activeRowKey = activeBoard ? `${activeBoard.id}:${activeBoard.currentRow}` : '';
	function answerIndexForBoard(board: WordleBoardSyncState | null | undefined) {
		const base = hashToAnswerIndex(`${state.id}:${state.startedAt || 'setup'}`);
		if (state.settings.mode !== 'coop' || !board) {
			return base;
		}
		return (
			base +
			Math.max(
				0,
				state.boards.findIndex((candidate) => candidate.id === board.id)
			)
		);
	}
	const activeAnswerIndex = answerIndexForBoard(activeBoard);
	const headerStatus = useMemo(() => {
		const mode = state.settings.mode === 'coop' ? 'Coop' : 'Competitive';
		if (state.phase === 'setup') {
			return `${mode} / ${state.players.length} players / ${turns} turns`;
		}
		if (state.settings.mode === 'coop') {
			const boardNumber = Math.max(
				1,
				state.boards.findIndex((board) => board.id === state.activeBoardId) + 1
			);
			return `${mode} / ${playerLabel(activePlayer)} turn / board ${boardNumber}`;
		}
		if (state.result) {
			return `${mode} / ${state.result.message || 'Complete'}`;
		}
		const progress = myBoard ? `${Math.min(myBoard.currentRow + 1, turns)}/${turns}` : `0/${turns}`;
		return `${mode} / ${state.players.length} players / ${progress}`;
	}, [
		activePlayer,
		myBoard,
		state.activeBoardId,
		state.boards,
		state.phase,
		state.players.length,
		state.result,
		state.settings.mode,
		turns
	]);

	useEffect(() => {
		return () => {
			dragCleanupRef.current?.();
			resizeCleanupRef.current?.();
		};
	}, []);

	useLayoutEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			const storedCollapsed = readStoredCollapsed(collapsedStorageKey);
			setLayout(
				clampLayout(
					readStoredLayout(storageKey) ?? getDefaultLayout(initialIndex),
					storedCollapsed ? COLLAPSED_HEIGHT : undefined
				)
			);
			setCollapsed(storedCollapsed);
			setLayoutReady(true);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [collapsedStorageKey, initialIndex, storageKey]);

	useEffect(() => {
		setDraft('');
	}, [activeRowKey]);

	useEffect(() => {
		setDraft('');
		setMessage('');
	}, [activeBoard?.id, state.id, state.phase, state.startedAt]);

	useEffect(() => {
		setLocalGuesses(readLocalGuesses(localGuessStorageKey));
	}, [localGuessStorageKey]);

	const saveLayout = useCallback(
		(next: WordleTabLayout) => {
			if (typeof window === 'undefined') {
				return;
			}
			window.localStorage.setItem(storageKey, JSON.stringify(next));
		},
		[storageKey]
	);

	const updateLayout = useCallback(
		(updater: WordleTabLayout | ((current: WordleTabLayout) => WordleTabLayout)) => {
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

	useEffect(() => {
		if (!state.open) {
			return;
		}
		const handleResize = () => updateLayout((current) => current);
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [state.open, updateLayout]);

	function bringToFront() {
		setZIndex(nextFloatingTabZIndex());
	}

	function toggleCollapsed() {
		const nextCollapsed = !collapsed;
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(collapsedStorageKey, String(nextCollapsed));
		}
		setCollapsed(nextCollapsed);
		updateLayout((current) => current);
	}

	function focusPanel() {
		panelRef.current?.focus({ preventScroll: true });
	}

	function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: layout.x,
			y: layout.y
		};
		dragCleanupRef.current?.();
		const handleMove = (moveEvent: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== moveEvent.pointerId) {
				return;
			}
			updateLayout({
				...layout,
				x: drag.x + moveEvent.clientX - drag.startX,
				y: drag.y + moveEvent.clientY - drag.startY
			});
		};
		const handleEnd = (endEvent: PointerEvent) => {
			if (dragRef.current?.pointerId === endEvent.pointerId) {
				dragRef.current = null;
				dragCleanupRef.current?.();
				dragCleanupRef.current = null;
			}
		};
		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleEnd);
		window.addEventListener('pointercancel', handleEnd);
		dragCleanupRef.current = () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleEnd);
			window.removeEventListener('pointercancel', handleEnd);
		};
	}

	function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			width: layout.width,
			height: layout.height
		};
		resizeCleanupRef.current?.();
		const handleMove = (moveEvent: PointerEvent) => {
			const resize = resizeRef.current;
			if (!resize || resize.pointerId !== moveEvent.pointerId) {
				return;
			}
			updateLayout({
				...layout,
				width: resize.width + moveEvent.clientX - resize.startX,
				height: resize.height + moveEvent.clientY - resize.startY
			});
		};
		const handleEnd = (endEvent: PointerEvent) => {
			if (resizeRef.current?.pointerId === endEvent.pointerId) {
				resizeRef.current = null;
				resizeCleanupRef.current?.();
				resizeCleanupRef.current = null;
			}
		};
		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleEnd);
		window.addEventListener('pointercancel', handleEnd);
		resizeCleanupRef.current = () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleEnd);
			window.removeEventListener('pointercancel', handleEnd);
		};
	}

	function setLocalGuess(boardId: string, rowIndex: number, guess: string) {
		setLocalGuesses((current) => {
			const next = {
				...current,
				[boardId]: {
					...(current[boardId] ?? {}),
					[rowIndex]: guess
				}
			};
			saveLocalGuesses(localGuessStorageKey, next);
			return next;
		});
	}

	function patchBoard(board: WordleBoardSyncState) {
		onStateChange({
			boards: state.boards.map((candidate) => (candidate.id === board.id ? board : candidate))
		});
	}

	function syncDraft(nextDraft: string) {
		if (!canType || !activeBoard || !currentPlayer) {
			return;
		}
		if (message) {
			setMessage('');
		}
		setDraft(nextDraft);
		patchBoard(
			updateBoardTyped(
				activeBoard,
				turns,
				nextDraft.length,
				state.settings.mode === 'coop' ? currentPlayer.id : activeBoard.playerId
			)
		);
	}

	function submitGuess() {
		if (!canType || !activeBoard || !currentPlayer) {
			return;
		}
		if (draft.length !== WORD_LENGTH) {
			setMessage('Not enough letters');
			return;
		}
		if (!/^[A-Z]{5}$/.test(draft)) {
			setMessage('Letters only');
			return;
		}
		if (!isValidWordleWord(draft)) {
			setMessage('Not in word list');
			return;
		}

		const submitted = submitBoardRow(
			activeBoard,
			turns,
			draft,
			activeAnswerIndex,
			state.settings.mode === 'coop' ? currentPlayer.id : activeBoard.playerId
		);
		setLocalGuess(activeBoard.id, activeBoard.currentRow, draft);
		setDraft('');
		setMessage(
			submitted.solved
				? 'Solved'
				: boardFailed(submitted, turns)
					? getAnswer(activeAnswerIndex)
					: ''
		);

		if (state.settings.mode === 'competitive') {
			const nextBoards = state.boards.map((board) =>
				board.id === activeBoard.id ? submitted : board
			);
			const result = buildCompetitiveResult(nextBoards, state.players);
			onStateChange({
				boards: nextBoards,
				phase: result ? 'ended' : state.phase,
				result
			});
			return;
		}

		const nextBoards = state.boards.map((board) =>
			board.id === activeBoard.id ? submitted : board
		);
		let activeBoardId = activeBoard.id;
		if (submitted.finished) {
			const nextBoard = createBoard(turns);
			nextBoards.push(nextBoard);
			activeBoardId = nextBoard.id;
		}
		onStateChange({
			boards: nextBoards,
			activeBoardId,
			turnPlayerId: rotateTurn(state.players, currentPlayer.id),
			result: null
		});
	}

	function handleKeyInput(key: string) {
		if (!canType) {
			return;
		}
		if (key === 'ENTER') {
			submitGuess();
			return;
		}
		if (key === 'BACKSPACE') {
			syncDraft(draft.slice(0, -1));
			return;
		}
		if (/^[A-Z]$/.test(key) && draft.length < WORD_LENGTH) {
			syncDraft(`${draft}${key}`);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		const key = event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase();
		if (key === 'ENTER' || key === 'BACKSPACE' || /^[A-Z]$/.test(key)) {
			event.preventDefault();
			handleKeyInput(key);
		}
	}

	function addOrReplacePlayer(players: WordlePlayerSyncState[], player: WordlePlayerSyncState) {
		return [...players.filter((candidate) => candidate.id !== player.id), player];
	}

	function joinGame() {
		if (!currentPlayer || state.phase !== 'setup') {
			return;
		}
		const players = addOrReplacePlayer(state.players, currentPlayer);
		const patch: Partial<WordleTabSyncState> = { players };
		if (state.settings.mode === 'coop' && !state.turnPlayerId) {
			patch.turnPlayerId = players[0]?.id ?? '';
		}
		onStateChange(patch);
	}

	function leaveGame() {
		if (!currentPlayer || !isParticipant || state.phase !== 'setup') {
			return;
		}
		const players = state.players.filter((player) => player.id !== currentPlayer.id);
		const nextBoards =
			state.settings.mode === 'competitive'
				? state.boards.filter((board) => board.playerId !== currentPlayer.id)
				: state.boards;
		const patch: Partial<WordleTabSyncState> = {
			players,
			boards: nextBoards,
			turnPlayerId:
				state.turnPlayerId === currentPlayer.id
					? rotateTurn(players, currentPlayer.id)
					: state.turnPlayerId
		};
		if (players.length === 0) {
			patch.phase = 'setup';
			patch.boards = [];
			patch.activeBoardId = '';
			patch.turnPlayerId = '';
			patch.result = null;
		}
		onStateChange(patch);
	}

	function updateSettings(patch: Partial<WordleSettingsSyncState>) {
		if (!isParticipant || state.phase !== 'setup') {
			return;
		}
		onStateChange({
			settings: {
				...state.settings,
				...patch,
				turns: clampTurns(patch.turns ?? state.settings.turns)
			}
		});
	}

	function startGame() {
		if (!isParticipant || state.players.length === 0) {
			return;
		}
		setDraft('');
		setMessage('');
		const startedAt = Date.now();
		if (state.settings.mode === 'competitive') {
			const boards = state.players.map((player) => createBoard(turns, player.id));
			onStateChange({
				phase: 'playing',
				boards,
				activeBoardId: '',
				turnPlayerId: '',
				startedAt,
				result: null
			});
			return;
		}
		const board = createBoard(turns);
		onStateChange({
			phase: 'playing',
			boards: [board],
			activeBoardId: board.id,
			turnPlayerId: state.players[0]?.id ?? '',
			startedAt,
			result: null
		});
	}

	function newGame() {
		if (!isParticipant) {
			return;
		}
		setDraft('');
		setMessage('');
		onStateChange({
			phase: 'setup',
			boards: [],
			activeBoardId: '',
			turnPlayerId: '',
			startedAt: 0,
			result: null
		});
	}

	function closeTab() {
		if (!isParticipant) {
			return;
		}
		onStateChange({ open: false });
	}

	function rowLetters(board: WordleBoardSyncState, rowIndex: number, row: WordleRowSyncState) {
		if (!currentPlayer) {
			return '';
		}
		if (
			canType &&
			activeBoard?.id === board.id &&
			rowIndex === board.currentRow &&
			!row.submitted
		) {
			return draft;
		}
		if (row.playerId === currentPlayer.id || board.playerId === currentPlayer.id) {
			return localGuesses[board.id]?.[rowIndex] ?? '';
		}
		return '';
	}

	function keyboardStatuses() {
		const statuses: Record<string, WordleTileStatus> = {};
		if (!activeBoard) {
			return statuses;
		}
		const rank: Record<WordleTileStatus, number> = {
			empty: 0,
			typed: 0,
			absent: 1,
			present: 2,
			correct: 3
		};
		for (const [rowIndexText, guess] of Object.entries(localGuesses[activeBoard.id] ?? {})) {
			const row = activeBoard.rows[Number(rowIndexText)];
			if (!row?.submitted) {
				continue;
			}
			for (let index = 0; index < WORD_LENGTH; index += 1) {
				const letter = guess[index];
				const status = row.statuses[index] ?? 'empty';
				if (!letter || rank[status] <= rank[statuses[letter] ?? 'empty']) {
					continue;
				}
				statuses[letter] = status;
			}
		}
		return statuses;
	}

	function renderBoard(board: WordleBoardSyncState, mini = false) {
		return (
			<div
				key={board.id}
				className={mini ? 'grid w-full gap-1' : 'mx-auto grid w-full max-w-[330px] gap-[5px]'}
			>
				{board.rows.slice(0, turns).map((row, rowIndex) => {
					const letters = rowLetters(board, rowIndex, row);
					return (
						<div
							key={`${board.id}-${rowIndex}`}
							className={mini ? 'grid grid-cols-5 gap-1' : 'grid grid-cols-5 gap-[5px]'}
						>
							{Array.from({ length: WORD_LENGTH }, (_, cellIndex) => {
								const status = row.statuses[cellIndex] ?? 'empty';
								const letter = letters[cellIndex] ?? '';
								const animationClass = tileAnimationClass(status, letter, row.submitted, mini);
								return (
									<div
										key={cellIndex}
										className={`${tileClass(status, mini)} ${animationClass}`}
										style={tileAnimationStyle(row.submitted, mini, cellIndex)}
										aria-label={letter ? `Letter ${cellIndex + 1}` : `Cell ${cellIndex + 1}`}
									>
										{mini ? null : letter}
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		);
	}

	const keyStatuses = keyboardStatuses();
	const keyboard = (
		<div className="grid w-full gap-1 rounded-md border bg-background p-2">
			{KEY_ROWS.map((row) => (
				<div key={row.join('')} className="mx-auto flex w-full max-w-[500px] justify-center gap-1">
					{row.map((key) => (
						<button
							key={key}
							type="button"
							className={keyClass(key.length === 1 ? keyStatuses[key] : undefined, key.length > 1)}
							disabled={!canType}
							onClick={() => handleKeyInput(key)}
							aria-label={key === 'BACKSPACE' ? 'Backspace' : key === 'ENTER' ? 'Enter' : key}
						>
							{key === 'BACKSPACE' ? (
								<IconBackspace size={18} stroke={2} />
							) : key === 'ENTER' ? (
								<IconCornerDownLeft size={18} stroke={2} />
							) : (
								key
							)}
						</button>
					))}
				</div>
			))}
		</div>
	);

	if (!state.open || !layoutReady) {
		return null;
	}

	return (
		<div
			ref={panelRef}
			data-wordle-tab={state.id}
			tabIndex={0}
			className={`fixed flex min-w-0 overflow-hidden rounded-lg border border-border bg-background shadow-2xl outline-none ${
				panelCollapsed ? 'min-h-11' : 'min-h-0'
			}`}
			onFocusCapture={bringToFront}
			onPointerDownCapture={bringToFront}
			onKeyDown={handleKeyDown}
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
					className="flex h-11 shrink-0 cursor-move touch-none select-none items-center gap-2 border-b bg-muted/65 px-2"
					onPointerDown={handleDragStart}
				>
					<IconGripVertical className="shrink-0 text-muted-foreground" size={18} stroke={2} />
					<IconKeyboard className="shrink-0 text-foreground" size={20} stroke={2} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-bold">Wordle</div>
						<div className="truncate text-[11px] font-medium text-muted-foreground">
							{headerStatus}
						</div>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={toggleCollapsed}
						aria-label={panelCollapsed ? 'Expand Wordle tab' : 'Collapse Wordle tab'}
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
						onClick={closeTab}
						disabled={!isParticipant}
						aria-label="Close Wordle tab"
					>
						<IconX size={17} stroke={2} />
					</Button>
				</div>

				<div
					className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3"
					aria-hidden={panelCollapsed}
					onMouseDown={focusPanel}
				>
					{state.phase === 'setup' ? (
						<div className="mx-auto grid min-h-full w-full max-w-2xl content-start gap-3">
							<div className="rounded-md border bg-background p-3">
								<div className="mb-2 flex items-center justify-between gap-2">
									<div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
										<IconUsers size={15} stroke={2} />
										Players
									</div>
									{isParticipant ? (
										<Button
											type="button"
											variant="outline"
											className="h-8 gap-2 px-3 text-xs"
											onClick={leaveGame}
										>
											<IconUserMinus size={15} stroke={2} />
											Leave
										</Button>
									) : (
										<Button
											type="button"
											variant="outline"
											className="h-8 gap-2 px-3 text-xs"
											disabled={!currentPlayer}
											onClick={joinGame}
										>
											<IconUserPlus size={15} stroke={2} />
											Join
										</Button>
									)}
								</div>
								<div className="flex flex-wrap gap-2">
									{state.players.length > 0 ? (
										state.players.map((player) => (
											<span
												key={player.id}
												className={`rounded-md border px-2 py-1 text-xs font-bold ${
													isSameWordlePlayer(player, currentPlayer)
														? 'border-primary bg-primary/10 text-primary'
														: 'bg-muted/35'
												}`}
											>
												{playerLabel(player)}
											</span>
										))
									) : (
										<span className="text-sm font-semibold text-muted-foreground">
											No players yet
										</span>
									)}
								</div>
							</div>

							<div className="grid gap-3 rounded-md border bg-background p-3">
								<div className="grid gap-2">
									<div className="text-xs font-bold text-muted-foreground">Mode</div>
									<div className="grid grid-cols-2 gap-2">
										{(['competitive', 'coop'] as WordleMode[]).map((mode) => (
											<button
												key={mode}
												type="button"
												disabled={!isParticipant}
												aria-pressed={state.settings.mode === mode}
												onClick={() => updateSettings({ mode })}
												className={`rounded-md border px-3 py-2 text-sm font-bold capitalize transition-colors ${
													state.settings.mode === mode
														? 'border-primary bg-primary/10 text-primary'
														: 'bg-background hover:bg-accent'
												} disabled:opacity-50`}
											>
												{mode === 'coop' ? 'Coop' : 'Competitive'}
											</button>
										))}
									</div>
								</div>
								<div className="grid gap-2">
									<div className="text-xs font-bold text-muted-foreground">Turns</div>
									<div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2">
										<Button
											type="button"
											variant="outline"
											className="h-10 px-0 text-lg font-black"
											disabled={!isParticipant || turns <= 1}
											onClick={() => updateSettings({ turns: turns - 1 })}
										>
											-
										</Button>
										<div className="rounded-md border bg-muted/35 px-3 py-2 text-center text-sm font-black">
											{turns}
										</div>
										<Button
											type="button"
											variant="outline"
											className="h-10 px-0 text-lg font-black"
											disabled={!isParticipant || turns >= MAX_TURNS}
											onClick={() => updateSettings({ turns: turns + 1 })}
										>
											+
										</Button>
									</div>
								</div>
							</div>

							<div className="grid gap-2">
								<Button
									type="button"
									className="h-10 gap-2"
									disabled={!isParticipant || state.players.length === 0}
									onClick={startGame}
								>
									<IconPlayerPlayFilled size={17} />
									Start
								</Button>
							</div>
						</div>
					) : (
						<div
							className={
								compactLayout
									? 'grid min-h-full content-start gap-3'
									: 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_230px] gap-3'
							}
						>
							<div
								className={
									compactLayout ? 'grid gap-3' : 'grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3'
								}
							>
								<div className="min-h-0 overflow-auto rounded-md border bg-background p-3">
									{state.settings.mode === 'competitive' ? (
										myBoard ? (
											<div className="grid min-h-full content-center gap-3">
												{renderBoard(myBoard)}
												<div className="text-center text-sm font-bold text-muted-foreground">
													{message ||
														(myBoard.finished
															? myBoard.solved
																? 'Solved'
																: boardFailed(myBoard, turns)
																	? getAnswer(answerIndexForBoard(myBoard))
																	: ''
															: 'Your board')}
												</div>
											</div>
										) : (
											<div className="flex min-h-full items-center justify-center text-sm font-semibold text-muted-foreground">
												Round in progress
											</div>
										)
									) : (
										<div className="grid gap-4">
											{[...state.boards].reverse().map((board) => {
												const active = board.id === state.activeBoardId;
												return (
													<div
														key={board.id}
														className={`grid gap-2 rounded-md border p-3 ${
															active ? 'border-primary bg-primary/5' : 'bg-muted/20'
														}`}
													>
														<div className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
															<span>
																Board{' '}
																{state.boards.findIndex((candidate) => candidate.id === board.id) +
																	1}
															</span>
															<span>
																{board.finished
																	? board.solved
																		? 'Solved'
																		: boardFailed(board, turns)
																			? getAnswer(answerIndexForBoard(board))
																			: ''
																	: active
																		? `${playerLabel(activePlayer)} turn`
																		: 'Open'}
															</span>
														</div>
														{renderBoard(board, !active)}
													</div>
												);
											})}
										</div>
									)}
								</div>
								{keyboard}
							</div>

							<div className="flex min-h-0 flex-col gap-3">
								<div className="grid gap-2 rounded-md border bg-background p-3">
									<div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
										<IconUsers size={15} stroke={2} />
										Players
									</div>
									<div className="flex flex-wrap gap-2">
										{state.players.map((player) => (
											<span
												key={player.id}
												className={`rounded-md border px-2 py-1 text-xs font-bold ${
													isSameWordlePlayer(player, currentPlayer)
														? 'border-primary bg-primary/10 text-primary'
														: 'bg-muted/35'
												}`}
											>
												{playerLabel(player)}
											</span>
										))}
									</div>
									<div className="text-xs font-bold text-muted-foreground">
										{state.settings.mode === 'coop'
											? `${playerLabel(activePlayer)} turn`
											: state.result?.message || `${state.players.length} players`}
									</div>
									<Button
										type="button"
										variant="outline"
										className="h-9 gap-2"
										disabled={!isParticipant}
										onClick={newGame}
									>
										<IconRefresh size={17} stroke={2} />
										New
									</Button>
								</div>

								{state.settings.mode === 'competitive' ? (
									<div className="min-h-0 overflow-auto rounded-md border bg-background p-3">
										<div className="mb-2 text-xs font-bold text-muted-foreground">Other Boards</div>
										<div className="grid gap-3">
											{state.boards
												.filter((board) => board.playerId !== currentPlayer?.id)
												.map((board) => {
													const player = state.players.find(
														(candidate) => candidate.id === board.playerId
													);
													return (
														<div key={board.id} className="grid gap-1">
															<div className="truncate text-xs font-bold">
																{playerLabel(player)}
															</div>
															{renderBoard(board, true)}
														</div>
													);
												})}
											{state.boards.filter((board) => board.playerId !== currentPlayer?.id)
												.length === 0 ? (
												<div className="text-sm font-semibold text-muted-foreground">
													No other boards
												</div>
											) : null}
										</div>
									</div>
								) : null}
							</div>
						</div>
					)}
				</div>
			</div>

			{panelCollapsed ? null : (
				<div
					className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize touch-none"
					onPointerDown={handleResizeStart}
					aria-hidden="true"
				/>
			)}
		</div>
	);
}
