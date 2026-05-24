import { AppProviders } from '@/components/providers';
import 'vidstack/player/styles/default/theme.css';
import 'vidstack/player/styles/default/layouts/video.css';
import './globals.css';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className="dark" data-theme="sunset" suppressHydrationWarning>
			<body>
				<AppProviders>{children}</AppProviders>
			</body>
		</html>
	);
}
