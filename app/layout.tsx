import { AppProviders } from '@/components/providers';
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
