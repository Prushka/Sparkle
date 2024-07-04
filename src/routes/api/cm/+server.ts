import { json } from '@sveltejs/kit';
import { channelMapping } from '../../../cache';

export async function GET({ url }: any) {
	try {
		const channelId = url.searchParams.get('channel_id')
		if (channelId) {
			return json({ jobId: channelMapping[channelId] });
		}
	} catch (e) {
		console.error(e);
		return json({ error: 'An error occurred' });
	}
}
