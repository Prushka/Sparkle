import { get, writable } from 'svelte/store';
import { browser } from '$app/environment';
import { PUBLIC_STATIC } from '$env/static/public';


export const pfpLastFetched = writable({});
export const chatLayoutStore = writable(browser && localStorage.getItem('chatLayout') || 'simple');
export const chatFocusedStore = writable(false);
export const pageReloadCounterStore = writable(0);
export const interactedStore = writable(false);

export function testPfp(id : string) {
	const now = Date.now();
	const prev: any = get(pfpLastFetched);
	if (prev?.[id]?.trying) return;
	console.log('Retrying pfp fetch, '+id)
	pfpLastFetched.update((prev) => {
		return {
			...prev,
			[id]: {
				success: false,
				lastSuccess: null,
				trying: true,
			}
		}
	})
	const img = new Image();
	img.onload = () => {
		pfpLastFetched.update((prev) => {
			return {
				...prev,
				[id]: {
					success: true,
					lastSuccess: now,
					trying: false,
				}
			}
		})
	};
	img.onerror = () => {
		pfpLastFetched.update((prev) => {
			return {
				...prev,
				[id]: {
					success: false,
					lastSuccess: null,
					trying: false,
				}
			}
		})
	};
	img.src = `${PUBLIC_STATIC}/pfp/${id}.png?${now}`
}
