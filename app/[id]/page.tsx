import {
	generateMediaPageMetadata,
	generateMediaPageViewport
} from '@/lib/server/metadata/media-page';
import { AppEntryNoSsr } from '@/components/app-entry-no-ssr';
import { notFound } from 'next/navigation';

type RoomPageProps = {
	params: Promise<{ id: string }> | { id: string };
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function assertAppPathSegment(value: string) {
	if (!value || value.includes('.')) {
		notFound();
	}
	return value;
}

export async function generateMetadata({ params }: RoomPageProps) {
	const { id } = await Promise.resolve(params);
	return generateMediaPageMetadata({ roomId: assertAppPathSegment(id) });
}

export async function generateViewport({ params }: RoomPageProps) {
	const { id } = await Promise.resolve(params);
	return generateMediaPageViewport({ roomId: assertAppPathSegment(id) });
}

export default async function RoomPage({ params }: RoomPageProps) {
	const { id } = await Promise.resolve(params);
	assertAppPathSegment(id);
	return <AppEntryNoSsr />;
}
