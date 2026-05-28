'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconEye, IconEyeOff, IconSend, IconUsers } from '@tabler/icons-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Shortcut } from '@/components/ui/command';
import * as Dialog from '@/components/ui/dialog';
import * as Tooltip from '@/components/ui/tooltip';
import { Pfp } from '@/components/player/Pfp';
import { getRealName, SyncTypes, type Chat, type Player } from '@/lib/player/t';
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
	const inputRef = useRef<HTMLInputElement | null>(null);

	const chatHidden = chatLayout === 'hide';
	const connected = playersCount > 0;
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

	function sendMessage() {
		if (!value) {
			return;
		}
		send({ chat: value, type: SyncTypes.ChatSync });
		setValue('');
		setShowSent(true);
		window.setTimeout(() => {
			setShowSent(false);
		}, 2000);
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
					<Input
						ref={inputRef}
						id={inputId}
						maxLength={250}
						disabled={!connected}
						value={value}
						onFocus={() => {
							onFocus();
							if (useButton) {
								window.setTimeout(() => {
									window.scrollTo(0, 0);
								}, 100);
							}
						}}
						onBlur={onBlur}
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === 'Escape') {
								event.preventDefault();
								inputRef.current?.blur();
							}
						}}
						onKeyUp={(event) => {
							event.stopPropagation();
						}}
						onKeyPress={(event) => {
							event.stopPropagation();
						}}
						placeholder={placeholder}
						type="text"
						autoComplete="off"
						className={`min-w-0 flex-1 focus-visible:ring-transparent ${useButton ? 'h-10 rounded-l-none rounded-r-none px-2' : ''} ${focusByShortcut ? 'pr-16' : ''} input`}
					/>
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
													id={message.uid}
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
													{message.message}
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
