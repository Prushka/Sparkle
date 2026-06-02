import {
	generateMediaPageMetadata,
	generateMediaPageViewport
} from '@/lib/server/metadata/media-page';
import { AppEntryNoSsr } from '@/components/app-entry-no-ssr';
import { notFound } from 'next/navigation';

type MediaPageProps = {
	params: Promise<{ id: string; mediaId: string }> | { id: string; mediaId: string };
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function assertAppPathSegment(value: string) {
	if (!value || value.includes('.')) {
		notFound();
	}
	return value;
}

export async function generateMetadata({ params }: MediaPageProps) {
	const { id, mediaId } = await Promise.resolve(params);
	return generateMediaPageMetadata({
		roomId: assertAppPathSegment(id),
		mediaId: assertAppPathSegment(mediaId)
	});
}

export async function generateViewport({ params }: MediaPageProps) {
	const { id, mediaId } = await Promise.resolve(params);
	return generateMediaPageViewport({
		roomId: assertAppPathSegment(id),
		mediaId: assertAppPathSegment(mediaId)
	});
}

export default async function MediaPage({ params }: MediaPageProps) {
	const { id, mediaId } = await Promise.resolve(params);
	assertAppPathSegment(id);
	assertAppPathSegment(mediaId);
	return <AppEntryNoSsr />;
}
