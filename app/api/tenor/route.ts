import { NextResponse } from 'next/server';
import type { ChatEmojiRef } from '@/lib/player/emoji';

const TENOR_SEARCH_URL = 'https://tenor.googleapis.com/v2/search';
const TENOR_FEATURED_URL = 'https://tenor.googleapis.com/v2/featured';
const DEFAULT_TENOR_CLIENT_KEY = 'sparkle';

type TenorMedia = {
	url?: string;
};

type TenorResult = {
	id?: string;
	content_description?: string;
	itemurl?: string;
	media_formats?: {
		gif?: TenorMedia;
		tinygif?: TenorMedia;
		nanogifpreview?: TenorMedia;
		tinygifpreview?: TenorMedia;
	};
};

function tenorIdToEmojiId(id: string) {
	const safeId = id.toLowerCase().replace(/[^a-z0-9_+-]/g, '');
	return safeId ? `tenor_${safeId}` : '';
}

function toEmojiRef(result: TenorResult): ChatEmojiRef | null {
	const tenorId = String(result.id ?? '');
	const id = tenorIdToEmojiId(tenorId);
	const media = result.media_formats?.tinygif ?? result.media_formats?.gif;
	const src = media?.url;
	if (!id || !src) {
		return null;
	}

	return {
		id,
		label: result.content_description || 'Tenor GIF',
		src,
		source: 'Tenor',
		animated: true,
		kind: 'sticker',
		previewSrc:
			result.media_formats?.nanogifpreview?.url ?? result.media_formats?.tinygifpreview?.url,
		itemUrl: result.itemurl
	};
}

export async function GET(request: Request) {
	const key = process.env.SERVER_TENOR_API_KEY ?? process.env.TENOR_API_KEY ?? '';
	if (!key) {
		return NextResponse.json(
			{ error: 'Missing SERVER_TENOR_API_KEY', results: [] },
			{ status: 503 }
		);
	}

	const url = new URL(request.url);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit') ?? 24) || 24));
	const endpoint = q ? TENOR_SEARCH_URL : TENOR_FEATURED_URL;
	const params = new URLSearchParams({
		key,
		client_key: process.env.SERVER_TENOR_CLIENT_KEY || DEFAULT_TENOR_CLIENT_KEY,
		limit: String(limit),
		media_filter: 'tinygif,gif,nanogifpreview,tinygifpreview',
		contentfilter: 'medium',
		locale: 'en_US'
	});
	if (q) {
		params.set('q', q);
	}

	const response = await fetch(`${endpoint}?${params.toString()}`, { cache: 'no-store' });
	if (!response.ok) {
		return NextResponse.json({ error: 'Tenor search failed', results: [] }, { status: 502 });
	}

	const payload = (await response.json()) as { results?: TenorResult[] };
	const results = (payload.results ?? [])
		.map(toEmojiRef)
		.filter((result): result is ChatEmojiRef => result !== null);

	return NextResponse.json({ results });
}
