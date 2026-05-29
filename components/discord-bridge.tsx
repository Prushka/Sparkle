'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { PUBLIC_DISCORD_CLIENT_ID } from '@/lib/env';
import {
	formatSeconds,
	isExpired,
	randomString,
	type Discord,
	type Watching
} from '@/lib/player/t';
import { useAppState } from '@/lib/app-state';

const DISCORD_AUTH_STORAGE_KEY = 'sparkle:discord-auth';
const DISCORD_SCOPES = ['identify', 'rpc.activities.write'] as const;
const ACTIVITY_TEXT_LIMIT = 128;
const MAX_PARTY_SIZE = 99;

function hasDiscordFrameParams(params: Pick<URLSearchParams, 'has'>) {
	return params.has('frame_id') || params.has('instance_id');
}

function toActivityUrl(value: string) {
	return new URL(value, window.location.origin).toString();
}

function trimActivityText(value: string) {
	if (value.length <= ACTIVITY_TEXT_LIMIT) {
		return value;
	}
	return value.slice(0, ACTIVITY_TEXT_LIMIT - 3).trimEnd() + '...';
}

function withoutAccessToken(auth: Discord): Discord {
	const { access_token: _accessToken, ...safeAuth } = auth;
	return safeAuth;
}

function readStoredDiscordAuth(): Discord | null {
	const stored = window.sessionStorage.getItem(DISCORD_AUTH_STORAGE_KEY);
	if (!stored) {
		return null;
	}
	try {
		const auth = JSON.parse(stored) as Discord;
		if (!auth?.user?.id || !auth.channelId || !auth.expires || isExpired(auth.expires)) {
			window.sessionStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
			return null;
		}
		return auth;
	} catch (error) {
		console.error('Failed to parse stored Discord auth', error);
		window.sessionStorage.removeItem(DISCORD_AUTH_STORAGE_KEY);
		return null;
	}
}

function buildActivityPayload(currentlyWatching: Watching, roomId: string | null | undefined) {
	const elapsed = Math.max(0, Math.floor(currentlyWatching.duration));
	const totalDuration = Math.max(0, Math.floor(currentlyWatching.totalDuration));
	const remaining = Math.max(0, totalDuration - elapsed);
	const partySize = Math.min(MAX_PARTY_SIZE, Math.max(1, currentlyWatching.roomPlayers));
	const hasDuration = totalDuration > 0;
	const state = currentlyWatching.se
		? currentlyWatching.seTitle || currentlyWatching.se
		: `${formatSeconds(elapsed)} watched`;
	const remainingText = hasDuration ? ` (${formatSeconds(remaining)} remaining)` : '';
	const timestamps =
		hasDuration && !currentlyWatching.paused
			? {
					start: Date.now() - elapsed * 1000,
					end: Date.now() + remaining * 1000
				}
			: undefined;

	return {
		type: 3,
		details: trimActivityText(currentlyWatching.title),
		state: trimActivityText(state),
		timestamps,
		party: {
			id: roomId || undefined,
			size: [partySize, MAX_PARTY_SIZE]
		},
		instance: true,
		assets: {
			large_image: toActivityUrl(currentlyWatching.thumbnail),
			large_text: trimActivityText(
				currentlyWatching.se
					? `${currentlyWatching.se}: ${formatSeconds(elapsed)}`
					: "It's a movie!"
			),
			small_image: toActivityUrl(
				currentlyWatching.paused ? '/icons/coffee.png' : '/icons/magic-ball.png'
			),
			small_text: trimActivityText(
				currentlyWatching.paused ? `Paused${remainingText}` : `Playing${remainingText}`
			)
		}
	};
}

export function DiscordBridge() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const router = useRouter();
	const { currentlyWatching, discordAuth, setDiscordAuth, setPageReloadCounter } = useAppState();
	const sdkRef = useRef<DiscordSDK | null>(null);
	const authenticatedRef = useRef(false);
	const canSetActivityRef = useRef(false);
	const setupStartedRef = useRef(false);
	const authRef = useRef<Discord | null>(discordAuth);
	const latestRoomRef = useRef<string | null>(null);
	const searchParamsString = searchParams.toString();
	const isDiscordActivity = hasDiscordFrameParams(searchParams);

	useEffect(() => {
		authRef.current = discordAuth;
	}, [discordAuth]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		if (!isDiscordActivity) {
			return;
		}
		const storedAuth = readStoredDiscordAuth();
		if (storedAuth) {
			setDiscordAuth(storedAuth);
		}
	}, [isDiscordActivity, setDiscordAuth]);

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
		if (
			!pathname ||
			pathname === '/' ||
			pathname.startsWith('/api') ||
			pathname.startsWith('/json')
		) {
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
		if (!isDiscordActivity) {
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
					scope: [...DISCORD_SCOPES]
				});
				const response = await fetch('/api/token', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ code })
				});
				if (!response.ok) {
					throw new Error(`Discord token exchange failed with status ${response.status}`);
				}
				const { access_token } = await response.json();
				if (!access_token) {
					throw new Error('Discord token exchange did not return an access token');
				}
				const prevAuth = authRef.current;
				const auth = await sdk.commands.authenticate({ access_token });
				if (cancelled) {
					return;
				}
				if (auth) {
					const scopes = auth.scopes.flatMap((scope): string[] =>
						typeof scope === 'string' ? [scope] : []
					);
					const authWithContext = withoutAccessToken({
						...auth,
						scopes,
						channelId: sdk.channelId ?? '',
						guildId: sdk.guildId
					});
					window.sessionStorage.setItem(DISCORD_AUTH_STORAGE_KEY, JSON.stringify(authWithContext));
					setDiscordAuth(authWithContext);
					authRef.current = authWithContext;
					canSetActivityRef.current = scopes.includes('rpc.activities.write');
					if (!prevAuth || prevAuth.user.id !== auth.user.id) {
						setPageReloadCounter((value) => value + 1);
					}
					authenticatedRef.current = true;
					sdk.commands
						.setConfig({
							use_interactive_pip: true
						})
						.catch((error: unknown) => {
							console.warn('Discord setConfig failed', error);
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
	}, [isDiscordActivity, setDiscordAuth, setPageReloadCounter]);

	useEffect(() => {
		const sdk = sdkRef.current;
		if (!sdk || !currentlyWatching || !authenticatedRef.current || !canSetActivityRef.current) {
			return;
		}
		const activity = buildActivityPayload(currentlyWatching, latestRoomRef.current);
		sdk.commands
			.setActivity({
				activity
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
