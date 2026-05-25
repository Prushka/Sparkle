import type { Metadata } from 'next';
import { AppProviders } from '@/components/providers';
import 'vidstack/player/styles/default/theme.css';
import 'vidstack/player/styles/default/layouts/video.css';
import './globals.css';

export const metadata: Metadata = {
	icons: {
		icon: '/favicon/favicon.ico',
		shortcut: '/favicon/favicon.ico',
		apple: '/favicon/apple-icon.png'
	},
	manifest: '/favicon/manifest.json'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className="dark" data-theme="sunset" suppressHydrationWarning>
			<body>
				<AppProviders>{children}</AppProviders>
			</body>
		</html>
	);
}
