'use client';

/* eslint-disable @next/next/no-img-element -- Emote thumbnails come from animated third-party CDNs. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconEye, IconEyeOff, IconSend, IconUsers } from '@tabler/icons-react';
import {
	createEditor,
	Editor,
	Element as SlateElement,
	Node as SlateNode,
	Range,
	Text,
	Transforms,
	type BaseEditor,
	type Descendant
} from 'slate';
import { withHistory, type HistoryEditor } from 'slate-history';
import {
	Editable,
	ReactEditor,
	Slate,
	useFocused,
	useSelected,
	withReact,
	type RenderElementProps
} from 'slate-react';
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

type ChatText = {
	text: string;
};

type ChatEmojiElement = {
	type: 'emoji';
	emoji: ChatEmojiRef;
	children: ChatText[];
};

type ChatParagraphElement = {
	type: 'paragraph';
	children: Array<ChatText | ChatEmojiElement>;
};

type ChatElement = ChatEmojiElement | ChatParagraphElement;
type ChatEditor = BaseEditor & ReactEditor & HistoryEditor;

type ActiveEmojiToken = {
	query: string;
	range: Range;
};

declare module 'slate' {
	interface CustomTypes {
		Editor: ChatEditor;
		Element: ChatElement;
		Text: ChatText;
	}
}

const chatInputMaxLength = 250;
const emojiTokenRegex = /:([a-z0-9][a-z0-9_+-]{1,39}):/gi;

function createEmptyChatValue(): Descendant[] {
	return [{ type: 'paragraph', children: [{ text: '' }] }];
}

function createEmojiElement(emoji: ChatEmojiRef): ChatEmojiElement {
	return { type: 'emoji', emoji, children: [{ text: '' }] };
}

function isEmojiElement(element: SlateElement): element is ChatEmojiElement {
	return element.type === 'emoji';
}

function getEmojiToken(emoji: ChatEmojiRef) {
	return `:${emoji.id}:`;
}

function normalizeChatInputText(text: string) {
	return text.replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
}

function serializeNode(node: Descendant): string {
	if (Text.isText(node)) {
		return node.text;
	}
	if (isEmojiElement(node)) {
		return getEmojiToken(node.emoji);
	}
	return node.children.map(serializeNode).join('');
}

function serializeNodes(nodes: Descendant[]) {
	return nodes.map(serializeNode).join('');
}

function getSelectedTextLength(editor: ChatEditor) {
	if (!editor.selection) {
		return 0;
	}
	return serializeNodes(Editor.fragment(editor, editor.selection)).length;
}

function getRemainingTextCapacity(editor: ChatEditor) {
	const currentLength = serializeNodes(editor.children as Descendant[]).length;
	return chatInputMaxLength - (currentLength - getSelectedTextLength(editor));
}

function insertLimitedText(editor: ChatEditor, insertText: (text: string) => void, text: string) {
	const normalized = normalizeChatInputText(text);
	if (!normalized) {
		return;
	}

	const remaining = getRemainingTextCapacity(editor);
	if (remaining <= 0) {
		return;
	}

	insertText(normalized.slice(0, remaining));
}

function insertEmojiNode(editor: ChatEditor, emoji: ChatEmojiRef) {
	Transforms.insertNodes(editor, createEmojiElement(emoji), { select: true });
	const emojiEntry = Editor.above(editor, {
		match: (node) => SlateElement.isElement(node) && isEmojiElement(node),
		voids: true
	});
	const afterEmoji = emojiEntry ? Editor.after(editor, emojiEntry[1], { voids: true }) : null;
	if (afterEmoji) {
		Transforms.select(editor, afterEmoji);
	} else {
		Transforms.collapse(editor, { edge: 'end' });
	}
}

function withChatInput(editor: ChatEditor) {
	const { isInline, isVoid, insertData, insertText } = editor;

	editor.isInline = (element) => (isEmojiElement(element) ? true : isInline(element));
	editor.isVoid = (element) => (isEmojiElement(element) ? true : isVoid(element));

	editor.insertBreak = () => {};

	editor.insertData = (data) => {
		const text = data.getData('text/plain');
		if (text) {
			editor.insertText(text);
			return;
		}
		insertData(data);
	};

	editor.insertText = (text) => insertLimitedText(editor, insertText, text);

	return editor;
}

function getActiveEmojiToken(editor: ChatEditor): ActiveEmojiToken | null {
	const { selection } = editor;
	if (!selection || !Range.isCollapsed(selection)) {
		return null;
	}

	const [node, path] = Editor.node(editor, selection.anchor.path);
	if (!Text.isText(node)) {
		return null;
	}

	const token = findActiveEmojiToken(node.text, selection.anchor.offset);
	if (!token) {
		return null;
	}

	return {
		query: token.query,
		range: {
			anchor: { path, offset: token.from },
			focus: { path, offset: token.to }
		}
	};
}

function replaceCompletedEmojiTokens(editor: ChatEditor, refs: ChatEmojiRef[]) {
	let replaced = false;
	const textEntries = Array.from(SlateNode.texts(editor)).reverse();

	for (const [node, path] of textEntries) {
		const matches = [...node.text.matchAll(emojiTokenRegex)].reverse();
		for (const match of matches) {
			const [token, id] = match;
			const index = match.index ?? 0;
			const emoji = getChatEmojiAsset(id, refs);
			if (!emoji) {
				continue;
			}

			Transforms.select(editor, {
				anchor: { path, offset: index },
				focus: { path, offset: index + token.length }
			});
			Transforms.delete(editor);
			insertEmojiNode(editor, emoji);
			replaced = true;
		}
	}

	return replaced;
}

function clearEditor(editor: ChatEditor) {
	Editor.withoutNormalizing(editor, () => {
		const start = Editor.start(editor, []);
		const end = Editor.end(editor, []);
		Transforms.select(editor, { anchor: start, focus: end });
		Transforms.delete(editor);
		Transforms.select(editor, Editor.start(editor, []));
	});
	editor.history = { redos: [], undos: [] };
}

function EmojiElement({ attributes, children, element }: RenderElementProps) {
	const selected = useSelected();
	const focused = useFocused();
	const emoji = (element as ChatEmojiElement).emoji;

	return (
		<span
			{...attributes}
			data-chat-input-emoji="true"
			data-emoji-id={emoji.id}
			data-selected={selected && focused ? 'true' : 'false'}
			className="chat-input-emote"
			title={emoji.label}
		>
			<span contentEditable={false} className="chat-input-emote-asset">
				<img
					src={emoji.src}
					alt={`:${emoji.id}:`}
					draggable={false}
					className="chat-input-emote-image"
				/>
			</span>
			{children}
		</span>
	);
}

function ChatInputElement(props: RenderElementProps) {
	if (isEmojiElement(props.element)) {
		return <EmojiElement {...props} />;
	}

	return (
		<span {...props.attributes} className="chat-input-line">
			{props.children}
		</span>
	);
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
	const editor = useMemo(() => withChatInput(withHistory(withReact(createEditor()))), []);
	const initialValue = useMemo(() => createEmptyChatValue(), []);
	const [value, setValue] = useState('');
	const [showSent, setShowSent] = useState(false);
	const [showShortcut, setShowShortcut] = useState(true);
	const [inputFocused, setInputFocused] = useState(false);
	const [activeEmojiToken, setActiveEmojiToken] = useState<ActiveEmojiToken | null>(null);
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const [suggestionsDismissedFor, setSuggestionsDismissedFor] = useState<string | null>(null);
	const [emojiRefs, setEmojiRefs] = useState<ChatEmojiRef[]>([]);
	const [suggestionsRect, setSuggestionsRect] = useState<DOMRect | null>(null);
	const inputShellRef = useRef<HTMLDivElement | null>(null);

	const chatHidden = chatLayout === 'hide';
	const connected = playersCount > 0;
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

	const syncActiveEmojiToken = useCallback(() => {
		setActiveEmojiToken(getActiveEmojiToken(editor));
	}, [editor]);

	const renderElement = useCallback(
		(props: RenderElementProps) => <ChatInputElement {...props} />,
		[]
	);

	useEffect(() => {
		if (!focusByShortcut) {
			return;
		}
		const listener = (event: KeyboardEvent) => {
			if (event.altKey && (event.key === 's' || event.key === 'S')) {
				event.preventDefault();
				if ((controlsShowing === false || controlsShowing === null) && connected) {
					ReactEditor.focus(editor);
					Transforms.select(editor, Editor.end(editor, []));
				}
			}
		};
		document.addEventListener('keydown', listener);
		const timeout = window.setTimeout(() => setShowShortcut(false), 10000);
		return () => {
			document.removeEventListener('keydown', listener);
			window.clearTimeout(timeout);
		};
	}, [connected, controlsShowing, editor, focusByShortcut]);

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

	function handleEditorChange(nextValue: Descendant[]) {
		if (replaceCompletedEmojiTokens(editor, emojiRefs)) {
			return;
		}

		setValue(serializeNodes(nextValue));
		syncActiveEmojiToken();
		setSuggestionIndex(0);
		setSuggestionsDismissedFor(null);
	}

	function insertEmoji(emoji: ChatEmojiRef, range = activeEmojiToken?.range ?? null) {
		if (
			serializeNodes(editor.children as Descendant[]).length >= chatInputMaxLength &&
			!editor.selection
		) {
			return;
		}

		const nextRefs = emojiRefs.some((ref) => ref.id === emoji.id)
			? emojiRefs
			: [...emojiRefs, emoji];

		setEmojiRefs(nextRefs);
		ReactEditor.focus(editor);
		if (range) {
			Transforms.select(editor, range);
		}
		if (editor.selection && !Range.isCollapsed(editor.selection)) {
			Transforms.delete(editor);
		}
		if (getRemainingTextCapacity(editor) < getEmojiToken(emoji).length) {
			return;
		}

		insertEmojiNode(editor, emoji);
		setActiveEmojiToken(null);
		setSuggestionIndex(0);
		setSuggestionsDismissedFor(null);
	}

	function sendMessage() {
		const chat = serializeNodes(editor.children as Descendant[]);
		if (!chat) {
			return;
		}
		send({
			chat,
			emojis: getEmojiIdsFromText(chat),
			emojiRefs: getEmojiRefsFromText(chat, emojiRefs),
			type: SyncTypes.ChatSync
		});
		clearEditor(editor);
		setValue('');
		setActiveEmojiToken(null);
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
						showTriggerTooltip={useButton}
						onSelect={(emoji) => insertEmoji(emoji, null)}
						triggerClassName={
							useButton
								? 'h-10 w-10 shrink-0 rounded-l-none rounded-r-none border-r-0 px-0'
								: 'emoji-trigger pointer-events-auto absolute left-0 top-0 z-10 h-full w-9 rounded-r-none border-0 bg-transparent px-0 text-white/80 shadow-none hover:bg-white/15 hover:text-white'
						}
					/>
					<SoundEffectPicker
						disabled={!connected}
						showTriggerTooltip={useButton}
						onPlay={sendSoundEffect}
						triggerClassName={
							useButton
								? 'h-10 w-10 shrink-0 rounded-l-none rounded-r-none border-r-0 px-0'
								: 'sound-trigger pointer-events-auto absolute left-9 top-0 z-10 h-full w-9 !rounded-none border-0 bg-transparent px-0 text-white/80 shadow-none hover:bg-white/15 hover:text-white'
						}
					/>
					<div ref={inputShellRef} className="relative min-w-0 flex-1">
						<Slate
							editor={editor}
							initialValue={initialValue}
							onChange={handleEditorChange}
							onSelectionChange={syncActiveEmojiToken}
						>
							<Editable
								id={inputId}
								readOnly={!connected}
								role="textbox"
								aria-label={placeholder}
								aria-disabled={!connected}
								aria-multiline="false"
								placeholder={placeholder}
								renderElement={renderElement}
								spellCheck={false}
								className={`chat-rich-input min-w-0 flex-1 focus-within:ring-transparent ${useButton ? 'h-10 rounded-l-none rounded-r-none px-2' : ''} ${!useButton ? 'pl-[4.75rem]' : ''} ${focusByShortcut ? 'pr-16' : ''} input`}
								data-button-layout={useButton ? 'true' : 'false'}
								onDOMBeforeInput={(event) => {
									if (
										event.inputType === 'insertLineBreak' ||
										event.inputType === 'insertParagraph'
									) {
										event.preventDefault();
									}
								}}
								onFocus={() => {
									setInputFocused(true);
									onFocus();
									syncActiveEmojiToken();
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
									if ((event.key === 'Backspace' || event.key === 'Delete') && editor.selection) {
										const voidEntry = Editor.void(editor, { at: editor.selection });
										if (
											voidEntry &&
											SlateElement.isElement(voidEntry[0]) &&
											isEmojiElement(voidEntry[0])
										) {
											event.preventDefault();
											Transforms.removeNodes(editor, { at: voidEntry[1] });
											syncActiveEmojiToken();
											return;
										}
									}
									if (event.key === 'Escape') {
										event.preventDefault();
										if (showEmojiSuggestions) {
											setSuggestionsDismissedFor(activeEmojiToken?.query ?? '');
											return;
										}
										ReactEditor.blur(editor);
									}
								}}
								onKeyUp={(event) => {
									event.stopPropagation();
									syncActiveEmojiToken();
								}}
							/>
						</Slate>
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
													name={getRealName(historicalPlayers[message.uid])}
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
