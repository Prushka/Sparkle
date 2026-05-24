const DEFAULT_BACKEND_URL = 'http://sparkle:1329';

function trimTrailingSlash(value: string) {
	return value.replace(/\/+$/, '');
}

export function getBackendBaseUrl() {
	const raw = process.env.SPARKLE_BACKEND_URL || process.env.SERVER_BE || DEFAULT_BACKEND_URL;
	return raw.replace(/\/+$/, '');
}

export function getStaticBaseUrl() {
	const staticBase = trimTrailingSlash(process.env.SERVER_STATIC ?? '');
	if (!staticBase) {
		throw new Error('Missing SERVER_STATIC environment variable');
	}
	return staticBase;
}
