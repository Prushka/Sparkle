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
					scope: '/'
				});

				if (cancelled) {
					return;
				}

				void registration.update();

				if (registration.waiting) {
					registration.waiting.postMessage({ type: 'SKIP_WAITING' });
				}

				registration.addEventListener('updatefound', () => {
					const worker = registration.installing;

					if (!worker) {
						return;
					}

					worker.addEventListener('statechange', () => {
						if (worker.state === 'installed' && navigator.serviceWorker.controller) {
							worker.postMessage({ type: 'SKIP_WAITING' });
						}
					});
				});
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
