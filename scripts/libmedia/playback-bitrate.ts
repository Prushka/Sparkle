// Compressed packet bytes over media time, not bursty download throughput.
// Buckets are bounded independently of movie duration and cleared on seeks.
export default class PlaybackBitrate {
	private tracks = new Map<number, Map<number, number>>();
	add(track: number, milliseconds: number, bytes: number) {
		if (!Number.isFinite(milliseconds) || milliseconds < 0 || bytes <= 0) return;
		let buckets = this.tracks.get(track);
		if (!buckets) {
			if (this.tracks.size >= 8) this.tracks.delete(this.tracks.keys().next().value!);
			this.tracks.set(track, (buckets = new Map()));
		}
		const second = Math.floor(milliseconds / 1000);
		buckets.set(second, (buckets.get(second) ?? 0) + bytes);
		while (buckets.size > 120) buckets.delete(buckets.keys().next().value!);
	}
	read(track: number, milliseconds: number): number | undefined {
		const buckets = this.tracks.get(track);
		if (!buckets) return;
		const end = Math.floor(milliseconds / 1000);
		const start = Math.max(0, end - 3);
		if (end <= start) return;
		let bytes = 0;
		for (let second = start; second < end; second++) {
			const value = buckets.get(second);
			// Seek, startup or a sparse/stalled stream: wait for a complete window.
			if (value === undefined) return;
			bytes += value;
		}
		return Math.round((bytes * 8) / (end - start));
	}
}
