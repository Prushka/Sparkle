import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getRuntimeEnv(key: string) {
	return process.env[key] ?? '';
}

function getRequestUrl() {
	try {
		const url = new URL(getRuntimeEnv('PUBLIC_REQUEST_URL').trim());
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
		return url.href;
	} catch {
		return '';
	}
}

export async function GET() {
	return NextResponse.json(
		{
			PUBLIC_DISCORD_CLIENT_ID: getRuntimeEnv('PUBLIC_DISCORD_CLIENT_ID'),
			backendBaseUrl: getRuntimeEnv('SERVER_BE'),
			staticBaseUrl: getRuntimeEnv('SERVER_STATIC'),
			requestUrl: getRequestUrl()
		},
		{
			headers: {
				'Cache-Control': 'no-store, max-age=0'
			}
		}
	);
}
