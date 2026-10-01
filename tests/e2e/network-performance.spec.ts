import { expect, test, type Page, type WebSocket, type WebSocketRoute } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function fixture(page: Page, snapshot = true, holdAuth = false, liveRoom?: string) {
	const room = liveRoom || 'network-fixture';
	let media = 'network-first';
	let revision = 1;
	let releaseAuth = () => {};
	const authGate = new Promise<void>((resolve) => (releaseAuth = resolve));
	const reads = { room: 0, metadata: 0, runtime: 0, sources: 0 };
	const connections: {
		socket: WebSocketRoute;
		watcher: boolean;
		main: boolean;
		closed: boolean;
	}[] = [];
	await page.route('**/api/runtime-env', (route) => {
		reads.runtime++;
		return route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } });
	});
	await page.route('**/be/auth/plex/session', async (route) => {
		if (holdAuth) await authGate;
		await route.fulfill({ json: { enabled: false, authenticated: false, canAccessRaw: false } });
	});
	await page.route('**/be/profile/limits', (route) =>
		route.fulfill({ json: { maxPfpBytes: 12_000_000, maxUsernameLength: 32 } })
	);
	if (!liveRoom)
		await page.route(`**/be/rooms/${room}`, (route) => {
			if (route.request().method() === 'GET') reads.room++;
			else {
				media = route.request().postDataJSON().mediaId;
				revision++;
			}
			return route.fulfill({ json: { roomId: room, mediaId: media, mediaUpdated: revision } });
		});
	await page.route('**/be/media/network-*', (route) => {
		reads.metadata++;
		const id = new URL(route.request().url()).pathname.split('/').pop()!;
		return route.fulfill({
			json: {
				Id: id,
				Source: 'processed',
				Input: `${id}.mkv`,
				State: 'complete',
				Duration: 120,
				EncodedCodecs: ['h264-8bit'],
				Files: {},
				MappedAudio: {},
				Streams: [],
				Chapters: [],
				DominantColors: [],
				JobModTime: 1
			}
		});
	});
	await page.route('**/static/network-*/**', (route) => route.fulfill({ status: 404 }));
	await page.route('**/static/pfp/**', (route) => route.fulfill({ status: 404 }));
	await page.route('**/be/library/sources', (route) => {
		reads.sources++;
		return route.fulfill({ json: { sources: [] } });
	});
	await page.route('**/be/library/items?*', (route) =>
		route.fulfill({ json: { items: [], total: 0 } })
	);
	if (!liveRoom)
		await page.routeWebSocket('**/be/sync/**', (socket) => {
			const path = new URL(socket.url()).pathname;
			const watcher = path.includes('/media_');
			const main = path.includes(`/sync/${room}/`) && !watcher;
			const connection = { socket, watcher, main, closed: false };
			connections.push(connection);
			socket.onClose(() => {
				connection.closed = true;
			});
			if (snapshot && (watcher || main))
				socket.send(
					JSON.stringify({
						type: 'room',
						mediaId: media,
						mediaUpdated: revision,
						timestamp: revision
					})
				);
			socket.onMessage((raw) => {
				const message = JSON.parse(String(raw));
				if (!main || message.type !== 'new player') return;
				const id = path.split('/').pop()!;
				for (const payload of [
					{ type: 'time', time: 0, mediaId: media, mediaUpdated: revision },
					{ type: 'pause', paused: true, mediaId: media, mediaUpdated: revision },
					{
						type: 'players',
						players: [{ id, name: 'Fixture', time: 0, paused: true, lastSeen: 1 }],
						playersCount: 1
					}
				])
					socket.send(JSON.stringify({ ...payload, timestamp: revision }));
			});
		});
	return {
		reads,
		connections,
		releaseAuth,
		library: () => {
			media = '';
		},
		activeWatchers: () => connections.filter((c) => c.watcher && !c.closed).length,
		activeMain: () => connections.filter((c) => c.main && !c.closed),
		move: (next: string) => {
			media = next;
			revision++;
			for (const c of connections.filter((c) => (c.main || c.watcher) && !c.closed))
				c.socket.send(
					JSON.stringify({
						type: 'broadcast',
						broadcast: { type: 'moveTo', moveTo: next },
						timestamp: revision
					})
				);
		}
	};
}

for (const snapshot of [true, false]) {
	test(`room startup uses ${snapshot ? 'socket snapshots' : 'legacy HTTP fallback'} and retires its watcher after joining`, async ({
		page
	}) => {
		const f = await fixture(page, snapshot);
		await page.goto('/network-fixture/media/network-first');
		await expect(page.getByRole('button', { name: 'Join Watch Room', exact: true })).toBeVisible();
		await expect.poll(f.activeWatchers).toBe(1);
		// Let the compatibility fallback fire if this backend does not send snapshots.
		await page.waitForTimeout(350);
		expect(f.reads.room).toBe(snapshot ? 1 : 2);
		await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
		await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toBeEnabled();
		await expect.poll(f.activeWatchers).toBe(0);
		await page.waitForTimeout(350);
		expect(f.reads.room).toBe(snapshot ? 2 : 4);
		expect(f.reads.metadata).toBe(1);
		expect(f.reads.runtime).toBe(1);
		expect(f.activeMain()).toHaveLength(1);
		// The main socket alone must still deliver both title changes and return-to-library.
		f.move('network-next');
		await expect(page).toHaveURL('/network-fixture/media/network-next');
		await expect(page.getByRole('heading', { name: 'network-next', exact: true })).toBeVisible();
		expect(f.connections.filter((c) => c.main)).toHaveLength(1);
		expect(f.activeWatchers()).toBe(0);
		f.move('');
		await expect(page.getByRole('region', { name: 'Media library', exact: true })).toBeVisible();
		await expect.poll(f.activeWatchers).toBe(1);
		await expect.poll(() => f.activeMain().length).toBe(0);
	});
}

