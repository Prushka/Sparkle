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

function isDiscordProxyHost(host: string | undefined) {
	return Boolean(host && /^[0-9]+\.discordsays\.com(?::\d+)?$/.test(host));
}

function getPathnameBase(value: string) {
	try {
		return trimTrailingSlash(new URL(value).pathname || '/');
	} catch {
		return trimTrailingSlash(value.startsWith('/') ? value : `/${value}`);
	}
}

function getBrowserBaseUrl(value: string, host?: string) {
	if (!isDiscordProxyHost(host)) {
		return value;
	}
	return `https://${host}${getPathnameBase(value)}`;
}

export function getBackendBaseUrl() {
	return getRequiredEnv('SERVER_BE');
}

export function getStaticBaseUrl() {
	return getRequiredEnv('SERVER_STATIC');
}

export function getBrowserBackendBaseUrl(_host?: string) {
	return getBrowserBaseUrl(getBackendBaseUrl(), _host);
}

export function getBrowserStaticBaseUrl(_host?: string) {
	return getBrowserBaseUrl(getStaticBaseUrl(), _host);
}
