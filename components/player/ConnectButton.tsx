'use client';

import { IconPlugConnected, IconRefresh, IconRocket } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

export function ConnectButton({
	socketCommunicating,
	interacted,
	exited,
	disabled = false,
	onClick,
	className = ''
}: {
	socketCommunicating: boolean;
	interacted: boolean;
	exited: boolean;
	disabled?: boolean;
	onClick: () => void;
	className?: string;
}) {
	return (
		<Button
			variant="ghost"
			disabled={disabled}
			onClick={onClick}
			className={`font-bold ${
				socketCommunicating
					? 'text-green-600 hover:text-green-600'
					: interacted
						? 'text-red-600 hover:text-red-600'
						: 'text-pink-600 hover:text-pink-600'
			} ${className}`}
		>
			{socketCommunicating ? (
				<IconPlugConnected size={20} stroke={2} />
			) : !interacted ? (
				<>
					<IconRocket className="size-4 animate-bounce" />
					Join Watch Room
				</>
			) : !exited ? (
				<>
					<IconRefresh className="size-4 animate-spin" />
					Connecting...
				</>
			) : (
				<>Disconnected</>
			)}
		</Button>
	);
}
