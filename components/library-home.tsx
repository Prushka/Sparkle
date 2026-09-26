'use client';
import { useSearchParams } from 'next/navigation';
import { CatalogBrowser } from '@/components/catalog-browser';
import { RoomNavigationInput } from '@/components/room-navigation-input';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { IconMessagePlus, IconMoon, IconSun } from '@tabler/icons-react';
import { PlexAccountButton } from '@/components/plex-auth';
export function LibraryHome({
	staticBaseUrl,
	backendBaseUrl,
	requestUrl,
	roomId
}: {
	staticBaseUrl: string;
	backendBaseUrl?: string;
	requestUrl?: string;
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
				<header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:gap-4">
					{requestUrl && (
						<Button asChild variant="outline" className="h-9">
							<a href={requestUrl} target="_blank" rel="noopener noreferrer">
								<IconMessagePlus size={19} aria-hidden="true" />
								Request
							</a>
						</Button>
					)}
					<div className="col-start-2 min-w-0 justify-self-end sm:ml-auto">
						<PlexAccountButton />
					</div>
					<div className="col-span-2 flex min-w-0 gap-2 sm:max-w-lg sm:flex-1">
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
