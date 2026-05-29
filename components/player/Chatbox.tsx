'use client';

/* eslint-disable @next/next/no-img-element -- Emote thumbnails come from animated third-party CDNs. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconEye, IconEyeOff, IconSend, IconUsers } from '@tabler/icons-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Shortcut } from '@/components/ui/command';
import * as Dialog from '@/components/ui/dialog';
import * as Tooltip from '@/components/ui/tooltip';
import { Pfp } from '@/components/player/Pfp';
import { EmojiPicker } from '@/components/player/EmojiPicker';
import { EmojiText } from '@/components/player/EmojiText';
import { SoundEffectPicker } from '@/components/player/SoundEffectPicker';
import {
	findActiveEmojiToken,
	getEmojiIdsFromText,
	getEmojiRefsFromText,
	searchChatEmojis,
	type ChatEmojiRef
} from '@/lib/player/emoji';
import { BroadcastTypes, getRealName, SyncTypes, type Chat, type Player } from '@/lib/player/t';
import type { SoundEffect } from '@/lib/player/sound-effects';
import { useAppState } from '@/lib/app-state';

type Props = {
	send: (_payload: any) => void;
	onFocus?: () => void;
	onBlur?: () => void;
	chatFocused?: boolean;
	focusByShortcut?: boolean;
	controlsShowing?: boolean | null;
	formId: string;
	inputId: string;
	useButton?: boolean;
	messages: Chat[];
	historicalPlayers: Record<string, Player>;
	className?: string;
	staticBaseUrl: string;
};

export function Chatbox({
	send,
	onFocus = () => {},
	onBlur = () => {},
	chatFocused = false,
	focusByShortcut = false,
	controlsShowing = null,
	formId,
	inputId,
	useButton = false,
	messages,
	historicalPlayers,
	className = '',
	staticBaseUrl
}: Props) {
	const { chatLayout, setChatLayout, playersCount } = useAppState();
	const [value, setValue] = useState('');
	const [showSent, setShowSent] = useState(false);
	const [showShortcut, setShowShortcut] = useState(true);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const [suggestionsDismissedFor, setSuggestionsDismissedFor] = useState<string | null>(null);
	const [emojiRefs, setEmojiRefs] = useState<ChatEmojiRef[]>([]);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const inputPreviewRef = useRef<HTMLDivElement | null>(null);

	const chatHidden = chatLayout === 'hide';
	const connected = playersCount > 0;
	const activeEmojiToken = findActiveEmojiToken(value, cursorIndex);
	const emojiSuggestions = useMemo(
		() => (activeEmojiToken ? searchChatEmojis(activeEmojiToken.query, 6) : []),
		[activeEmojiToken]
	);
	const hasEmojiPreview = useMemo(
		() =>
			!activeEmojiToken &&
			value.length > 0 &&
			(getEmojiIdsFromText(value).length > 0 || getEmojiRefsFromText(value, emojiRefs).length > 0),
		[activeEmojiToken, emojiRefs, value]
	);
	const showEmojiSuggestions =
		chatFocused &&
		emojiSuggestions.length > 0 &&
		(!activeEmojiToken || suggestionsDismissedFor !== activeEmojiToken.query);
	const chatTxt = useMemo(() => {
		return chatHidden
			? 'Chat (hidden)'
			: `Chat ${controlsShowing === null && showShortcut ? '[Alt S]' : ''}`;
	}, [chatHidden, controlsShowing, showShortcut]);
	const placeholder = showSent ? 'Sent!' : chatTxt;

	useEffect(() => {
		if (!focusByShortcut) {
			return;
		}
		const listener = (event: KeyboardEvent) => {
			if (event.altKey && (event.key === 's' || event.key === 'S')) {
				event.preventDefault();
				if (controlsShowing === false || controlsShowing === null) {
					(
						inputRef.current ?? (document.getElementById(inputId) as HTMLInputElement | null)
					)?.focus();
				}
			}
		};
		document.addEventListener('keydown', listener);
		const timeout = window.setTimeout(() => setShowShortcut(false), 10000);
		return () => {
			document.removeEventListener('keydown', listener);
			window.clearTimeout(timeout);
		};
	}, [controlsShowing, focusByShortcut, inputId]);

	useEffect(() => {
		if (!inputRef.current || !inputPreviewRef.current) {
			return;
		}
		inputPreviewRef.current.scrollLeft = inputRef.current.scrollLeft;
	}, [value]);

	function syncInputPreviewScroll(input: HTMLInputElement | null = inputRef.current) {
		if (!input || !inputPreviewRef.current) {
			return;
		}
		inputPreviewRef.current.scrollLeft = input.scrollLeft;
	}

	function queueInputPreviewScroll(input: HTMLInputElement | null = inputRef.current) {
		window.requestAnimationFrame(() => syncInputPreviewScroll(input));
	}

	function updateCursorFromInput(input: HTMLInputElement | null = inputRef.current) {
		setCursorIndex(input?.selectionStart ?? value.length);
		queueInputPreviewScroll(input);
	}

	function insertEmoji(emoji: ChatEmojiRef, range = activeEmojiToken) {
		const input = inputRef.current;
		const cursor = input?.selectionStart ?? cursorIndex;
		const from = range?.from ?? cursor;
		const to = range?.to ?? cursor;
		const token = `:${emoji.id}: `;
		const nextValue = `${value.slice(0, from)}${token}${value.slice(to)}`.slice(0, 250);
		const nextCursor = Math.min(from + token.length, nextValue.length);
		setValue(nextValue);
		setCursorIndex(nextCursor);
		setSuggestionIndex(0);
		setSuggestionsDismissedFor(null);
		setEmojiRefs((refs) => {
			if (refs.some((ref) => ref.id === emoji.id)) {
				return refs;
			}
			return [...refs, emoji];
		});
		window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.setSelectionRange(nextCursor, nextCursor);
		});
	}

	function sendMessage() {
		if (!value) {
			return;
		}
		send({
			chat: value,
			emojis: getEmojiIdsFromText(value),
			emojiRefs: getEmojiRefsFromText(value, emojiRefs),
			type: SyncTypes.ChatSync
		});
		setValue('');
		setCursorIndex(0);
		setSuggestionIndex(0);
		setSuggestionsDismissedFor(null);
		setEmojiRefs([]);
		setShowSent(true);
		window.setTimeout(() => {
			setShowSent(false);
		}, 2000);
	}

	function sendSoundEffect(effect: SoundEffect) {
		send({
			type: SyncTypes.BroadcastSync,
			broadcast: {
				type: BroadcastTypes.SoundEffect,
				soundEffect: { id: effect.id }
			}
		});
	}

	return (
		<form
			id={formId}
			onSubmit={(event) => {
				event.preventDefault();
				sendMessage();
			}}
			className={className}
			style={chatFocused ? { visibility: 'visible' } : { visibility: 'unset' }}
			autoComplete="off"
		>
			<div className="relative flex w-full min-w-0 items-center justify-end">
				{useButton ? (
					<Tooltip.Provider delayDuration={0}>
						<Tooltip.Root>
							<Tooltip.Trigger asChild>
								<Button
									disabled={!connected}
									variant="outline"
									className="h-10 rounded-r-none border-r-0 px-2"
									onClick={() => {
										setChatLayout((value) => (value === 'hide' ? 'show' : 'hide'));
									}}
								>
									{chatHidden ? (
										<IconEyeOff stroke={2} size={18} className="text-red-600" />
									) : (
										<IconEye stroke={2} size={18} />
									)}
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>{chatHidden ? <p>Show chat</p> : <p>Hide chat</p>}</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
				) : null}

				<div className={`relative min-w-0 ${useButton ? 'flex flex-1' : 'chat-input-wrap'}`}>
					<EmojiPicker
						disabled={!connected}
						onSelect={(emoji) => insertEmoji(emoji, null)}
						triggerClassName={
							useButton
								? 'h-10 w-10 shrink-0 rounded-l-none rounded-r-none border-r-0 px-0'
								: 'emoji-trigger pointer-events-auto absolute left-0 top-0 z-10 h-full w-9 rounded-r-none border-0 bg-transparent px-0 text-white/80 shadow-none hover:bg-white/15 hover:text-white'
						}
					/>
					<SoundEffectPicker
						disabled={!connected}
						onPlay={sendSoundEffect}
						triggerClassName={
							useButton
								? 'h-10 w-10 shrink-0 rounded-l-none rounded-r-none border-r-0 px-0'
								: 'sound-trigger pointer-events-auto absolute left-9 top-0 z-10 h-full w-9 rounded-r-none border-0 bg-transparent px-0 text-white/80 shadow-none hover:bg-white/15 hover:text-white'
						}
					/>
					<div className="relative min-w-0 flex-1">
						{hasEmojiPreview ? (
							<div
								className={`chat-input-preview-surface pointer-events-none absolute inset-0 z-0 rounded-md ${useButton ? 'rounded-l-none rounded-r-none' : ''}`}
							/>
						) : null}
						<Input
							ref={inputRef}
							id={inputId}
							maxLength={250}
							disabled={!connected}
							value={value}
							data-has-emoji-preview={hasEmojiPreview ? 'true' : 'false'}
							onFocus={() => {
								onFocus();
								updateCursorFromInput();
								if (useButton) {
									window.setTimeout(() => {
										window.scrollTo(0, 0);
									}, 100);
								}
							}}
							onBlur={onBlur}
							onClick={(event) => updateCursorFromInput(event.currentTarget)}
							onSelect={(event) => updateCursorFromInput(event.currentTarget)}
							onScroll={(event) => syncInputPreviewScroll(event.currentTarget)}
							onChange={(event) => {
								setValue(event.target.value);
								setCursorIndex(event.target.selectionStart ?? event.target.value.length);
								setSuggestionIndex(0);
								setSuggestionsDismissedFor(null);
								queueInputPreviewScroll(event.target);
							}}
							onKeyDown={(event) => {
								event.stopPropagation();
								if (showEmojiSuggestions) {
									if (event.key === 'ArrowDown') {
										event.preventDefault();
										setSuggestionIndex((index) => (index + 1) % emojiSuggestions.length);
										return;
									}
									if (event.key === 'ArrowUp') {
										event.preventDefault();
										setSuggestionIndex(
											(index) => (index - 1 + emojiSuggestions.length) % emojiSuggestions.length
										);
										return;
									}
									if (event.key === 'Enter' || event.key === 'Tab') {
										event.preventDefault();
										insertEmoji(emojiSuggestions[suggestionIndex] ?? emojiSuggestions[0]);
										return;
									}
								}
								if (event.key === 'Escape') {
									event.preventDefault();
									if (showEmojiSuggestions) {
										setSuggestionsDismissedFor(activeEmojiToken?.query ?? '');
										return;
									}
									inputRef.current?.blur();
								}
							}}
							onKeyUp={(event) => {
								event.stopPropagation();
								updateCursorFromInput(event.currentTarget);
							}}
							onKeyPress={(event) => {
								event.stopPropagation();
							}}
							placeholder={placeholder}
							type="text"
							autoComplete="off"
							className={`chat-input-native relative z-[2] min-w-0 flex-1 focus-visible:ring-transparent ${useButton ? 'h-10 rounded-l-none rounded-r-none px-2' : ''} ${!useButton ? 'pl-[4.75rem]' : ''} ${focusByShortcut ? 'pr-16' : ''} input`}
						/>
						{hasEmojiPreview ? (
							<div
								ref={inputPreviewRef}
								aria-hidden="true"
								className={`chat-input-preview pointer-events-none absolute inset-0 z-[1] flex items-center overflow-hidden whitespace-pre rounded-md px-3 py-1 text-sm ${useButton ? 'h-10 rounded-l-none rounded-r-none px-2' : 'pl-[4.75rem]'} ${focusByShortcut ? 'pr-16' : ''}`}
							>
								<span className="chat-input-preview-content block min-w-max">
									<EmojiText text={value} emojiRefs={emojiRefs} />
								</span>
							</div>
						) : null}
						{showEmojiSuggestions ? (
							<div className="emoji-suggestions pointer-events-auto absolute bottom-full left-0 z-50 mb-2 w-full min-w-0 overflow-x-hidden overflow-y-hidden rounded-md border border-white/15 bg-background/95 p-1 text-foreground shadow-xl backdrop-blur-md">
								{emojiSuggestions.map((emoji, index) => (
									<button
										key={emoji.id}
										type="button"
										className={`flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
											index === suggestionIndex
												? 'bg-accent text-accent-foreground'
												: 'hover:bg-accent hover:text-accent-foreground'
										}`}
										onMouseDown={(event) => {
											event.preventDefault();
											insertEmoji(emoji);
										}}
									>
										<img
											src={emoji.src}
											alt=""
											loading="lazy"
											decoding="async"
											className="h-7 w-7 shrink-0 object-contain"
										/>
										<span className="min-w-0 flex-1 truncate font-bold">{`:${emoji.id}:`}</span>
										<span className="shrink-0 text-xs text-muted-foreground">
											{emoji.animated
												? 'Animated'
												: emoji.kind === 'sticker'
													? 'Sticker'
													: emoji.source}
										</span>
									</button>
								))}
							</div>
						) : null}
						{focusByShortcut ? (
							<Shortcut className="pointer-events-none absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center gap-0.5 text-xs font-bold">
								{playersCount > 0 ? (
									<>
										<IconUsers stroke={3} size={14} /> {playersCount}
									</>
								) : null}
							</Shortcut>
						) : null}
					</div>
				</div>

				{useButton ? (
					<div className="flex shrink-0">
						<Dialog.Root>
							<Dialog.Trigger
								disabled={!connected}
								type="button"
								className={`${buttonVariants({ variant: 'outline' })} h-10 rounded-l-none rounded-r-none border-l-0 border-r-0`}
							>
								History
							</Dialog.Trigger>
							<Dialog.Content className="gap-3 pr-1 max-sm:pl-2">
								<Dialog.Title className="self-start text-lg font-bold">
									Chat History (Session)
								</Dialog.Title>
								<Dialog.Description className="sr-only">
									Messages sent in this watch room session.
								</Dialog.Description>
								<div className="flex max-h-[85vh] flex-col items-center gap-2.5 overflow-x-hidden overflow-y-auto">
									{messages.length === 0 ? (
										<div className="self-start">There&apos;s nothing here yet ┬─┬ノ( º _ ºノ)</div>
									) : null}
									{messages
										.slice()
										.reverse()
										.map((message, index) => (
											<div
												key={`${message.timestamp}-${message.uid}-${message.message}-${index}`}
												className={`flex w-full flex-wrap items-center gap-1.5 text-center ${message.isStateUpdate ? 'font-semibold' : ''}`}
											>
												<Pfp
													id={historicalPlayers[message.uid]?.profileId || message.uid}
													className="avatar shrink-0 !h-6 !w-6"
													discordUser={historicalPlayers[message.uid]?.discordUser}
													staticBaseUrl={staticBaseUrl}
												/>
												<span className="shrink-0 font-bold">
													{new Date(message.timestamp).toLocaleTimeString('en-US', {
														hour: '2-digit',
														minute: '2-digit',
														hour12: false
													})}
												</span>
												<span className="shrink-0">
													{getRealName(historicalPlayers[message.uid])}:
												</span>
												<span className="block overflow-x-hidden wrap-break-word pr-3 text-justify">
													<EmojiText text={message.message} emojiRefs={message.emojiRefs} />
												</span>
											</div>
										))}
								</div>
							</Dialog.Content>
						</Dialog.Root>
						<Button
							disabled={!connected}
							variant="outline"
							className="h-10 w-10 rounded-l-none px-0"
							aria-label="Send message"
							onClick={sendMessage}
						>
							<IconSend size={18} stroke={2} />
						</Button>
					</div>
				) : null}
			</div>
		</form>
	);
}
