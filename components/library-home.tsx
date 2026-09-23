'use client';
import { useSearchParams } from 'next/navigation';
import { CatalogBrowser } from '@/components/catalog-browser';
import { RoomNavigationInput } from '@/components/room-navigation-input';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { IconSparkles, IconMoon, IconSun } from '@tabler/icons-react';
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
		if (roomId) return `/${encodeURIComponent(roomId)}/media/${encodeURIComponent(id)}`;
		const params = new URLSearchParams(searchParams.toString());
		params.set('mediaId', id);
		return `/?${params}`;
	}
	return (
		<main className="min-h-screen bg-background text-foreground">
			<div className="mx-auto flex h-dvh min-h-[560px] max-w-[1600px] flex-col gap-4 overflow-hidden px-4 py-5 sm:gap-7 sm:px-8 lg:px-12">
				<header className="flex shrink-0 flex-wrap items-center justify-between gap-5">
					<div className="flex items-center gap-3">
						<span className="rounded-xl bg-primary/10 p-2 text-primary">
							<IconSparkles size={24} />
						</span>
						<div>
							<p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
								Sparkle
							</p>
							<h1 className="text-xl font-semibold tracking-tight">Library</h1>
						</div>
					</div>
					<div className="flex w-full gap-2 sm:w-auto sm:max-w-xl sm:flex-1">
						<RoomNavigationInput inputId="library-room-navigation-input" className="flex-1" />
						<Button
							variant="outline"
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
