import { writable } from 'svelte/store';


export const pfpLastFetched = writable({});
export const chatLayoutStore = writable(localStorage.getItem('chatLayout') || 'simple');
export const chatFocusedStore = writable(false);
