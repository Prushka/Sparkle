import { expect, test } from '@playwright/test';
import { load } from 'cheerio';
import { getJob } from '../../lib/server/jobs';
import { getRoomPreviewRecord, getRoomRecord } from '../../lib/server/rooms';

test('Plex share metadata and room resolution use public reads without credentials', async () => {
	const previous = process.env.SERVER_INTERNAL_BE;
	process.env.SERVER_INTERNAL_BE = 'http://backend.test';
	try {
		const mediaId = 'plex-fixture-1-1';
		const job = {
			Id: mediaId,
			Title: { title: 'A shared movie' },
			Summary: 'A complete movie description.',
			Poster: `/media/${mediaId}/artwork/poster`,
			DominantColors: ['#102030'],
			Raw: { parts: [] }
		};
		const paths: string[] = [];
		const fetchPreview: typeof fetch = async (input, init) => {
			paths.push(String(input));
			expect(new Headers(init?.headers).has('Cookie')).toBe(false);
			expect(init?.credentials).toBeUndefined();
			return Response.json(paths.length === 1 ? { roomId: 'shared-room', mediaId } : job);
		};
		const room = await getRoomPreviewRecord(fetchPreview, 'shared-room');
		expect(await getJob(fetchPreview, room!.mediaId)).toEqual(job);
		expect(paths).toEqual([
			'http://backend.test/share/rooms/shared-room',
			`http://backend.test/media/${mediaId}`
		]);
		const missing: typeof fetch = async () => new Response(null, { status: 404 });
		expect(await getJob(missing, mediaId)).toBeNull();
		expect(await getRoomPreviewRecord(missing, 'missing')).toBeNull();
	} finally {
		if (previous === undefined) delete process.env.SERVER_INTERNAL_BE;
		else process.env.SERVER_INTERNAL_BE = previous;
	}
});

test('private and missing rooms use public fallback metadata; server faults still surface', async () => {
	const previous = process.env.SERVER_INTERNAL_BE;
	process.env.SERVER_INTERNAL_BE = 'http://backend.test';
	try {
		for (const status of [401, 403, 404]) {
			const fetchRoom: typeof fetch = async () => new Response(null, { status });
			expect(await getRoomRecord(fetchRoom, 'private-room')).toBeNull();
		}
		const unavailable: typeof fetch = async () => new Response(null, { status: 503 });
		await expect(getRoomRecord(unavailable, 'private-room')).rejects.toThrow('503');
		await expect(getRoomPreviewRecord(unavailable, 'private-room')).rejects.toThrow('503');
		await expect(getJob(unavailable, 'encoded-media')).rejects.toThrow('503');
		const fetchRoom: typeof fetch = async () =>
			Response.json({ roomId: 'public-room', mediaId: 'encoded-media' });
		expect(await getRoomRecord(fetchRoom, 'public-room')).toEqual({
			roomId: 'public-room',
			mediaId: 'encoded-media'
		});
	} finally {
		if (previous === undefined) delete process.env.SERVER_INTERNAL_BE;
		else process.env.SERVER_INTERNAL_BE = previous;
	}
});

test('anonymous Raw links render complete crawler previews while playback stays blocked', async ({
	request,
	page
}) => {
	const mediaId = process.env.SPARKLE_RAW_TEST_ID;
	test.skip(!mediaId, 'Set SPARKLE_RAW_TEST_ID for real Plex preview verification');
	const metadata = await request.get(`/be/media/${mediaId}`);
	expect(metadata.status()).toBe(200);
	const job = await metadata.json();
	const title = job.Title.episode
		? `${job.Title.episode.se} - ${job.Title.episode.title}`.trim()
		: job.Title.title.trim();
	const roomId = process.env.SPARKLE_RAW_TEST_ROOM || `preview-${Date.now()}`;
	const link = `/${roomId}/media/${mediaId}`;
	const preview = await request.get(link, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
	expect(preview.status()).toBe(200);
	const $ = load(await preview.text());
	expect($('meta[property="og:title"]').attr('content')).toBe(title);
	expect($('meta[name="twitter:title"]').attr('content')).toBe(title);
	expect($('meta[property="og:description"]').attr('content')).toBe(job.Summary);
	expect($('meta[name="theme-color"]').attr('content')).toBe(job.DominantColors?.[0] ?? '#f0f0f0');
	const artwork = $('meta[property="og:image"]').attr('content');
	expect(artwork).toBeTruthy();
	const image = await request.get(artwork!);
	expect(image.status()).toBe(200);
	expect(image.headers()['content-type']).toMatch(/^image\//);
	const oembed = await request.get(`/json/${mediaId}?room=${roomId}`);
	expect(oembed.status()).toBe(200);
	expect(await oembed.json()).toMatchObject({ title, thumbnail_url: artwork });
	if (process.env.SPARKLE_RAW_TEST_ROOM) {
		const roomPreview = await request.get(`/${roomId}`, {
			headers: { 'User-Agent': 'Twitterbot/1.0' }
		});
		expect(load(await roomPreview.text())('meta[property="og:title"]').attr('content')).toBe(title);
		expect(await (await request.get(`/json/${roomId}`)).json()).toMatchObject({ title });
	}
	const part = job.Raw.parts[0];
	for (const path of [
		part.url,
		`/media/${mediaId}/parts/${part.id}/encoded/av1/manifest`,
		`/media/${mediaId}/parts/${part.id}/encoded/hevc/manifest`
	]) {
		expect((await request.get(`/be${path}`)).status()).toBe(401);
		expect((await request.head(`/be${path}`)).status()).toBe(401);
	}
	expect((await request.get('/be/library/items?source=plex')).status()).toBe(401);
	if (!process.env.SPARKLE_RAW_TEST_ROOM) {
		// An expired/missing room correctly redirects to Library. Create an empty
		// disposable room so the UI must authorize selecting this public metadata.
		expect((await request.post('/be/rooms', { data: { roomId } })).status()).toBe(200);
	}
	await page.goto(link);
	await expect(
		page.getByRole('heading', { name: 'Plex access required', exact: true })
	).toBeVisible();
});
