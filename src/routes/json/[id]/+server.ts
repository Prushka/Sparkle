import { json } from '@sveltejs/kit';

export function GET({url,params}) {
	const { id } = params;
	const to = `${url.origin}/${id}`
	return json({
		"provider_name": "Let's watch anime!",
		"provider_url": to,
		"author_name": "It's time to watch anime with Hmph!",
		"author_url": to,
	});
}
