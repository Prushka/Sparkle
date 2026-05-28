'use client';

import { Suspense, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/lib/theme';
import { AppStateProvider } from '@/lib/app-state';
import { DiscordBridge } from '@/components/discord-bridge';
import { AppShell, AppShellFallback } from '@/components/app-shell';

export function AppProviders({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider>
			<AppStateProvider>
				<Suspense fallback={null}>
					<DiscordBridge />
				</Suspense>
				<Toaster
					position="top-center"
					richColors
					toastOptions={{
						classNames: {
							toast:
								'border-border/60 bg-background/55 shadow-none backdrop-blur-md supports-[backdrop-filter]:bg-background/45',
							description: 'text-muted-foreground'
						}
					}}
				/>
				<Suspense fallback={<AppShellFallback>{children}</AppShellFallback>}>
					<AppShell>{children}</AppShell>
				</Suspense>
			</AppStateProvider>
		</ThemeProvider>
	);
}
