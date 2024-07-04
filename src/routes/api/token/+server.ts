import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { PUBLIC_DISCORD_CLIENT_ID } from '$env/static/public';

export async function POST({ request }: any) {
	try {
		const requestJson = await request.json();
		const { code } = requestJson;
		const response = await fetch(`https://discord.com/api/oauth2/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: PUBLIC_DISCORD_CLIENT_ID,
				client_secret: env.SERVER_DISCORD_CLIENT_SECRET,
				grant_type: 'authorization_code',
				code,
			}),
		});
		const responseJson = await response.json()
		const { access_token } = responseJson;
		return json({ access_token });
	} catch (e) {
		console.error(e);
		return json({ error: 'An error occurred' });
	}
}
