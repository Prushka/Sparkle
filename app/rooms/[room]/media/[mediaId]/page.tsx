import {
	generateMediaPageMetadata,
	generateMediaPageViewport
} from '@/lib/server/metadata/media-page';
import { AppEntryNoSsr } from '@/components/app-entry-no-ssr';
import { notFound } from 'next/navigation';

type LegacyMediaPageProps = {
	params: Promise<{ room: string; mediaId: string }> | { room: string; mediaId: string };
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function assertAppPathSegment(value: string) {
	if (!value || value.includes('.')) {
		notFound();
	}
	return value;
}

export async function generateMetadata({ params }: LegacyMediaPageProps) {
	const { room, mediaId } = await Promise.resolve(params);
	return generateMediaPageMetadata({
		roomId: assertAppPathSegment(room),
		mediaId: assertAppPathSegment(mediaId)
	});
}

export async function generateViewport({ params }: LegacyMediaPageProps) {
	const { room, mediaId } = await Promise.resolve(params);
	return generateMediaPageViewport({
		roomId: assertAppPathSegment(room),
		mediaId: assertAppPathSegment(mediaId)
	});
}

export default async function LegacyMediaPage({ params }: LegacyMediaPageProps) {
	const { room, mediaId } = await Promise.resolve(params);
	assertAppPathSegment(room);
	assertAppPathSegment(mediaId);
	return <AppEntryNoSsr />;
}
