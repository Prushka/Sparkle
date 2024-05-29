import { type Writable, writable } from 'svelte/store';
import { browser } from '$app/environment';


export const pfpLastFetched : Writable<{[key:string]:number}> = writable({});
export const chatLayoutStore = writable(browser && localStorage.getItem('chatLayout') || 'simple');
export const chatFocusedStore = writable(false);
export const pageReloadCounterStore = writable(0);
export const interactedStore = writable(false);

export function updatePfp(id: string) {
			pfpLastFetched.update((store) => {
				return { ...store, [id]: Date.now() };
		});
}
