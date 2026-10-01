import { backendFetch } from '@/lib/plex-access';
import type { RawPart } from './raw-types';

// Keep aligned with the server's five-second preview buckets. No timeline
// enumeration, manifest download or speculative whole-title generation.
export const PREVIEW_INTERVAL = 5;
export const PREVIEW_DWELL_MS = 100;
const maxEntries = 64;
const maxBytes = 8 << 20;
const freshness = 5 * 60_000;

export function plexPreviewURL(base: string, parts: RawPart[], seconds: number, duration: number) {
	if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return null;
	const time = Math.max(0, Math.min(seconds, duration - 0.001));
	const part = parts.find((p, index) => {
		const end = p.duration > 0 ? p.start + p.duration : (parts[index + 1]?.start ?? duration);
		return Number.isFinite(p.start) && time >= p.start && time < end;
	});
	if (!part || !part.url.endsWith('/file')) return null;
	const frame = Math.floor((time - part.start) / PREVIEW_INTERVAL);
	return `${base.replace(/\/$/, '')}${part.url.slice(0, -5)}/preview/${frame}.jpg`;
}

// Owned by one title and auth revision. Nothing private survives a media/session
// change or enters persistent browser storage. URLs are revoked on every eviction.
export class PlexPreviewCache {
	private entries = new Map<string, { url: string; bytes: number; expires: number }>();
	private bytes = 0;
	private retryAt = 0;
	private disposed = false;

	get(key: string) {
		const item = this.entries.get(key);
		if (!item) return null;
		if (item.expires <= Date.now()) {
			this.remove(key);
			return null;
		}
		this.entries.delete(key);
		this.entries.set(key, item);
		return item.url;
	}

	async load(key: string, signal: AbortSignal) {
		const cached = this.get(key);
		if (cached) return cached;
		if (this.disposed || Date.now() < this.retryAt || signal.aborted) return null;
		try {
			const response = await backendFetch(key, {
				signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
				cache: 'no-store'
			});
			if (!response.ok) throw new Error('Preview unavailable');
			if (!response.headers.get('content-type')?.startsWith('image/jpeg'))
				throw new Error('Invalid preview');
			const blob = await response.blob();
			if (signal.aborted || this.disposed) return null;
			if (!blob.size || blob.size > 256 << 10) throw new Error('Invalid preview size');
			while (this.entries.size >= maxEntries || this.bytes + blob.size > maxBytes) {
				this.remove(this.entries.keys().next().value!);
			}
			const url = URL.createObjectURL(blob);
			this.entries.set(key, { url, bytes: blob.size, expires: Date.now() + freshness });
			this.bytes += blob.size;
			return url;
		} catch {
			// A broken/older backend must not receive a request for every mouse move.
			if (!signal.aborted) this.retryAt = Date.now() + 5_000;
			return null;
		}
	}

	private remove(key: string) {
		const item = this.entries.get(key);
		if (!item) return;
		URL.revokeObjectURL(item.url);
		this.bytes -= item.bytes;
		this.entries.delete(key);
	}

	dispose() {
		this.disposed = true;
		for (const key of this.entries.keys()) this.remove(key);
	}
}
