function trimTrailingSlash(value: string) {
	return value.replace(/\/+$/, '');
}

function getRequiredEnv(key: string) {
	const value = trimTrailingSlash(process.env[key] ?? '');
	if (!value) {
		throw new Error(`Missing ${key} environment variable`);
	}
	return value;
}

function getOptionalEnv(key: string) {
	return trimTrailingSlash(process.env[key] ?? '');
}

function isHttpUrl(value: string) {
	return /^https?:\/\//i.test(value);
}

function getPathnameBase(value: string) {
	if (isHttpUrl(value)) {
		return trimTrailingSlash(new URL(value).pathname || '/');
	}
	return trimTrailingSlash(value.startsWith('/') ? value : `/${value}`);
}

function getRequestOrigin(host?: string) {
	const requestHost = host || 'localhost:3001';
	const protocol = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(requestHost)
		? 'http'
		: 'https';
	return `${protocol}://${requestHost}`;
}

function getServerBaseUrl(value: string, overrideKey: string, host?: string) {
	const override = getOptionalEnv(overrideKey);
	if (override) {
		return override;
	}
	if (isHttpUrl(value)) {
		return value;
	}
	return trimTrailingSlash(new URL(getPathnameBase(value), getRequestOrigin(host)).toString());
}

function getBrowserBaseUrl(value: string) {
	return isHttpUrl(value) ? value : getPathnameBase(value);
}

export function getBackendBaseUrl(host?: string) {
	return getServerBaseUrl(getRequiredEnv('SERVER_BE'), 'SERVER_INTERNAL_BE', host);
}

export function getStaticBaseUrl() {
	return getRequiredEnv('SERVER_STATIC');
}

export function getBrowserBackendBaseUrl() {
	return getBrowserBaseUrl(getRequiredEnv('SERVER_BE'));
}

export function getBrowserStaticBaseUrl() {
	return getBrowserBaseUrl(getStaticBaseUrl());
}
