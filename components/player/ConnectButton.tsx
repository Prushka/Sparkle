"use client";

import { IconPlugConnected, IconRefresh, IconRocket } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Tooltip from '@/components/ui/tooltip';

export function ConnectButton({
	socketCommunicating,
	interacted,
	exited,
	tickedSecsAgoStr,
	onClick,
	className = ''
}: {
	socketCommunicating: boolean;
	interacted: boolean;
	exited: boolean;
	tickedSecsAgoStr: string;
	onClick: () => void;
	className?: string;
}) {
	return (
		<Tooltip.Provider delayDuration={0}>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Button
						variant="outline"
						onClick={onClick}
						className={`font-bold ${
							socketCommunicating ? 'text-green-600 hover:text-green-600' : interacted ? 'text-red-600 hover:text-red-600' : 'text-pink-600 hover:text-pink-600'
						} ${className}`}
					>
						{socketCommunicating ? (
							<IconPlugConnected size={20} stroke={2} />
						) : !interacted ? (
							<>
								<IconRocket className="mr-2 h-4 w-4 animate-bounce" />
								Join Watch Room
							</>
						) : !exited ? (
							<>
								<IconRefresh className="mr-2 h-4 w-4 animate-spin" />
								Connecting...
							</>
						) : (
							<>Disconnected</>
						)}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>Ticked: {tickedSecsAgoStr}s ago</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}
