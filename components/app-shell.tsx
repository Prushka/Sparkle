'use client';

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAppState } from '@/lib/app-state';

function AppShellFrame({ children }: { children: React.ReactNode }) {
	return (
		<main id="main-page" className="flex min-h-full w-full flex-col items-center gap-1">
			{children}
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
	// Browsing the catalog must not remount the room or reconnect its socket.
	const routeParams = new URLSearchParams(searchParams.toString());
	for (const name of ['libraryPath', 'source', 'libraryId', 'kind', 'sort', 'query'])
		routeParams.delete(name);
	const key = `${pathname}?${routeParams}${pageReloadCounter}`;

	return (
		<AppShellFrame>
			<div key={key} className="w-full">
				{children}
			</div>
		</AppShellFrame>
	);
}
