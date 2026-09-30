'use client';

import { useEffect } from 'react';

const serviceWorkerUrl = '/sw.js';

export function ServiceWorkerRegistrar() {
	useEffect(() => {
		if (!('serviceWorker' in navigator)) {
			return;
		}

		let cancelled = false;

		const register = async () => {
			try {
				const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
					scope: '/',
					updateViaCache: 'none'
				});

				if (cancelled) {
					return;
				}

				void registration.update().catch(() => {});
			} catch (error) {
				console.error('Service worker registration failed:', error);
			}
		};

		const onLoad = () => {
			void register();
		};

		if (document.readyState === 'complete') {
			onLoad();
		} else {
			window.addEventListener('load', onLoad, { once: true });
		}

		return () => {
			cancelled = true;
			window.removeEventListener('load', onLoad);
		};
	}, []);

	return null;
}
