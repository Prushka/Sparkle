'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { PUBLIC_DISCORD_CLIENT_ID } from '@/lib/env';
import { formatSeconds, randomString, type Discord } from '@/lib/player/t';
import { useAppState } from '@/lib/app-state';

export function DiscordBridge() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const router = useRouter();
	const { currentlyWatching, discordAuth, setDiscordAuth, setPageReloadCounter } = useAppState();
	const sdkRef = useRef<DiscordSDK | null>(null);
	const authenticatedRef = useRef(false);
	const setupStartedRef = useRef(false);
	const authRef = useRef<Discord | null>(discordAuth);
	const latestRoomRef = useRef<string | null>(null);
	const searchParamsString = searchParams.toString();

	useEffect(() => {
		authRef.current = discordAuth;
	}, [discordAuth]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const stored = window.sessionStorage.getItem('discord');
		if (stored) {
			try {
				setDiscordAuth(JSON.parse(stored));
			} catch (error) {
				console.error('Failed to parse stored Discord auth', error);
			}
		}
	}, [setDiscordAuth]);

	useEffect(() => {
		const params = new URLSearchParams(searchParamsString);
		const room = params.get('room') || params.get('channel_id');
		if (room) {
			latestRoomRef.current = room;
		} else if (!latestRoomRef.current && discordAuth?.channelId) {
			latestRoomRef.current = discordAuth.channelId;
		}
	}, [discordAuth?.channelId, searchParamsString]);

	useEffect(() => {
		if (!pathname || pathname === '/' || pathname.startsWith('/api') || pathname.startsWith('/json')) {
			return;
		}
		const params = new URLSearchParams(searchParamsString);
		if (params.has('room')) {
			return;
		}
		const room =
			latestRoomRef.current ||
			discordAuth?.channelId ||
			params.get('channel_id') ||
			randomString(6);
		latestRoomRef.current = room;
		params.set('room', room);
		router.replace(`${pathname}?${params.toString()}`);
	}, [discordAuth?.channelId, pathname, router, searchParamsString]);

	useEffect(() => {
		if (!PUBLIC_DISCORD_CLIENT_ID) {
			return;
		}
		if (!(searchParams.has('frame_id') || discordAuth)) {
			return;
		}
		if (authenticatedRef.current || setupStartedRef.current) {
			return;
		}
		setupStartedRef.current = true;

		let cancelled = false;

		async function setupDiscordSdk() {
			try {
				const sdk = new DiscordSDK(PUBLIC_DISCORD_CLIENT_ID);
				sdkRef.current = sdk;
				await sdk.ready();
				console.log('Discord SDK is ready');
				const { code } = await sdk.commands.authorize({
					client_id: PUBLIC_DISCORD_CLIENT_ID,
					response_type: 'code',
					state: '',
					prompt: 'none',
					scope: ['identify', 'rpc.activities.write']
				});
				const response = await fetch('/api/token', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ code })
				});
				const { access_token } = await response.json();
				const prevAuth = authRef.current;
				const auth = await sdk.commands.authenticate({ access_token });
				if (cancelled) {
					return;
				}
				if (auth) {
					const authWithChannel = { ...auth, channelId: sdk.channelId ?? '' } as Discord;
					window.sessionStorage.setItem('discord', JSON.stringify(authWithChannel));
					setDiscordAuth(authWithChannel);
					authRef.current = authWithChannel;
					if (!prevAuth) {
						setPageReloadCounter((value) => value + 1);
					}
					authenticatedRef.current = true;
					await sdk.commands.setConfig({
						use_interactive_pip: true
					});
				}
			} catch (error) {
				console.error('Discord initialization failed', error);
			}
		}

		void setupDiscordSdk();

		return () => {
			cancelled = true;
		};
	}, [discordAuth, searchParams, setDiscordAuth, setPageReloadCounter]);

	useEffect(() => {
		const sdk = sdkRef.current;
		if (!sdk || !currentlyWatching || !authenticatedRef.current) {
			return;
		}
		const remaining = `(${formatSeconds(currentlyWatching.totalDuration - currentlyWatching.duration)} Remaining)`;
		sdk.commands
			.setActivity({
				activity: {
					details: `${currentlyWatching.title}`,
					state: currentlyWatching.se
						? `${currentlyWatching.seTitle}`
						: `${formatSeconds(currentlyWatching.duration)}`,
					type: 3,
					timestamps: {
						start: currentlyWatching.timeEntered,
						end: Date.now() + (currentlyWatching.totalDuration - currentlyWatching.duration) * 1000
					},
					party: {
						size: [currentlyWatching.roomPlayers, 99]
					},
					instance: true,
					assets: {
						large_image: `${window.location.origin}${currentlyWatching.thumbnail}`,
						large_text: currentlyWatching.se
							? `${currentlyWatching.se}: ${formatSeconds(currentlyWatching.duration)}`
							: "It's a movie!",
						small_image: currentlyWatching.paused
							? `${window.location.origin}/icons/coffee.png`
							: `${window.location.origin}/icons/magic-ball.png`,
						small_text: currentlyWatching.paused ? `Paused ${remaining}` : `Playing ${remaining}`
					}
				}
			})
			.then(() => {
				console.debug('Activity set', currentlyWatching);
			})
			.catch((error: unknown) => {
				console.error('Error setting activity', error, currentlyWatching);
			});
	}, [currentlyWatching]);

	return null;
}
