import type { SubtitleMergeCue } from './text-subtitle-cues';

/** Mirrors the bounded text window onto the actual video for iOS native fullscreen. */
export class RawNativeSubtitles {
	private video: HTMLVideoElement | null = null;
	private track?: TextTrack;
	private tracks = new WeakMap<HTMLVideoElement, TextTrack>();
	private cues: SubtitleMergeCue[] = [];
	private nativeCues = new Map<string, VTTCue>();
	private fullscreen = false;

	attach(video: HTMLVideoElement | null) {
		if (video === this.video) return;
		this.detach();
		this.video = video;
		this.sync();
	}

	update(cues: SubtitleMergeCue[]) {
		this.cues = cues;
		this.sync();
	}

	setFullscreen(active: boolean) {
		this.fullscreen = active;
		this.sync();
	}

	private sync() {
		if (!this.video || typeof VTTCue === 'undefined') return;
		if (!this.track && this.cues.length) {
			// A <track> element's asynchronous resource load can discard injected cues.
			this.track =
				this.tracks.get(this.video) ?? this.video.addTextTrack('subtitles', 'Sparkle subtitles');
			this.tracks.set(this.video, this.track);
			this.track.mode = 'hidden';
		}
		const track = this.track;
		if (!track) return;
		const next = new Map<string, VTTCue>();
		for (const cue of this.cues) {
			const key = JSON.stringify([cue.startTime, cue.endTime, cue.text]);
			let native = this.nativeCues.get(key);
			if (!native || native.track !== track) {
				// Raw text was already decoded/stripped; don't interpret literal markup twice.
				const text = cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
				native = new VTTCue(cue.startTime, cue.endTime, text);
				track.addCue(native);
			}
			next.set(key, native);
		}
		for (const [key, cue] of this.nativeCues)
			if (!next.has(key) && cue.track === track) track.removeCue(cue);
		this.nativeCues = next;
		// Hidden tracks still schedule active cues, but never duplicate the inline overlay.
		const mode = this.fullscreen && next.size ? 'showing' : 'hidden';
		if (track.mode !== mode) track.mode = mode;
	}

	private detach() {
		if (this.track) {
			for (const cue of this.nativeCues.values())
				if (cue.track === this.track) this.track.removeCue(cue);
			// addTextTrack has no remove API. Release every cue and disable the old video track.
			this.track.mode = 'disabled';
		}
		this.nativeCues.clear();
		this.track = undefined;
		this.video = null;
	}

	destroy() {
		this.detach();
		this.cues = [];
	}
}
