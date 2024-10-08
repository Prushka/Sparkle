import { json } from '@sveltejs/kit';
import { roomMapping } from '../../../cache';

export async function GET({ url }: any) {
	try {
		const room = url.searchParams.get('room') || url.searchParams.get('channel_id');
		if (room) {
			return json({ jobId: roomMapping[room] });
		}
	} catch (e) {
		console.error(e);
		return json({ error: 'An error occurred' });
	}
}
