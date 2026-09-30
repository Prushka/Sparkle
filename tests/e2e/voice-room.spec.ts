import { expect, test, firefox, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const backend = process.env.SPARKLE_TEST_VOICE_BACKEND;
test.use({ launchOptions: { args: [] } });

// Real room UI and Go WebSockets; synthesized input avoids recording a user's mic.
test('three room players exchange audio, mute, reconnect and retain playback sync', async ({
	browser,
	request
}, testInfo) => {
	test.skip(!backend, 'Set SPARKLE_TEST_VOICE_BACKEND to a disposable backend');
	const file = await readFile('cache/audio-normalization/stereo.mp4').catch(() => null);
	test.skip(!file, 'Run npm run test:audio to prepare the disposable stereo fixture');
	const room = `voice-test-${Date.now()}`;
	expect(
		(
			await request.post(`${backend}/rooms`, { data: { roomId: room, mediaId: 'voice-fixture' } })
		).ok()
	).toBe(true);
	const otherBrowser = process.env.SPARKLE_TEST_VOICE_MIXED
		? await firefox.launch({ channel: undefined, headless: true })
		: null;
	const pages = await Promise.all([
		browser.newPage(),
		browser.newPage(),
		(otherBrowser ?? browser).newPage()
	]);
	const errors: string[] = [];
	const sensitiveLogs: string[] = [];
	async function connected(page: Page, count: number) {
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(window as any).voicePCs.filter(
								(pc: RTCPeerConnection) => pc.connectionState === 'connected'
							).length
					),
				{ timeout: 20000 }
			)
			.toBe(count);
	}
	async function receiving(page: Page, count: number) {
		const baseline = await page.evaluate(() => (window as any).voiceEnergy());
		await expect
			.poll(
				() =>
					page.evaluate(async (previous) => {
						const energy: number[] = await (window as any).voiceEnergy();
						return energy.filter((value, i) => value > (previous[i] ?? 0) + 0.001).length;
					}, baseline),
				{ timeout: 20000 }
			)
			.toBe(count);
		await expect
			.poll(() =>
				page
					.locator('audio')
					.evaluateAll(
						(elements) =>
							elements.filter((el: any) => el.srcObject && !el.paused && !el.muted).length
					)
			)
			.toBe(count);
	}
	try {
		for (const page of pages) {
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (
					/"type":"voiceConfig"|"type":"voiceSignal"|"candidate":"candidate:/.test(message.text())
				)
					sensitiveLogs.push(message.text().slice(0, 40));
			});
			await page.addInitScript(() => {
				const testWindow = window as any;
				testWindow.voicePCs = [];
				testWindow.voiceSockets = [];
				testWindow.voiceTracks = [];
				testWindow.voiceSignals = [];
				testWindow.voiceEnergy = async () =>
					Promise.all(
						testWindow.voicePCs.map(async (pc: RTCPeerConnection) => {
							if (pc.connectionState !== 'connected') return 0;
							const stats = await pc.getStats();
							return [...stats.values()]
								.filter((s) => s.type === 'inbound-rtp' && s.kind === 'audio')
								.reduce((sum, s) => sum + (s.totalAudioEnergy ?? 0), 0);
						})
					);
				const summarize = (data: any, direction: string) => {
					try {
						const p = JSON.parse(data);
						if (p.broadcast?.type === 'voiceSignal')
							testWindow.voiceSignals.push({
								direction,
								from: p.firedBy?.id,
								target: p.broadcast.targetId,
								...{
									kind: p.broadcast.signal.kind,
									session: p.broadcast.signal.sessionId,
									targetSession: p.broadcast.signal.targetSessionId
								}
							});
					} catch {}
				};
				window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
					construct(Target, args) {
						const pc = new Target(...args);
						testWindow.voicePCs.push(pc);
						return pc;
					}
				});
				window.WebSocket = new Proxy(window.WebSocket, {
					construct(Target, args) {
						const socket = new Target(...args);
						const send = socket.send.bind(socket);
						socket.send = (data) => {
							summarize(data, 'out');
							send(data);
						};
						socket.addEventListener('message', (event) => summarize(event.data, 'in'));
						testWindow.voiceSockets.push(socket);
						return socket;
					}
				});
				navigator.mediaDevices.getUserMedia = async () => {
					const context = new AudioContext();
					await context.resume();
					const oscillator = context.createOscillator();
					const dest = context.createMediaStreamDestination();
					oscillator.connect(dest);
					oscillator.start();
					testWindow.voiceTracks.push(...dest.stream.getTracks());
					return dest.stream;
				};
			});
			await page.route('**/api/runtime-env', (route) =>
				route.fulfill({ json: { backendBaseUrl: backend, staticBaseUrl: backend + '/static' } })
			);
			await page.route(`${backend}/media/voice-fixture`, (route) =>
				route.fulfill({
					json: {
						Id: 'voice-fixture',
						Source: 'processed',
						Input: 'Voice fixture.mkv',
						State: 'complete',
						Duration: 48,
						EncodedCodecs: ['h264-8bit'],
						Files: {},
						MappedAudio: {},
						Streams: [],
						Chapters: [],
						DominantColors: [],
						JobModTime: 1
					}
				})
			);
			await page.route('**/static/voice-fixture/**', (route) => {
				if (!new URL(route.request().url()).pathname.endsWith('.mp4'))
					return route.fulfill({ status: 404 });
				const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
				const start = range ? Number(range[1]) : 0;
				const end = Math.min(range?.[2] ? Number(range[2]) : file.length - 1, file.length - 1);
				return route.fulfill({
					status: range ? 206 : 200,
					contentType: 'video/mp4',
					headers: {
						'Accept-Ranges': 'bytes',
						...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {})
					},
					body: file.subarray(start, end + 1)
				});
			});
			await page.goto(`/${room}/media/voice-fixture`);
			await page.getByRole('button', { name: 'Join Watch Room', exact: true }).click();
			await expect(
				page.getByRole('button', { name: 'Unmute microphone', exact: true })
			).toBeEnabled();
		}
		// A listen-only newcomer must hear an existing speaker without first using its mic.
		await pages[0].getByRole('button', { name: 'Unmute microphone', exact: true }).click();
		await connected(pages[0], 2);
		for (const page of pages.slice(1)) {
			await connected(page, 1);
			await receiving(page, 1);
		}
		await Promise.all(
			pages
				.slice(1)
				.map((page) => page.getByRole('button', { name: 'Unmute microphone', exact: true }).click())
		);
		for (const page of pages) {
			await connected(page, 2);
			await receiving(page, 2);
		}
		if (process.env.SPARKLE_TEST_VOICE_EXPECT_TURN) {
			for (const page of pages)
				expect(
					await page.evaluate(() =>
						(window as any).voicePCs
							.filter((pc: RTCPeerConnection) => pc.connectionState === 'connected')
							.every((pc: RTCPeerConnection) =>
								pc
									.getConfiguration()
									.iceServers?.some((server) => server.username && server.credential)
							)
					)
				).toBe(true);
		}
		for (const page of pages)
			await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
		for (const page of pages) {
			await connected(page, 2);
			expect(
				await page.evaluate(() =>
					(window as any).voiceTracks.every((track: MediaStreamTrack) => !track.enabled)
				)
			).toBe(true);
		}
		await Promise.all(
			pages.map((page) =>
				page.getByRole('button', { name: 'Unmute microphone', exact: true }).click()
			)
		);
		for (const page of pages) {
			await connected(page, 2);
			await receiving(page, 2);
		}
		await pages[1].getByRole('button', { name: 'Deafen', exact: true }).click();
		await expect
			.poll(() =>
				pages[1]
					.locator('audio')
					.evaluateAll((elements) =>
						elements.filter((e: any) => e.srcObject).every((e: any) => e.muted)
					)
			)
			.toBe(true);
		await pages[1].getByRole('button', { name: 'Undeafen', exact: true }).click();
		await pages[1].evaluate(() => {
			for (const ws of (window as any).voiceSockets as WebSocket[])
				if (ws.url.includes('/sync/') && !ws.url.includes('/media_')) ws.close();
		});
		await expect(
			pages[1].getByRole('button', { name: 'Mute microphone', exact: true })
		).toBeEnabled({ timeout: 20000 });
		for (const page of pages) {
			await connected(page, 2);
			await receiving(page, 2);
		}
		const player = pages[0].locator('[data-media-player]');
		await player.focus();
		await pages[0].keyboard.press('k');
		await expect(pages[1].locator('[data-media-player]')).toHaveAttribute('data-paused', '');
		await pages[0].keyboard.press('ArrowRight');
		await expect
			.poll(() =>
				pages[1]
					.locator('[data-media-player] video')
					.evaluate((el: HTMLVideoElement) => el.currentTime)
			)
			.toBeGreaterThan(3);
		await pages[0].keyboard.press('k');
		await expect(pages[1].locator('[data-media-player]')).not.toHaveAttribute('data-paused', '');
		expect(errors).toEqual([]);
		expect(sensitiveLogs).toEqual([]);
		await pages[1].evaluate(() => {
			for (const socket of (window as any).voiceSockets as WebSocket[])
				if (
					socket.readyState === WebSocket.OPEN &&
					socket.url.includes('/sync/') &&
					!socket.url.includes('/media_')
				) {
					// Inject the server's terminal authorization close code. A client-
					// initiated custom close can be reported as 1006 during teardown.
					socket.close();
					socket.dispatchEvent(
						new CloseEvent('close', { code: 4003, reason: 'authorization revoked' })
					);
				}
		});
		await expect
			.poll(() =>
				pages[1].evaluate(() =>
					(window as any).voiceTracks.every(
						(track: MediaStreamTrack) => track.readyState === 'ended'
					)
				)
			)
			.toBe(true);
	} catch (error) {
		const diagnostics = await Promise.all(
			pages.map((page) =>
				page.evaluate(() => ({
					signals: (window as any).voiceSignals,
					pcs: (window as any).voicePCs?.map((pc: RTCPeerConnection) => ({
						state: pc.connectionState,
						ice: pc.iceConnectionState,
						signaling: pc.signalingState,
						senders: pc.getSenders().map((s) => s.track?.readyState)
					})),
					videos: [...document.querySelectorAll('video')].map((v) => ({
						time: v.currentTime,
						duration: v.duration,
						ready: v.readyState,
						error: v.error?.message,
						paused: v.paused
					}))
				}))
			)
		);
		await testInfo.attach('voice-diagnostics', {
			body: JSON.stringify(diagnostics),
			contentType: 'application/json'
		});
		await writeFile(testInfo.outputPath('voice-diagnostics.json'), JSON.stringify(diagnostics));
		throw error;
	} finally {
		await Promise.all(pages.map((page) => page.close()));
		await otherBrowser?.close();
	}
});
