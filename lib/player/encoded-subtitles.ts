import { backendFetch } from '@/lib/plex-access';
import { RawSubtitles } from './raw-subtitles';
import { RawSubtitleComposition } from './raw-subtitle-composition';
import { encodedURL, type EncodedPart } from './raw-encoded';

type Chunk = {
	tracks: { id: number; codec: number; header: string | null }[];
	packets: { key?: string; id: number; data: string; pts: number; duration: number }[];
};
function bytes(value: string | null) {
	return value ? Uint8Array.from(atob(value), (c) => c.charCodeAt(0)) : new Uint8Array();
}

/** Reuses the existing ASS/font, PGS and text renderers. At most three subtitle
 * chunks are held; decoding and composition remain local to each participant. */
export class EncodedSubtitles {
	private selected: number[] = [];
	private renderers: RawSubtitles[] = [];
	private composition?: RawSubtitleComposition;
	private chunks = new Map<number, Chunk>();
	private pending = new Map<number, AbortController>();
	private fed = new Set<number>();
	private seen = new Map<string, number>();
	private generation = 0;
	private time = 0;
	private position = -1;
	private failures = new Map<number, number>();
	private fonts: Uint8Array[] = [];
	private fontsLoaded = false;
	private fontRequest?: AbortController;
	constructor(
		private container: HTMLElement,
		private part: EncodedPart
	) {}
	select(ids: number[]) {
		this.renderers.forEach((renderer) => renderer.destroy());
		this.selected = [...new Set(ids)].filter((id) =>
			this.part.subtitleTracks.some((track) => track.id === id)
		);
		this.renderers = [];
		// Keep the font cache and ASS worker alive when only the selected tracks
		// change. Recreating a worker for every toggle needlessly reloads fonts.
		this.composition ??= new RawSubtitleComposition(this.container);
		for (const id of this.selected) {
			const renderer = new RawSubtitles(this.container, this.composition);
			renderer.setLanguage(this.part.subtitleTracks.find((track) => track.id === id)?.language);
			this.renderers.push(renderer);
		}
		this.fed.clear();
		this.seen.clear();
		this.update(this.time, true);
	}
	update(ms: number, reset = false) {
		this.time = ms;
		const current = Math.max(0, Math.floor(ms / (this.part.segmentSeconds * 1000)));
		if (reset || current < this.position || current > this.position + 1) {
			this.fed.clear();
			this.seen.clear();
			this.renderers.forEach((renderer) => renderer.clear());
		}
		this.position = current;
		for (const [n, request] of this.pending)
			if (n < current - 1 || n > current + 1) {
				request.abort();
				this.pending.delete(n);
			}
		for (const n of this.chunks.keys())
			if (n < current - 1 || n > current + 1) this.chunks.delete(n);
		for (const n of this.failures.keys())
			if (n < current - 1 || n > current + 1) this.failures.delete(n);
		if (this.selected.some((id) => id >= 0)) {
			for (const n of [Math.max(0, current - 1), current, current + 1]) {
				if (n * this.part.segmentSeconds >= this.part.duration) continue;
				const chunk = this.chunks.get(n);
				if (chunk) this.feed(n, chunk);
				else this.fetch(n);
			}
		}
		this.renderers.forEach((renderer) => renderer.time(ms));
	}
	private feed(n: number, chunk: Chunk) {
		if (this.fed.has(n)) return;
		if (
			this.part.hasFonts &&
			!this.fontsLoaded &&
			chunk.tracks.some(
				(track) => this.selected.includes(track.id) && [0x17016, 0x17004].includes(track.codec)
			)
		) {
			this.fetchFonts();
			return;
		}
		// Keep packet order when the network completes prefetched chunks first.
		if (n > Math.max(0, this.position - 1) && !this.fed.has(n - 1)) return;
		const first = this.fed.size === 0;
		const packets = chunk.packets.filter((packet) => {
			const key = packet.key ?? `${packet.id}:${packet.pts}:${packet.duration}:${packet.data}`;
			if (this.seen.has(key)) return false;
			this.seen.set(key, packet.pts + packet.duration);
			return true;
		});
		for (const [key, until] of this.seen)
			if (until < this.time - 2 * this.part.segmentSeconds * 1000) this.seen.delete(key);
		this.selected.forEach((id, index) => {
			const renderer = this.renderers[index],
				track = chunk.tracks.find((t) => t.id === id);
			if (!track) return;
			if (first) renderer.sink.reset(track.codec, bytes(track.header));
			for (const packet of packets)
				if (packet.id === id) renderer.sink.packet(bytes(packet.data), packet.pts, packet.duration);
		});
		this.fed.add(n);
		for (const old of this.fed) if (old < this.position - 1) this.fed.delete(old);
	}
	private fetch(n: number) {
		if (this.pending.has(n)) return;
		if (Date.now() - (this.failures.get(n) ?? 0) < 10000) return;
		const controller = new AbortController(),
			generation = this.generation;
		this.pending.set(n, controller);
		void backendFetch(encodedURL(this.part, `subtitles-${n}.json`), { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok || Number(response.headers.get('Content-Length')) > 40 * 1024 * 1024)
					throw new Error('Captions unavailable');
				return (await response.json()) as Chunk;
			})
			.then((chunk) => {
				if (generation !== this.generation || controller.signal.aborted) return;
				this.chunks.set(n, chunk);
				this.update(this.time);
			})
			.catch(() => {
				if (!controller.signal.aborted) this.failures.set(n, Date.now());
				/* A cancelled seek does not stop room playback. */
			})
			.finally(() => {
				if (this.pending.get(n) === controller) this.pending.delete(n);
			});
	}
	private fetchFonts() {
		if (this.fontRequest) return;
		const request = new AbortController();
		this.fontRequest = request;
		const generation = this.generation;
		void backendFetch(encodedURL(this.part, 'fonts.json'), { signal: request.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error('Fonts unavailable');
				return (await response.json()) as string[];
			})
			.then((fonts) => {
				if (generation === this.generation) this.fonts = fonts.map(bytes);
			})
			.catch(() => {
				/* Default font remains available if a download fails. */
			})
			.finally(() => {
				if (generation !== this.generation) return;
				this.fontsLoaded = true;
				this.composition?.setFonts(this.fonts);
				this.select(this.selected);
			});
	}
	destroy() {
		this.generation++;
		this.fontRequest?.abort();
		this.fonts = [];
		this.pending.forEach((request) => request.abort());
		this.pending.clear();
		this.renderers.forEach((renderer) => renderer.destroy());
		this.renderers = [];
		this.composition?.destroy();
		this.composition = undefined;
		this.chunks.clear();
	}
}
