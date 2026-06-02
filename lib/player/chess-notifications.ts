export const CHESS_NOTIFICATION_SOUND_IDS = {
	start: 'chess_start',
	move: 'chess_move',
	capture: 'chess_capture',
	check: 'chess_check',
	checkmate: 'chess_checkmate',
	gameOver: 'chess_game_over',
	win: 'chess_win',
	lose: 'chess_lose',
	spectatorGameOver: 'chess_spectator_game_over',
	resign: 'chess_resign',
	closeRequest: 'chess_close_request',
	closeConfirm: 'chess_close_confirm',
	closeCancel: 'chess_close_cancel',
	draw: 'chess_draw'
} as const;

export type ChessNotificationSoundId =
	(typeof CHESS_NOTIFICATION_SOUND_IDS)[keyof typeof CHESS_NOTIFICATION_SOUND_IDS];
