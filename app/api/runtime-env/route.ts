import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getRuntimeEnv(key: string) {
	return process.env[key] ?? '';
}

export async function GET() {
	return NextResponse.json(
		{
			PUBLIC_DISCORD_CLIENT_ID: getRuntimeEnv('PUBLIC_DISCORD_CLIENT_ID')
		},
		{
			headers: {
				'Cache-Control': 'no-store, max-age=0'
			}
		}
	);
}
