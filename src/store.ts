import { writable } from 'svelte/store';


export const pfpLastFetched = writable({});
export const chatHiddenStore = writable(false);
export const chatFocusedStore = writable(false);
