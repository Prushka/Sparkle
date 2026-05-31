import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getRuntimeEnv(key: string) {
	return process.env[key] ?? '';
}

export async function POST(request: Request) {
	try {
		const requestJson = await request.json();
		const { code } = requestJson;
		if (typeof code !== 'string' || !code.trim()) {
			return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
		}
		const clientId = getRuntimeEnv('PUBLIC_DISCORD_CLIENT_ID');
		const clientSecret = getRuntimeEnv('SERVER_DISCORD_CLIENT_SECRET');
		if (!clientId || !clientSecret) {
			return NextResponse.json({ error: 'Discord OAuth is not configured' }, { status: 500 });
		}
		const response = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: 'authorization_code',
				code: code.trim()
			})
		});
		const responseJson = await response.json().catch(() => null);
		if (!response.ok || !responseJson?.access_token) {
			console.error('Discord token exchange failed', {
				status: response.status,
				error: responseJson?.error,
				error_description: responseJson?.error_description
			});
			return NextResponse.json({ error: 'Discord token exchange failed' }, { status: 502 });
		}
		const { access_token } = responseJson;
		return NextResponse.json({ access_token });
	} catch (error) {
		console.error(error);
		return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
	}
}
