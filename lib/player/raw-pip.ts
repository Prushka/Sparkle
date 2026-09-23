import type { MediaProviderAdapter } from '@vidstack/react';

type MediaPictureInPictureAdapter = NonNullable<MediaProviderAdapter['pictureInPicture']>;

type DocumentPiP = { requestWindow(options: { width: number; height: number }): Promise<Window> };

/** Keep the original renderer and subtitle layers together; never re-encode HDR for PiP. */
export class RawPictureInPicture implements MediaPictureInPictureAdapter {
	private pipWindow?: Window;
	private restore?: () => void;
	private nativeVideo?: HTMLVideoElement;
	private destroyed = false;
	private entering = false;
	private revision = 0;
	constructor(
		private surface: HTMLElement,
		private getVideo: () => HTMLVideoElement | null,
		private canRender: () => boolean,
		private changed: (active: boolean) => void,
		private togglePlayback: () => void
	) {}
	private get documentAPI() {
		// Document PiP is only available to a top-level page, not an Activity iframe.
		if (window.top !== window) return undefined;
		return (window as Window & { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
	}
	get active() {
		return (
			!!this.pipWindow ||
			(!!this.nativeVideo && document.pictureInPictureElement === this.nativeVideo)
		);
	}
	get supported() {
		return (
			this.canRender() &&
			(!!this.documentAPI || (!!document.pictureInPictureEnabled && !!this.getVideo()?.readyState))
		);
	}
	async enter() {
		if (this.destroyed || this.active || this.entering || !this.supported) return;
		this.entering = true;
		try {
			await this.open(++this.revision);
		} finally {
			this.entering = false;
		}
	}
	private async open(revision: number) {
		if (!this.documentAPI) {
			const video = this.getVideo();
			if (!video?.readyState)
				throw new Error('This browser cannot show raw playback in picture-in-picture.');
			this.nativeVideo = video;
			video.addEventListener('leavepictureinpicture', this.onNativeExit, { once: true });
			try {
				await video.requestPictureInPicture();
				if (this.destroyed || revision !== this.revision) {
					await this.exit();
					return;
				}
				this.changed(true);
			} catch (error) {
				video.removeEventListener('leavepictureinpicture', this.onNativeExit);
				this.nativeVideo = undefined;
				throw error;
			}
			return;
		}
		const parent = this.surface.parentElement;
		if (!parent) return;
		const pip = await this.documentAPI.requestWindow({ width: 640, height: 360 });
		if (this.destroyed || revision !== this.revision || !parent.isConnected) {
			pip.close();
			return;
		}
		this.pipWindow = pip;
		const placeholder = document.createComment('raw picture-in-picture');
		parent.insertBefore(placeholder, this.surface);
		this.restore = () => {
			if (this.pipWindow !== pip) return;
			placeholder.replaceWith(this.surface);
			this.pipWindow = undefined;
			this.restore = undefined;
			this.changed(false);
		};
		pip.addEventListener('pagehide', this.restore, { once: true });
		const style = pip.document.createElement('style');
		style.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:white;font:14px system-ui}
			video,canvas{max-width:100%;max-height:100%;object-fit:contain}
			button{position:fixed;bottom:12px;border:1px solid #ffffff55;border-radius:8px;background:#000b;color:white;padding:8px 12px;cursor:pointer;z-index:10}
			button:focus-visible{outline:2px solid white;outline-offset:2px}`;
		pip.document.head.append(style);
		pip.document.title = 'Sparkle · Picture-in-picture';
		const play = pip.document.createElement('button');
		play.textContent = 'Play / pause';
		play.style.left = '12px';
		play.addEventListener('click', this.togglePlayback);
		const back = pip.document.createElement('button');
		back.textContent = 'Back to tab';
		back.style.right = '12px';
		back.addEventListener('click', () => {
			window.focus();
			void this.exit();
		});
		pip.document.body.append(this.surface, play, back);
		this.changed(true);
	}
	private onNativeExit = () => {
		this.nativeVideo = undefined;
		this.changed(false);
	};
	async exit() {
		++this.revision;
		const pip = this.pipWindow;
		this.restore?.();
		pip?.close();
		if (this.nativeVideo && document.pictureInPictureElement === this.nativeVideo)
			await document.exitPictureInPicture();
	}
	destroy() {
		this.destroyed = true;
		void this.exit().catch(() => {});
		this.nativeVideo?.removeEventListener('leavepictureinpicture', this.onNativeExit);
	}
}
