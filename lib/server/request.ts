type HeaderReader = Pick<Headers, 'get'>;

function firstHeaderValue(value: string | null) {
	return value?.split(',')[0]?.trim() || '';
}

function forwardedHost(value: string | null) {
	if (!value) {
		return '';
	}
	const first = value.split(',')[0] || '';
	const hostPair = first
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith('host='));
	return hostPair?.slice('host='.length).replace(/^"|"$/g, '') || '';
}

function isDiscordProxyHost(host: string | undefined) {
	return Boolean(host && /^[0-9]+\.discordsays\.com(?::\d+)?$/.test(host));
}

export function getRequestHost(headers: HeaderReader) {
	const candidates = [
		firstHeaderValue(headers.get('x-forwarded-host')),
		firstHeaderValue(headers.get('x-original-host')),
		forwardedHost(headers.get('forwarded')),
		firstHeaderValue(headers.get('host'))
	];
	return candidates.find(isDiscordProxyHost) || candidates.find(Boolean) || 'localhost:3001';
}

export function getRequestOrigin(headers: HeaderReader) {
	const host = getRequestHost(headers);
	const protocol =
		firstHeaderValue(headers.get('x-forwarded-proto')) ||
		firstHeaderValue(headers.get('x-forwarded-protocol')) ||
		(host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
	return `${protocol}://${host}`;
}

export function toAbsoluteUrl(value: string, origin: string) {
	return new URL(value, origin).toString();
}
