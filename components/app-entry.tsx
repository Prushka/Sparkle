'use client';

import { AppClient } from '@/components/app-client';

export function AppEntry() {
	return (
		<div className="w-full" data-sparkle-app-mounted="true">
			<AppClient />
		</div>
	);
}
