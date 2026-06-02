'use client';

import dynamic from 'next/dynamic';

export const AppEntryNoSsr = dynamic(
	() => import('@/components/app-entry').then((module) => module.AppEntry),
	{ ssr: false }
);
