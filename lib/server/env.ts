const DEFAULT_BACKEND_URL = 'http://sparkle:1329';

export function getBackendBaseUrl() {
	const raw = process.env.SPARKLE_BACKEND_URL || process.env.SERVER_BE || DEFAULT_BACKEND_URL;
	return raw.replace(/\/+$/, '');
}
