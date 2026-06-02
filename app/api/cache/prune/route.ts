import { NextResponse } from 'next/server';
import { getBackendBaseUrl } from '@/lib/server/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOLDOWN_MS = 3 * 60 * 1000;

type CachePruneState = {
	lastFrontendCachePrune?: number;
};

const globalState = globalThis as typeof globalThis & CachePruneState;

function retryAfterSeconds(retryAfterMs: number) {
	return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

export async function POST() {
	const now = Date.now();
	const retryAfterMs = COOLDOWN_MS - (now - (globalState.lastFrontendCachePrune ?? 0));
	if (retryAfterMs > 0) {
		const retryAfter = retryAfterSeconds(retryAfterMs);
		return NextResponse.json(
			{
				ok: false,
				cooldownSeconds: retryAfter
			},
			{
				status: 429,
				headers: {
					'Retry-After': String(retryAfter),
					'Cache-Control': 'no-store, max-age=0'
				}
			}
		);
	}

	const backendResponse = await fetch(`${getBackendBaseUrl()}/cache/prune`, {
		method: 'POST',
		cache: 'no-store'
	});
	const payload = await backendResponse.json().catch(() => ({}));
	if (!backendResponse.ok) {
		const retryAfter = backendResponse.headers.get('Retry-After');
		return NextResponse.json(
			{
				ok: false,
				backend: payload
			},
			{
				status: backendResponse.status,
				headers: {
					...(retryAfter ? { 'Retry-After': retryAfter } : {}),
					'Cache-Control': 'no-store, max-age=0'
				}
			}
		);
	}

	globalState.lastFrontendCachePrune = now;
	return NextResponse.json(
		{
			ok: true,
			backend: payload
		},
		{
			headers: {
				'Cache-Control': 'no-store, max-age=0'
			}
		}
	);
}
