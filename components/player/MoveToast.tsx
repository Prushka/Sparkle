'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Job, Player } from '@/lib/player/t';
import { getRealName } from '@/lib/player/t';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pfp } from '@/components/player/Pfp';
import { TitlePoster } from '@/components/player/TitlePoster';

export function MoveToast({
	historicalPlayers,
	seconds,
	firedBy,
	job,
	moveToPath,
	onMove,
	staticBaseUrl
}: {
	historicalPlayers: Record<string, Player>;
	seconds: number;
	firedBy?: Player;
	job: Job | undefined;
	moveToPath?: (_id: string) => string;
	onMove?: () => void | Promise<unknown>;
	staticBaseUrl: string;
}) {
	const router = useRouter();
	const [remaining, setRemaining] = useState(seconds);
	const [closed, setClosed] = useState(false);

	useEffect(() => {
		if (remaining <= 0) {
			if (job?.Id) {
				if (onMove) {
					void onMove();
				} else {
					router.push(moveToPath ? moveToPath(job.Id) : `/${job.Id}`);
				}
			}
			return;
		}
		const interval = setInterval(() => {
			setRemaining((value) => value - 1);
		}, 1000);
		return () => clearInterval(interval);
	}, [job?.Id, moveToPath, onMove, remaining, router]);

	if (closed) {
		return null;
	}

	return (
		<Card className="w-full border-white/20 bg-background/55 shadow-xl backdrop-blur-md supports-[backdrop-filter]:bg-background/40">
			<CardHeader>
				<CardTitle className="flex items-center">
					{firedBy?.id ? (
						<Pfp
							id={historicalPlayers[firedBy.id]?.profileId || firedBy.profileId || firedBy.id}
							className="avatar mr-2"
							discordUser={historicalPlayers[firedBy.id]?.discordUser}
							name={getRealName(historicalPlayers[firedBy.id] ?? firedBy)}
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
				<Button variant="outline">By: {firedBy?.name || 'Room'}</Button>
				<Button variant="default" onClick={() => setClosed(true)}>
					Close
				</Button>
			</CardFooter>
		</Card>
	);
}
