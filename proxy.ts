import { NextResponse, type NextRequest } from 'next/server';

function trimTrailingSlash(value: string) {
	return value.replace(/\/+$/, '');
}

function isHttpUrl(value: string) {
	return /^https?:\/\//i.test(value);
}

function getRuntimeEnv(key: string) {
	return process.env[key] ?? '';
}

function getPathnameBase(value: string) {
	if (!value) {
		return '';
	}
	if (isHttpUrl(value)) {
		return trimTrailingSlash(new URL(value).pathname || '/');
	}
	return trimTrailingSlash(value.startsWith('/') ? value : `/${value}`);
}

function matchesPathBase(pathname: string, base: string) {
	return pathname === base || pathname.startsWith(`${base}/`);
}

function joinUrl(base: string, path: string) {
	return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, '')}`;
}

function getProxyDestination(request: NextRequest, publicEnvKey: string, internalEnvKey: string) {
	const publicPath = getPathnameBase(getRuntimeEnv(publicEnvKey));
	const internalBase = trimTrailingSlash(getRuntimeEnv(internalEnvKey));

	if (!publicPath || !internalBase || !matchesPathBase(request.nextUrl.pathname, publicPath)) {
		return null;
	}

	const pathAfterBase = request.nextUrl.pathname.slice(publicPath.length) || '/';
	const destination = new URL(joinUrl(internalBase, pathAfterBase));
	destination.search = request.nextUrl.search;
	return destination;
}

export function proxy(request: NextRequest) {
	const destination =
		getProxyDestination(request, 'SERVER_BE', 'SERVER_INTERNAL_BE') ??
		getProxyDestination(request, 'SERVER_STATIC', 'SERVER_INTERNAL_STATIC');

	if (destination) {
		return NextResponse.rewrite(destination);
	}

	return NextResponse.next();
}

export const config = {
	matcher: '/:path*'
};
