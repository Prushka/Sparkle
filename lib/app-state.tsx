'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Discord, Watching } from '@/lib/player/t';

type AppStateValue = {
	currentlyWatching: Watching | null;
	setCurrentlyWatching: React.Dispatch<React.SetStateAction<Watching | null>>;
	chatLayout: 'show' | 'hide';
	setChatLayout: React.Dispatch<React.SetStateAction<'show' | 'hide'>>;
	chatFocused: boolean;
	setChatFocused: React.Dispatch<React.SetStateAction<boolean>>;
	pageReloadCounter: number;
	setPageReloadCounter: React.Dispatch<React.SetStateAction<number>>;
	interacted: boolean;
	setInteracted: React.Dispatch<React.SetStateAction<boolean>>;
	playersCount: number;
	setPlayersCount: React.Dispatch<React.SetStateAction<number>>;
	pfpLastFetched: Record<string, number>;
	updatePfp: (_id: string, _revision?: number) => void;
	discordAuth: Discord | null;
	setDiscordAuth: React.Dispatch<React.SetStateAction<Discord | null>>;
};

const AppStateContext = createContext<AppStateValue | null>(null);

function readInitialChatLayout() {
	if (typeof window === 'undefined') {
		return 'show' as const;
	}
	return window.localStorage.getItem('chatLayout2') === 'hide' ? 'hide' : 'show';
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
	const [currentlyWatching, setCurrentlyWatching] = useState<Watching | null>(null);
	const [chatLayout, setChatLayout] = useState<'show' | 'hide'>(readInitialChatLayout);
	const [chatFocused, setChatFocused] = useState(false);
	const [pageReloadCounter, setPageReloadCounter] = useState(0);
	const [interacted, setInteracted] = useState(false);
	const [playersCount, setPlayersCount] = useState(-1);
	const [pfpLastFetched, setPfpLastFetched] = useState<Record<string, number>>({});
	const [discordAuth, setDiscordAuth] = useState<Discord | null>(null);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		window.localStorage.setItem('chatLayout2', chatLayout);
	}, [chatLayout]);

	const updatePfp = useCallback((id: string, revision?: number) => {
		setPfpLastFetched((store) => {
			const requestedRevision =
				typeof revision === 'number' && Number.isFinite(revision) ? revision : Date.now();
			const currentRevision = store[id] ?? 0;
			const nextRevision =
				requestedRevision > currentRevision ? requestedRevision : currentRevision + 1;
			return { ...store, [id]: nextRevision };
		});
	}, []);

	const value = useMemo<AppStateValue>(() => {
		return {
			currentlyWatching,
			setCurrentlyWatching,
			chatLayout,
			setChatLayout,
			chatFocused,
			setChatFocused,
			pageReloadCounter,
			setPageReloadCounter,
			interacted,
			setInteracted,
			playersCount,
			setPlayersCount,
			pfpLastFetched,
			updatePfp,
			discordAuth,
			setDiscordAuth
		};
	}, [
		currentlyWatching,
		chatLayout,
		chatFocused,
		pageReloadCounter,
		interacted,
		playersCount,
		pfpLastFetched,
		updatePfp,
		discordAuth
	]);

	return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
	const context = useContext(AppStateContext);
	if (!context) {
		throw new Error('useAppState must be used within AppStateProvider');
	}
	return context;
}
