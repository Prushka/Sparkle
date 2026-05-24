'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

type ThemeContextValue = {
	theme: ThemeMode;
	setTheme: (_theme: ThemeMode) => void;
	resolvedTheme: ThemeMode;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setThemeState] = useState<ThemeMode>(() => {
		if (typeof window === 'undefined') {
			return 'dark';
		}
		const stored = window.localStorage.getItem('theme');
		if (stored === 'light' || stored === 'dark') {
			return stored;
		}
		return 'dark';
	});

	useEffect(() => {
		if (typeof document === 'undefined') {
			return;
		}
		document.documentElement.classList.toggle('dark', theme === 'dark');
		window.localStorage.setItem('theme', theme);
	}, [theme]);

	const value = useMemo<ThemeContextValue>(() => {
		return {
			theme,
			setTheme: setThemeState,
			resolvedTheme: theme
		};
	}, [theme]);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error('useTheme must be used within ThemeProvider');
	}
	return context;
}
