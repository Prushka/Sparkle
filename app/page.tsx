import { Suspense } from 'react';
import { AppEntry } from '@/components/app-entry';

function ShellFallback() {
	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-[#08090d] px-4 text-zinc-200">
			<div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm shadow-2xl shadow-black/25">
				Loading...
			</div>
		</main>
	);
}

export default function HomePage() {
	return (
		<Suspense fallback={<ShellFallback />}>
			<AppEntry />
		</Suspense>
	);
}
