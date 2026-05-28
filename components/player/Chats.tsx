'use client';

import type { Chat, Player } from '@/lib/player/t';
import { getRealName } from '@/lib/player/t';
import { Pfp } from '@/components/player/Pfp';
import { EmojiText } from '@/components/player/EmojiText';

export function Chats({
	messagesToDisplay,
	historicalPlayers,
	controlsShowing,
	staticBaseUrl
}: {
	messagesToDisplay: Chat[];
	historicalPlayers: Record<string, Player>;
	controlsShowing: boolean | null;
	staticBaseUrl: string;
}) {
	return (
		<div
			className={`${controlsShowing ? '!mt-10' : ''} chat-history ml-auto flex flex-col gap-0.5 items-end`}
		>
			{messagesToDisplay.map((message, index) => (
				<div
					key={`${message.timestamp}-${message.uid}-${message.message}-${index}`}
					className={`chat-line flex items-center justify-center gap-1 px-2.5 py-1 text-center text-white ${message.isStateUpdate ? 'font-semibold' : ''} ${message.isSystem ? 'chat-line-system' : ''}`}
				>
					{message.isSystem ? (
						<>
							<span className="chat-message-text">
								<EmojiText text={message.message} emojiRefs={message.emojiRefs} />
							</span>
							<span>{message.timeStr ? `[${message.timeStr}]` : ''}</span>
							<span className="chat-system-label">System</span>
						</>
					) : (
						<>
							<span className="chat-message-text">
								<EmojiText text={message.message} emojiRefs={message.emojiRefs} />
							</span>
							<span>{message.timeStr ? `[${message.timeStr}]` : ''}</span>
							<span>{getRealName(historicalPlayers[message.uid])}</span>
							<Pfp
								id={message.uid}
								className="avatar"
								discordUser={historicalPlayers[message.uid]?.discordUser}
								staticBaseUrl={staticBaseUrl}
							/>
						</>
					)}
				</div>
			))}
		</div>
	);
}
