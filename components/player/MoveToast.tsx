'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Job, Player } from '@/lib/player/t';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pfp } from '@/components/player/Pfp';
import { TitlePoster } from '@/components/player/TitlePoster';

export function MoveToast({
	historicalPlayers,
	seconds,
	firedBy,
	job,
	onClose,
	moveToPath,
	staticBaseUrl
}: {
	historicalPlayers: Record<string, Player>;
	seconds: number;
	firedBy: Player;
	job: Job | undefined;
	onClose: () => void;
	moveToPath?: (_id: string) => string;
	staticBaseUrl: string;
}) {
	const router = useRouter();
	const [remaining, setRemaining] = useState(seconds);

	useEffect(() => {
		if (remaining <= 0) {
			if (job?.Id) {
				router.push(moveToPath ? moveToPath(job.Id) : `/${job.Id}`);
			}
			return;
		}
		const interval = setInterval(() => {
			setRemaining((value) => value - 1);
		}, 1000);
		return () => clearInterval(interval);
	}, [job?.Id, moveToPath, remaining, router]);

	return (
		<Card className="w-full">
			<CardHeader>
				<CardTitle className="flex items-center">
					{firedBy?.id ? (
						<Pfp
							id={firedBy.id}
							className="avatar mr-2"
							discordUser={historicalPlayers[firedBy.id]?.discordUser}
							staticBaseUrl={staticBaseUrl}
						/>
					) : null}
					{remaining > 0 ? (
						<span>
							Moving in {remaining} second{remaining > 1 ? 's' : ''}
						</span>
					) : (
						<span>Moving...</span>
					)}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="flex w-full items-center gap-1 text-sm font-normal">
					{job?.Title ? <TitlePoster title={job.Title} staticBaseUrl={staticBaseUrl} /> : null}
					To: {job?.Input}
				</div>
			</CardContent>
			<CardFooter className="flex justify-between">
				<Button variant="outline">By: {firedBy?.name}</Button>
				<Button variant="default" onClick={onClose}>
					Close
				</Button>
			</CardFooter>
		</Card>
	);
}
