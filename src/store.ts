import { writable } from 'svelte/store';
import { browser } from '$app/environment';


export const pfpLastFetched = writable({});
export const chatLayoutStore = writable(browser && localStorage.getItem('chatLayout') || 'simple');
export const chatFocusedStore = writable(false);
export const pageReloadCounterStore = writable(0);
