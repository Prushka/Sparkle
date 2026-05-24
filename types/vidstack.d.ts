import type React from 'react';

type VidstackElementProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;

interface VidstackIntrinsicElements {
	'media-player': VidstackElementProps;
	'media-provider': VidstackElementProps;
	'media-poster': VidstackElementProps;
	'media-video-layout': VidstackElementProps;
}

declare global {
	namespace JSX {
		interface IntrinsicElements extends VidstackIntrinsicElements {}
	}
}

declare module 'react' {
	namespace JSX {
		interface IntrinsicElements extends VidstackIntrinsicElements {}
	}
}

export {};
