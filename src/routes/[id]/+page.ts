import { PUBLIC_HOST } from '$env/static/public';
import type { Job } from '$lib/player/t';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params }) {
	const { id } = params;
	let job: Job | null = null
	let codec = 'h264'
	try {
		const titleResponse = await fetch(`${PUBLIC_HOST}/static/` + id + '/job.json');
		job = await titleResponse.json();
		if (!job?.EncodedCodecs?.includes('h264')) {
			if (job?.EncodedCodecs?.includes('av1')) {
				codec = 'av1'
			}else{
				codec = 'hevc'
			}
		}
	} catch (e) {
		console.log(params, e);
	}
	return {
		job: job,
		video: `${PUBLIC_HOST}/static/${id}/${codec}.mp4`,
		preview: `${PUBLIC_HOST}/static/` + id + '/poster.jpg',
	};
}
