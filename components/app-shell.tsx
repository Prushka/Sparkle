'use client';

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAppState } from '@/lib/app-state';

function AppShellFrame({ children }: { children: React.ReactNode }) {
	return (
		<main id="main-page" className="flex min-h-full w-full flex-col items-center gap-1">
			{children}
			<footer className="mt-auto flex w-full flex-col items-center justify-center p-2">
				<div className="text-xs max-sm:text-[0.65rem]">
					© 2025 hmph | This site does not store any files on its server.
				</div>
			</footer>
		</main>
	);
}

export function AppShellFallback({ children }: { children: React.ReactNode }) {
	return (
		<AppShellFrame>
			<div className="w-full">{children}</div>
		</AppShellFrame>
	);
}

export function AppShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { pageReloadCounter } = useAppState();
	const key = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}${pageReloadCounter}`;

	return (
		<AppShellFrame>
			<div key={key} className="w-full">
				{children}
			</div>
		</AppShellFrame>
	);
}
