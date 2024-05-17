import { PUBLIC_HOST } from '$env/static/public';
import type { Job } from '$lib/player/t';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params }) {
	const { id } = params;
	const titleResponse = await fetch(`${PUBLIC_HOST}/static/` + id + '/job.json');
	const job: Job = await titleResponse.json();
	return {
		title: job.FileRawName || "UwU",
		preview: `${PUBLIC_HOST}/static/` + id + '/thumb.jpg',
	};
}
