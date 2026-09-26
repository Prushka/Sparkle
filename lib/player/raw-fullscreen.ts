import type { MediaFullscreenAdapter } from '@vidstack/react';

type WebKitVideo = HTMLVideoElement & {
	webkitSupportsFullscreen?: boolean;
	webkitEnterFullscreen?: () => void;
	webkitExitFullscreen?: () => void;
	webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture';
	webkitSupportsPresentationMode?: (
		mode: 'inline' | 'fullscreen' | 'picture-in-picture'
	) => boolean;
	webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void;
};

/** iOS fallback for the video created by libmedia, not Vidstack's hidden host video. */
export class RawFullscreen implements MediaFullscreenAdapter {
	private video: WebKitVideo | null = null;
	private isActive = false;
	constructor(
		private changed: (active: boolean, trigger?: Event) => void,
		private supportChanged: () => void
	) {}
	get active() {
		return this.isActive;
	}
	get supported() {
		const video = this.video;
		return !!(
			video &&
			((video.webkitEnterFullscreen &&
				video.webkitExitFullscreen &&
				video.webkitSupportsFullscreen !== false) ||
				(video.webkitSetPresentationMode && video.webkitSupportsPresentationMode?.('fullscreen')))
		);
	}
	attach(video: HTMLVideoElement | null) {
		if (this.video === video) return;
		this.listen(false);
		this.setActive(false);
		this.video = video;
		this.listen(true);
		this.supportChanged();
	}
	private listen(add: boolean) {
		const method = add ? 'addEventListener' : 'removeEventListener';
		this.video?.[method]('webkitbeginfullscreen', this.onEnter);
		this.video?.[method]('webkitendfullscreen', this.onExit);
		this.video?.[method]('webkitpresentationmodechanged', this.onPresentationChange);
		this.video?.[method]('loadedmetadata', this.supportChanged);
		this.video?.[method]('canplay', this.supportChanged);
	}
	private setActive(active: boolean, trigger?: Event) {
		if (active === this.isActive) return;
		this.isActive = active;
		this.changed(active, trigger);
	}
	private onEnter = (event: Event) => this.setActive(true, event);
	private onExit = (event: Event) => this.setActive(false, event);
	private onPresentationChange = (event: Event) =>
		this.setActive(this.video?.webkitPresentationMode === 'fullscreen', event);
	async enter() {
		if (this.active) return;
		const video = this.video;
		if (!video || !this.supported)
			throw new Error('This browser cannot show raw playback in fullscreen.');
		// Keep this call synchronous with the user's tap for Safari's activation requirement.
		if (video.webkitEnterFullscreen && video.webkitSupportsFullscreen !== false)
			video.webkitEnterFullscreen();
		else video.webkitSetPresentationMode!('fullscreen');
	}
	async exit() {
		if (!this.active || !this.video) return;
		if (this.video.webkitExitFullscreen) this.video.webkitExitFullscreen();
		else this.video.webkitSetPresentationMode?.('inline');
	}
}
