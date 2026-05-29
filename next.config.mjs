function trimTrailingSlash(value) {
	return value.replace(/\/+$/, '');
}

function isHttpUrl(value) {
	return /^https?:\/\//i.test(value);
}

function getPathnameBase(value) {
	if (!value) {
		return '';
	}
	if (isHttpUrl(value)) {
		return trimTrailingSlash(new URL(value).pathname || '/');
	}
	return trimTrailingSlash(value.startsWith('/') ? value : `/${value}`);
}

function joinUrl(base, path) {
	return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, '')}`;
}

const backendPublicPath = getPathnameBase(process.env.SERVER_BE);
const staticPublicPath = getPathnameBase(process.env.SERVER_STATIC);
const internalBackendBase = trimTrailingSlash(process.env.SERVER_INTERNAL_BE ?? '');
const internalStaticBase = trimTrailingSlash(
	process.env.SERVER_INTERNAL_STATIC ?? (internalBackendBase ? `${internalBackendBase}/static` : '')
);

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	reactStrictMode: true,
	allowedDevOrigins: [
		'127.0.0.1',
		'192.168.1.156',
		'a.lyu.sh',
		'1251822920242823270.discordsays.com'
	],
	env: {
		PUBLIC_DISCORD_CLIENT_ID: process.env.PUBLIC_DISCORD_CLIENT_ID
	},
	async rewrites() {
		const rewrites = [];
		if (backendPublicPath && internalBackendBase) {
			rewrites.push({
				source: `${backendPublicPath}/:path*`,
				destination: joinUrl(internalBackendBase, ':path*')
			});
		}
		if (staticPublicPath && internalStaticBase) {
			rewrites.push({
				source: `${staticPublicPath}/:path*`,
				destination: joinUrl(internalStaticBase, ':path*')
			});
		}
		return rewrites;
	}
};

export default nextConfig;
