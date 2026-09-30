export const plexAccessRequiredEvent = 'sparkle:plex-access-required';
export class PlexAccessError extends Error {
	constructor(message = 'Sign in with Plex to access this room or Raw media.') {
		super(message);
		this.name = 'PlexAccessError';
	}
}
export async function checkPlexAccess(response: Response) {
	if (response.status !== 401 && response.status !== 403) return;
	const error = await response
		.clone()
		.json()
		.catch(() => null);
	if (error?.code === 'plex_sign_in_required') throw new PlexAccessError();
	if (error?.code === 'plex_library_access_denied')
		throw new PlexAccessError('Your Plex account needs access to this media’s library.');
}

// Only backend requests use this helper: never attach credentials to external
// metadata providers or decoder CDN URLs.
export async function backendFetch(input: RequestInfo | URL, init?: RequestInit) {
	const response = await fetch(input, { ...init, credentials: 'include' });
	await checkPlexAccess(response);
	return response;
}
