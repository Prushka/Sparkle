'use client';

/* eslint-disable @next/next/no-img-element -- Emote thumbnails come from animated third-party CDNs. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconEye, IconEyeOff, IconSend, IconUsers } from '@tabler/icons-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Shortcut } from '@/components/ui/command';
import * as Dialog from '@/components/ui/dialog';
import * as Tooltip from '@/components/ui/tooltip';
import { Pfp } from '@/components/player/Pfp';
import { EmojiPicker } from '@/components/player/EmojiPicker';
import { EmojiText } from '@/components/player/EmojiText';
import { SoundEffectPicker } from '@/components/player/SoundEffectPicker';
import {
	findActiveEmojiToken,
	getChatEmojiAsset,
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

type ChatInputPart =
	| {
			type: 'text';
			text: string;
	  }
	| {
			type: 'emoji';
			emoji: ChatEmojiRef;
	  };

type DraftCommitOptions = {
	syncSelection?: boolean;
};

const chatInputMaxLength = 250;
const emojiTokenRegex = /:([a-z0-9][a-z0-9_+-]{1,39}):/gi;

function getEmojiToken(emoji: ChatEmojiRef) {
	return `:${emoji.id}:`;
}

function serializeChatParts(parts: ChatInputPart[]) {
	return parts
		.map((part) => (part.type === 'emoji' ? getEmojiToken(part.emoji) : part.text))
		.join('');
}

function mergeTextParts(parts: ChatInputPart[]) {
	const merged: ChatInputPart[] = [];

	for (const part of parts) {
		if (part.type === 'text') {
			if (!part.text) {
				continue;
			}
			const previous = merged[merged.length - 1];
			if (previous?.type === 'text') {
				previous.text += part.text;
			} else {
				merged.push({ ...part });
			}
		} else {
			merged.push(part);
		}
	}

	return merged;
}

function limitChatParts(parts: ChatInputPart[]) {
	const limited: ChatInputPart[] = [];
	let length = 0;

	for (const part of parts) {
		const partLength = part.type === 'emoji' ? getEmojiToken(part.emoji).length : part.text.length;
		const remaining = chatInputMaxLength - length;
		if (remaining <= 0) {
			break;
		}
		if (partLength <= remaining) {
			limited.push(part);
			length += partLength;
		} else if (part.type === 'text') {
			limited.push({ type: 'text', text: part.text.slice(0, remaining) });
			break;
		} else {
			break;
		}
	}

	return mergeTextParts(limited);
}

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
	const [chatParts, setChatParts] = useState<ChatInputPart[]>([]);
	const [draft, setDraft] = useState('');
	const [showSent, setShowSent] = useState(false);
	const [showShortcut, setShowShortcut] = useState(true);
	const [inputFocused, setInputFocused] = useState(false);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const [suggestionsDismissedFor, setSuggestionsDismissedFor] = useState<string | null>(null);
	const [emojiRefs, setEmojiRefs] = useState<ChatEmojiRef[]>([]);
	const [suggestionsRect, setSuggestionsRect] = useState<DOMRect | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const inputShellRef = useRef<HTMLDivElement | null>(null);

	const chatHidden = chatLayout === 'hide';
	const connected = playersCount > 0;
	const committedValue = useMemo(() => serializeChatParts(chatParts), [chatParts]);
	const value = `${committedValue}${draft}`;
	const activeEmojiToken = findActiveEmojiToken(draft, cursorIndex);
	const emojiSuggestions = useMemo(
		() => (activeEmojiToken ? searchChatEmojis(activeEmojiToken.query, 6) : []),
		[activeEmojiToken]
	);
	const showEmojiSuggestions =
		(chatFocused || inputFocused) &&
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
		if (!showEmojiSuggestions) {
			return;
		}

		let animationFrame = 0;
		const updateSuggestionsRect = () => {
			window.cancelAnimationFrame(animationFrame);
			animationFrame = window.requestAnimationFrame(() => {
				setSuggestionsRect(inputShellRef.current?.getBoundingClientRect() ?? null);
			});
		};

		updateSuggestionsRect();
		window.addEventListener('resize', updateSuggestionsRect);
		window.addEventListener('scroll', updateSuggestionsRect, true);
		return () => {
			window.cancelAnimationFrame(animationFrame);
			window.removeEventListener('resize', updateSuggestionsRect);
			window.removeEventListener('scroll', updateSuggestionsRect, true);
		};
	}, [showEmojiSuggestions, value]);

	function focusDraftInput(cursor = draft.length) {
		window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.setSelectionRange(cursor, cursor);
		});
	}

	function commitDraftValue(
		nextDraft: string,
		nextCursor: number,
		refs = emojiRefs,
		{ syncSelection = false }: DraftCommitOptions = {}
	) {
		let lastCommittedIndex = 0;
		const nextParts: ChatInputPart[] = [];

		for (const match of nextDraft.matchAll(emojiTokenRegex)) {
			const [token, id] = match;
			const index = match.index ?? 0;
			const emoji = getChatEmojiAsset(id, refs);
			if (!emoji) {
				continue;
			}
			if (index > lastCommittedIndex) {
				nextParts.push({ type: 'text', text: nextDraft.slice(lastCommittedIndex, index) });
			}
			nextParts.push({ type: 'emoji', emoji });
			lastCommittedIndex = index + token.length;
		}

		const remainingDraft = nextDraft.slice(lastCommittedIndex);
		const remainingCursor =
			nextCursor >= lastCommittedIndex ? nextCursor - lastCommittedIndex : remainingDraft.length;
		const nextCommitted = limitChatParts([...chatParts, ...nextParts]);
		const remainingCapacity = Math.max(
			0,
			chatInputMaxLength - serializeChatParts(nextCommitted).length
		);
		const limitedDraft = remainingDraft.slice(0, remainingCapacity);
		const limitedCursor = Math.min(remainingCursor, limitedDraft.length);

		setChatParts(nextCommitted);
		setDraft(limitedDraft);
		setCursorIndex(limitedCursor);
		setSuggestionIndex(0);
		setSuggestionsDismissedFor(null);
		if (syncSelection || nextParts.length > 0 || limitedDraft.length !== remainingDraft.length) {
			focusDraftInput(limitedCursor);
		}
	}

	function updateDraft(
		nextDraft: string,
		nextCursor: number,
		refs = emojiRefs,
		options?: DraftCommitOptions
	) {
		const remainingCapacity = Math.max(0, chatInputMaxLength - committedValue.length);
		commitDraftValue(nextDraft.slice(0, remainingCapacity), nextCursor, refs, options);
	}

	function removeLastCommittedPart() {
		setChatParts((parts) => {
			if (parts.length === 0) {
				return parts;
			}
			const nextParts = [...parts];
			const last = nextParts[nextParts.length - 1];
			if (last.type === 'emoji' || last.text.length <= 1) {
				nextParts.pop();
			} else {
				nextParts[nextParts.length - 1] = { type: 'text', text: last.text.slice(0, -1) };
			}
			return nextParts;
		});
		setSuggestionIndex(0);
		setSuggestionsDismissedFor(null);
		focusDraftInput(0);
	}

	function insertEmoji(emoji: ChatEmojiRef, range = activeEmojiToken) {
		const cursor = inputRef.current?.selectionStart ?? cursorIndex;
		const selectionEnd = inputRef.current?.selectionEnd ?? cursor;
		const from = range?.from ?? cursor;
		const to = range?.to ?? selectionEnd;
		const token = `${getEmojiToken(emoji)} `;
		const nextRefs = emojiRefs.some((ref) => ref.id === emoji.id)
			? emojiRefs
			: [...emojiRefs, emoji];
		setEmojiRefs(nextRefs);
		updateDraft(`${draft.slice(0, from)}${token}${draft.slice(to)}`, from + token.length, nextRefs);
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
		setChatParts([]);
		setDraft('');
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
					<div ref={inputShellRef} className="relative min-w-0 flex-1">
						<div
							className={`chat-rich-input min-w-0 flex-1 focus-within:ring-transparent ${useButton ? 'h-10 rounded-l-none rounded-r-none px-2' : ''} ${!useButton ? 'pl-[4.75rem]' : ''} ${focusByShortcut ? 'pr-16' : ''} input`}
							aria-disabled={!connected}
							data-button-layout={useButton ? 'true' : 'false'}
							data-empty={value.length === 0 ? 'true' : 'false'}
							onMouseDown={(event) => {
								if (!connected) {
									return;
								}
								setInputFocused(true);
								if (event.target !== inputRef.current) {
									event.preventDefault();
								}
								inputRef.current?.focus();
							}}
						>
							{chatParts.map((part, index) =>
								part.type === 'emoji' ? (
									<span
										key={`${part.emoji.id}-${index}`}
										data-emoji-id={part.emoji.id}
										className="chat-input-emote"
										title={part.emoji.label}
									>
										<img
											src={part.emoji.src}
											alt={`:${part.emoji.id}:`}
											draggable={false}
											className="chat-input-emote-image"
										/>
									</span>
								) : (
									<span key={`text-${index}`}>{part.text}</span>
								)
							)}
							<input
								ref={inputRef}
								id={inputId}
								aria-label={placeholder}
								disabled={!connected}
								value={draft}
								maxLength={Math.max(0, chatInputMaxLength - committedValue.length)}
								placeholder={chatParts.length === 0 ? placeholder : ''}
								type="text"
								autoComplete="off"
								className="chat-token-draft min-w-0 flex-1 bg-transparent p-0 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
								onFocus={() => {
									setInputFocused(true);
									onFocus();
									setCursorIndex(inputRef.current?.selectionStart ?? draft.length);
									if (useButton) {
										window.setTimeout(() => {
											window.scrollTo(0, 0);
										}, 100);
									}
								}}
								onBlur={() => {
									setInputFocused(false);
									onBlur();
								}}
								onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? 0)}
								onSelect={(event) => setCursorIndex(event.currentTarget.selectionStart ?? 0)}
								onChange={(event) => {
									updateDraft(
										event.target.value,
										event.target.selectionStart ?? event.target.value.length
									);
								}}
								onPaste={(event) => {
									event.preventDefault();
									const cursor = event.currentTarget.selectionStart ?? draft.length;
									const selectionEnd = event.currentTarget.selectionEnd ?? cursor;
									updateDraft(
										`${draft.slice(0, cursor)}${event.clipboardData.getData('text/plain')}${draft.slice(selectionEnd)}`,
										cursor + event.clipboardData.getData('text/plain').length,
										emojiRefs,
										{ syncSelection: true }
									);
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
									if (event.key === 'Enter') {
										event.preventDefault();
										sendMessage();
										return;
									}
									if (
										event.key === 'Backspace' &&
										event.currentTarget.selectionStart === 0 &&
										event.currentTarget.selectionEnd === 0
									) {
										event.preventDefault();
										removeLastCommittedPart();
										return;
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
									setCursorIndex(event.currentTarget.selectionStart ?? 0);
								}}
								onKeyPress={(event) => {
									event.stopPropagation();
								}}
							/>
						</div>
						{showEmojiSuggestions && suggestionsRect && typeof document !== 'undefined'
							? createPortal(
									<div
										className="emoji-suggestions pointer-events-auto fixed z-50 min-w-0 overflow-x-hidden overflow-y-hidden rounded-md border border-white/15 bg-background/95 p-1 text-foreground shadow-xl backdrop-blur-md"
										style={{
											left: suggestionsRect.left,
											top: suggestionsRect.top,
											width: suggestionsRect.width,
											transform: 'translateY(calc(-100% - 0.5rem))'
										}}
									>
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
									</div>,
									document.body
								)
							: null}
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