test('a disconnected player restores its watcher and retires it again after recovery', async ({
	page
}) => {
	const f = await fixture(page);
	await page.goto('/network-fixture/media/network-first');
	await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
	await expect.poll(f.activeWatchers).toBe(0);
	await expect.poll(() => f.activeMain().length).toBe(1);
	const main = f.activeMain()[0];
	main.closed = true;
	main.socket.close({ code: 1012, reason: 'test restart' });
	await expect.poll(f.activeWatchers).toBe(1);
	await expect.poll(() => f.activeMain().length).toBe(1);
	await expect.poll(f.activeWatchers).toBe(0);
	await expect(page.locator('[data-media-player]')).toHaveAttribute('data-paused', '');
	await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toBeEnabled();
});

test('library sources wait for session resolution and load once', async ({ page }) => {
	const f = await fixture(page, true, true);
	f.library();
	await page.goto('/network-fixture');
	await expect(page.getByRole('region', { name: 'Media library', exact: true })).toBeVisible();
	expect(f.reads.sources).toBe(0);
	f.releaseAuth();
	await expect.poll(() => f.reads.sources).toBe(1);
	await expect.poll(f.activeWatchers).toBe(1);
	expect(f.connections.filter((c) => c.watcher)).toHaveLength(1);
});

test('game channels retain remote discovery without idle playback traffic or profile reconnects', async ({
	browser,
	request
}) => {
	const file = await readFile('cache/audio-normalization/stereo.mp4').catch(() => null);
	test.skip(!file, 'Run npm run test:audio to prepare the disposable stereo fixture');
	const room = `network-tabs-${Date.now()}`;
	expect(
		(await request.post('/be/rooms', { data: { roomId: room, mediaId: 'network-first' } })).ok()
	).toBe(true);
	const pages = await Promise.all([browser.newPage(), browser.newPage()]);
	const channels: {
		socket: WebSocket;
		kind: string;
		page: number;
		received: string[];
		names: string[];
	}[] = [];
	try {
		for (const [index, page] of pages.entries()) {
			await fixture(page, true, false, room);
			await page.route('**/static/network-*/*.mp4', (route) => {
				const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
				const start = Number(range?.[1] || 0);
				const end = Math.min(Number(range?.[2] || file!.length - 1), file!.length - 1);
				return route.fulfill({
					status: range ? 206 : 200,
					contentType: 'video/mp4',
					headers: {
						'Accept-Ranges': 'bytes',
						...(range ? { 'Content-Range': `bytes ${start}-${end}/${file!.length}` } : {})
					},
					body: file!.subarray(start, end + 1)
				});
			});
			page.on('websocket', (socket) => {
				const path = decodeURIComponent(new URL(socket.url()).pathname);
				const kind = ['youtube', 'chess', 'wordle', 'cottage'].find((kind) =>
					path.includes(`/sync/${kind}:${room}/`)
				);
				if (!kind) return;
				const channel = {
					socket,
					kind,
					page: index,
					received: [] as string[],
					names: [] as string[]
				};
				channels.push(channel);
				socket.on('framereceived', ({ payload }) =>
					channel.received.push(JSON.parse(String(payload)).type)
				);
				socket.on('framesent', ({ payload }) => {
					const state = JSON.parse(String(payload)).cottage;
					for (const player of state?.players ?? []) channel.names.push(player.name);
				});
			});
			await page.goto(`/${room}/media/network-first`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Wordle', exact: true })).toBeEnabled();
		}
		await expect.poll(() => channels.filter((c) => !c.socket.isClosed()).length).toBe(8);
		await pages[0].getByRole('button', { name: 'Open profile settings', exact: true }).click();
		await pages[0].getByRole('textbox', { name: 'Username' }).fill('Network viewer');
		await pages[0].keyboard.press('Escape');
		const cottages = () => channels.filter((c) => c.kind === 'cottage' && c.page === 0);
		await expect.poll(() => cottages().flatMap((c) => c.names)).toContain('Network viewer');
		expect(cottages()).toHaveLength(1);
		await pages[0].getByRole('button', { name: 'Wordle', exact: true }).click();
		for (const page of pages)
			await expect(
				page.getByRole('button', { name: 'Close Wordle tab', exact: true })
			).toBeVisible();
		// Observe beyond the former three-second presence heartbeat interval.
		await pages[0].waitForTimeout(3250);
		for (const channel of channels) {
			expect(channel.received.length).toBeGreaterThan(0);
			expect(channel.received.every((type) => type === channel.kind)).toBe(true);
		}
		expect(
			(await request.put(`/be/rooms/${room}`, { data: { mediaId: 'network-next' } })).ok()
		).toBe(true);
		for (const page of pages) {
			await expect(page).toHaveURL(`/${room}/media/network-next`, { timeout: 15000 });
			await expect(
				page.getByRole('button', { name: 'Close Wordle tab', exact: true })
			).toBeVisible();
		}
		expect(channels).toHaveLength(8);
		expect(channels.every((c) => !c.socket.isClosed())).toBe(true);
		// An account change must still rebind the socket despite a stable player ID.
		await pages[0].route('**/be/auth/plex/session', (route) =>
			route.fulfill({
				json: {
					enabled: true,
					authenticated: true,
					canAccessRaw: true,
					name: 'Plex viewer',
					profileId: 'plex-network-viewer'
				}
			})
		);
		await pages[0].evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect.poll(() => cottages().length).toBe(2);
		expect(cottages()[0].socket.isClosed()).toBe(true);
	} finally {
		await Promise.all(pages.map((page) => page.close()));
	}
});
