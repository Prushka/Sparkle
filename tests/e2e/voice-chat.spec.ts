import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';

// Exercise the production hook and audio component with real browser WebRTC.
// Only microphone input and the signaling transport are supplied by the fixture.
let bundle: string;
test.beforeAll(async () => {
	const result = await build({
		entryPoints: ['tests/e2e/fixtures/voice-chat.tsx'],
		bundle: true,
		write: false,
		format: 'iife',
		jsx: 'automatic'
	});
	bundle = result.outputFiles[0].text;
});

async function fixture(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/voice-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<div id="root"></div><script src="/voice-harness.js"></script>'
		})
	);
	await page.route('**/voice-harness.js', (route) =>
		route.fulfill({ contentType: 'text/javascript', body: bundle })
	);
	await page.goto('/voice-harness');
	await page.waitForFunction(() => (window as any).voiceTest?.controllers.a);
	return errors;
}

test('boosted remote audio survives Strict Mode and stream/deafen changes', async ({ page }) => {
	const errors = await fixture(page);
	await page.evaluate(() => (window as any).voiceTest.showAudio());
	await expect(page.locator('audio')).toHaveCount(1);
	await page.evaluate(() => (window as any).voiceTest.setAudio({ deafened: true }));
	await page.evaluate(() => (window as any).voiceTest.setAudio({ deafened: false }));
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as any).voiceTest.gains
					.filter((g: any) => g.context.state !== 'closed')
					.map((g: any) => g.gain.value)
			)
		)
		.toContain(2);
	expect(errors).toEqual([]);
});

test('a pending microphone request cannot resurrect voice after leaving', async ({ page }) => {
	await fixture(page);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		await t.controllers.a.join();
		t.delayMic = true;
		t.pendingToggle = t.controllers.a.toggleMuted();
	});
	await page.evaluate(() => (window as any).voiceTest.controllers.a.leave());
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		t.releaseMic();
		await t.pendingToggle;
	});
	expect(
		await page.evaluate(() =>
			(window as any).voiceTest.streams.flatMap((s: MediaStream) =>
				s.getTracks().map((t) => t.readyState)
			)
		)
	).toEqual(['ended']);
	expect(await page.evaluate(() => (window as any).voiceTest.controllers.a.status)).toBe('idle');
});

test('concurrent unmute clicks request only one microphone', async ({ page }) => {
	await fixture(page);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		await t.controllers.a.join();
		t.delayMic = true;
		t.pendingToggle = Promise.all([t.controllers.a.toggleMuted(), t.controllers.a.toggleMuted()]);
	});
	expect(await page.evaluate(() => (window as any).voiceTest.micCalls)).toBe(1);
});

test('audio device initialization failure cannot crash the room', async ({ page }) => {
	const errors = await fixture(page);
	await page.evaluate(() => {
		const Original = window.AudioContext;
		window.AudioContext = new Proxy(Original, {
			construct() {
				throw new DOMException('Audio device unavailable', 'NotSupportedError');
			}
		});
		(window as any).voiceTest.showAudio();
	});
	await expect(page.locator('audio')).toHaveCount(1);
	expect(errors).toEqual([]);
});

test('two clients converge after simultaneous unmute without renegotiating on presence ticks', async ({
	page
}) => {
	const errors = await fixture(page);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		t.relay = true;
		await Promise.all([t.controllers.a.join(), t.controllers.b.join()]);
	});
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		await Promise.all([t.controllers.a.toggleMuted(), t.controllers.b.toggleMuted()]);
	});
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					['a', 'b'].map((id) => (window as any).voiceTest.controllers[id].connectedPeers)
				),
			{ timeout: 15000 }
		)
		.toEqual([1, 1]);
	const before = await page.evaluate(
		() =>
			(window as any).voiceTest.messages.filter((m: any) => m.broadcast.signal.kind === 'offer')
				.length
	);
	await page.evaluate(() => (window as any).voiceTest.presenceTick());
	await page.waitForTimeout(300);
	expect(
		await page.evaluate(
			() =>
				(window as any).voiceTest.messages.filter((m: any) => m.broadcast.signal.kind === 'offer')
					.length
		)
	).toBe(before);
	expect(errors).toEqual([]);
});

