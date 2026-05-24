'use client';

import type { Chat, Player } from '@/lib/player/t';
import { getRealName } from '@/lib/player/t';
import { Pfp } from '@/components/player/Pfp';

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
			className={`${controlsShowing ? 'max-md:!mt-10' : ''} chat-history ml-auto flex flex-col gap-0.5 items-end`}
		>
			{messagesToDisplay.map((message) => (
				<div
					key={`${message.timestamp}-${message.uid}-${message.message}`}
					className={`chat-line flex items-center justify-center gap-1 px-2.5 py-1 text-center text-white ${message.isStateUpdate ? 'font-semibold' : ''}`}
				>
					<span>{message.message}</span>
					<span>{message.timeStr ? `[${message.timeStr}]` : ''}</span>
					<span>{getRealName(historicalPlayers[message.uid])}</span>
					<Pfp
						id={message.uid}
						className="avatar"
						discordUser={historicalPlayers[message.uid]?.discordUser}
						staticBaseUrl={staticBaseUrl}
					/>
				</div>
			))}
		</div>
	);
}
