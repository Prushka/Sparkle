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

export function getBrowserBackendBaseUrl(host?: string) {
	const publicBase = trimTrailingSlash(process.env.PUBLIC_BE ?? '');
	const serverBase = trimTrailingSlash(process.env.SERVER_BE ?? '');
	const isLocalHost =
		host?.startsWith('localhost') || host?.startsWith('127.0.0.1') || host?.startsWith('[::1]');
	if (isLocalHost && /^https?:\/\//.test(serverBase)) {
		return serverBase;
	}
	return publicBase;
}