test('ICE received before the answer is consumed and stale sessions are ignored after reconnect', async ({
	page
}) => {
	const errors = await fixture(page);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		t.relay = true;
		t.delayAnswers = true;
		t.dropOffersFrom = 'b';
		await t.controllers.a.join();
		await t.controllers.b.join();
	});
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		await t.controllers.a.toggleMuted();
	});
	await expect
		.poll(() => page.evaluate(() => (window as any).voiceTest.answers?.length ?? 0))
		.toBeGreaterThan(0);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as any).voiceTest.messages.filter(
						(m: any) => m.from === 'b' && m.broadcast.signal.kind === 'ice'
					).length
			)
		)
		.toBeGreaterThan(0);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		for (const answer of t.answers)
			await t.controllers.a.handleVoiceBroadcast(answer.from, answer.broadcast);
		t.delayAnswers = false;
		t.dropOffersFrom = null;
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				['a', 'b'].map((id) => (window as any).voiceTest.controllers[id].connectedPeers)
			)
		)
		.toEqual([1, 1]);
	await page.evaluate(() => {
		const t = (window as any).voiceTest;
		t.stale = t.messages.filter((m: any) =>
			['offer', 'answer', 'ice', 'leave'].includes(m.broadcast.signal.kind)
		);
		t.setOnline(false);
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as any).voiceTest.pcs.every(
					(pc: RTCPeerConnection) => pc.connectionState === 'closed'
				)
			)
		)
		.toBe(true);
	await page.evaluate(() => (window as any).voiceTest.setOnline(true));
	await expect
		.poll(() =>
			page.evaluate(() =>
				['a', 'b'].map((id) => (window as any).voiceTest.controllers[id].connectedPeers)
			)
		)
		.toEqual([1, 1]);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		for (const m of t.stale)
			await t.controllers[m.from === 'a' ? 'b' : 'a'].handleVoiceBroadcast(m.from, m.broadcast);
	});
	expect(
		await page.evaluate(() =>
			['a', 'b'].map((id) => (window as any).voiceTest.controllers[id].connectedPeers)
		)
	).toEqual([1, 1]);
	expect(errors).toEqual([]);
});

test('ICE restart candidates survive an answer delayed beyond candidate delivery', async ({
	page
}) => {
	const errors = await fixture(page);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		t.relay = true;
		await t.controllers.a.join();
		await t.controllers.b.join();
		await t.controllers.a.toggleMuted();
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				['a', 'b'].map((id) => (window as any).voiceTest.controllers[id].connectedPeers)
			)
		)
		.toEqual([1, 1]);
	await page.evaluate(() => {
		const t = (window as any).voiceTest;
		t.delayAnswers = true;
		t.answers = [];
		t.pcs.find((pc: RTCPeerConnection) => pc.localDescription?.type === 'offer').restartIce();
	});
	await expect
		.poll(() => page.evaluate(() => (window as any).voiceTest.answers.length))
		.toBeGreaterThan(0);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const t = (window as any).voiceTest;
				const answer = t.answers[0];
				const ufrag = answer.broadcast.signal.description.sdp.match(/a=ice-ufrag:([^\r\n]+)/)[1];
				return t.messages.some(
					(m: any) =>
						m.from === answer.from &&
						m.broadcast.signal.kind === 'ice' &&
						m.broadcast.signal.candidate.usernameFragment === ufrag
				);
			})
		)
		.toBe(true);
	// Let the signaling relay deliver these candidates while the old remote SDP still exists.
	await page.waitForTimeout(100);
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		const answer = t.answers[0];
		await t.controllers[answer.broadcast.targetId].handleVoiceBroadcast(
			answer.from,
			answer.broadcast
		);
		t.delayAnswers = false;
	});
	await expect
		.poll(() =>
			page.evaluate(() => {
				const t = (window as any).voiceTest;
				const ufrag =
					t.answers[0].broadcast.signal.description.sdp.match(/a=ice-ufrag:([^\r\n]+)/)[1];
				return t.appliedCandidates.some(
					(entry: any) => entry.candidate?.usernameFragment === ufrag
				);
			})
		)
		.toBe(true);
	expect(errors).toEqual([]);
});

test('unresponsive peers exhaust a bounded retry budget', async ({ page }) => {
	await fixture(page);
	await page.clock.install();
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		await t.controllers.a.join();
		await t.controllers.a.handleVoiceBroadcast('b', {
			type: 'voiceSignal',
			signal: { kind: 'hello', sessionId: 'remote', muted: false }
		});
	});
	for (let i = 0; i < 7; i++) {
		await page.clock.fastForward(12500);
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
	expect(await page.evaluate(() => (window as any).voiceTest.controllers.a.peerList)).toEqual([
		{ id: 'b', connectionState: 'failed', attempts: 5 }
	]);
	const offers = await page.evaluate(
		() =>
			(window as any).voiceTest.messages.filter((m: any) => m.broadcast.signal.kind === 'offer')
				.length
	);
	await page.clock.fastForward(60000);
	expect(
		await page.evaluate(
			() =>
				(window as any).voiceTest.messages.filter((m: any) => m.broadcast.signal.kind === 'offer')
					.length
		)
	).toBe(offers);
});

test('a delayed presence snapshot does not forget a newly announced voice participant', async ({
	page
}) => {
	await fixture(page);
	await page.evaluate(() => (window as any).voiceTest.setPlayers([{ id: 'a' }]));
	await page.evaluate(async () => {
		const t = (window as any).voiceTest;
		await t.controllers.a.join();
		await t.controllers.a.handleVoiceBroadcast('b', {
			type: 'voiceSignal',
			signal: { kind: 'hello', sessionId: 'b-session', muted: true }
		});
	});
	await page.evaluate(() => (window as any).voiceTest.presenceTick());
	await page.waitForTimeout(100);
	expect(await page.evaluate(() => (window as any).voiceTest.controllers.a.peerMuted.b)).toBe(true);
});
