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

export function getBackendBaseUrl() {
	return getRequiredEnv('SERVER_BE');
}

export function getStaticBaseUrl() {
	return getRequiredEnv('SERVER_STATIC');
}

export function getBrowserBackendBaseUrl(_host?: string) {
	return getBackendBaseUrl();
}
