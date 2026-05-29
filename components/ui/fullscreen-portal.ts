'use client';

import { useEffect, useState } from 'react';

type FullscreenDocument = Document & {
	webkitFullscreenElement?: Element | null;
};

function getFullscreenElement() {
	if (typeof document === 'undefined') {
		return null;
	}

	const fullscreenDocument = document as FullscreenDocument;
	return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

export function useFullscreenPortalContainer() {
	const [container, setContainer] = useState<Element | null>(() => getFullscreenElement());

	useEffect(() => {
		const updateContainer = () => setContainer(getFullscreenElement());

		updateContainer();
		document.addEventListener('fullscreenchange', updateContainer);
		document.addEventListener('webkitfullscreenchange', updateContainer);
		return () => {
			document.removeEventListener('fullscreenchange', updateContainer);
			document.removeEventListener('webkitfullscreenchange', updateContainer);
		};
	}, []);

	return container;
}
