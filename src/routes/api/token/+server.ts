import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { PUBLIC_DISCORD_CLIENT_ID } from '$env/static/public';

export async function POST({ request }: any) {
	const requestJson = await request.json();
	console.log(requestJson);
	const { code } = requestJson;
	// Exchange the code for an access_token
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
	console.log(responseJson);
	const { access_token } = responseJson;

	// Return the access_token to our client as { access_token: "..."}
	return json({ access_token });
}
