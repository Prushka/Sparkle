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

function isHttpUrl(value: string) {
	return /^https?:\/\//i.test(value);
}

function getPathnameBase(value: string) {
	if (isHttpUrl(value)) {
		return trimTrailingSlash(new URL(value).pathname || '/');
	}
	return trimTrailingSlash(value.startsWith('/') ? value : `/${value}`);
}

function getBrowserBaseUrl(value: string) {
	return isHttpUrl(value) ? value : getPathnameBase(value);
}

export function getBackendBaseUrl() {
	return getRequiredEnv('SERVER_INTERNAL_BE');
}

export function getStaticBaseUrl() {
	return getRequiredEnv('SERVER_INTERNAL_STATIC');
}

export function getBrowserBackendBaseUrl() {
	return getBrowserBaseUrl(getRequiredEnv('SERVER_BE'));
}

export function getBrowserStaticBaseUrl() {
	return getBrowserBaseUrl(getRequiredEnv('SERVER_STATIC'));
}
