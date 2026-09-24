'use client';
import { useSearchParams } from 'next/navigation';
import { CatalogBrowser } from '@/components/catalog-browser';
import { RoomNavigationInput } from '@/components/room-navigation-input';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { IconSparkles, IconMoon, IconSun } from '@tabler/icons-react';
import { PlexAccountButton } from '@/components/plex-auth';
export function LibraryHome({
	staticBaseUrl,
	backendBaseUrl,
	roomId
}: {
	staticBaseUrl: string;
	backendBaseUrl?: string;
	roomId?: string;
}) {
	const searchParams = useSearchParams();
	const { theme, setTheme } = useTheme();
	function hrefFor(id: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (roomId) {
			params.delete('mediaId');
			return `/${encodeURIComponent(roomId)}/media/${encodeURIComponent(id)}${params.size ? `?${params}` : ''}`;
		}
		params.set('mediaId', id);
		return `/?${params}`;
	}
	return (
		<main className="min-h-screen bg-background text-foreground">
			<div className="mx-auto flex h-dvh min-h-[420px] max-w-[1600px] flex-col gap-3 overflow-hidden px-3 py-3 sm:px-6 lg:px-8">
				<header className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:gap-4">
					<div className="flex items-center gap-2">
						<span className="rounded-lg bg-primary/10 p-2 text-primary">
							<IconSparkles size={20} />
						</span>
						<h1 className="text-lg font-semibold tracking-tight">Library</h1>
					</div>
					<div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2 sm:max-w-2xl">
						<PlexAccountButton />
						<RoomNavigationInput inputId="library-room-navigation-input" className="h-9 flex-1" />
						<Button
							variant="outline"
							className="h-9 w-9 shrink-0 cursor-pointer px-0"
							aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
							onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
						>
							{theme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
						</Button>
					</div>
				</header>
				{backendBaseUrl && (
					<CatalogBrowser
						backendBaseUrl={backendBaseUrl}
						staticBaseUrl={staticBaseUrl}
						hrefFor={hrefFor}
					/>
				)}
			</div>
		</main>
	);
}
