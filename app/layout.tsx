import type { Metadata, Viewport } from 'next';
import { AppProviders } from '@/components/providers';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import './globals.css';

export const metadata: Metadata = {
	title: {
		default: 'Sparkle',
		template: '%s | Sparkle'
	},
	applicationName: 'Sparkle',
	description: 'A cozy watch-party app for rooms, chat, media, and games.',
	icons: {
		icon: [
			{ url: '/favicon/icon-512x512.png', sizes: '512x512', type: 'image/png' },
			{ url: '/favicon/android-icon-192x192.png', sizes: '192x192', type: 'image/png' },
			{ url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
			{ url: '/favicon/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
			{ url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
			{ url: '/favicon/favicon.ico' }
		],
		shortcut: '/favicon/favicon.ico',
		apple: [
			{ url: '/favicon/apple-icon-57x57.png', sizes: '57x57' },
			{ url: '/favicon/apple-icon-60x60.png', sizes: '60x60' },
			{ url: '/favicon/apple-icon-72x72.png', sizes: '72x72' },
			{ url: '/favicon/apple-icon-76x76.png', sizes: '76x76' },
			{ url: '/favicon/apple-icon-114x114.png', sizes: '114x114' },
			{ url: '/favicon/apple-icon-120x120.png', sizes: '120x120' },
			{ url: '/favicon/apple-icon-144x144.png', sizes: '144x144' },
			{ url: '/favicon/apple-icon-152x152.png', sizes: '152x152' },
			{ url: '/favicon/apple-icon-180x180.png', sizes: '180x180' }
		]
	},
	manifest: '/manifest.json',
	appleWebApp: {
		capable: true,
		statusBarStyle: 'black-translucent',
		title: 'Sparkle'
	},
	formatDetection: {
		telephone: false
	},
	openGraph: {
		locale: 'en_US',
		type: 'website',
		siteName: 'Sparkle'
	},
	twitter: {
		card: 'summary_large_image'
	},
	other: {
		google: 'nositelinkssearchbox',
		'mobile-web-app-capable': 'yes',
		'apple-mobile-web-app-capable': 'yes',
		'apple-mobile-web-app-status-bar-style': 'black-translucent',
		'msapplication-TileColor': '#08090d'
	}
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	maximumScale: 1,
	userScalable: false,
	themeColor: '#08090d'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className="dark"
			data-theme="sunset"
			data-scroll-behavior="smooth"
			suppressHydrationWarning
		>
			<body>
				<AppProviders>{children}</AppProviders>
			</body>
		</html>
	);
}
