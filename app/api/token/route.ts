import { NextResponse } from 'next/server';
import { PUBLIC_DISCORD_CLIENT_ID } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
	try {
		const requestJson = await request.json();
		const { code } = requestJson;
		const response = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				client_id: PUBLIC_DISCORD_CLIENT_ID,
				client_secret: process.env.SERVER_DISCORD_CLIENT_SECRET ?? '',
				grant_type: 'authorization_code',
				code
			})
		});
		const responseJson = await response.json();
		const { access_token } = responseJson;
		return NextResponse.json({ access_token });
	} catch (error) {
		console.error(error);
		return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
	}
}
