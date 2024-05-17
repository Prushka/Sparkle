import { PUBLIC_HOST } from '$env/static/public';
import type { Job } from '$lib/player/t';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params }) {
	const { id } = params;
	let job: Job | null = null
	let video = `${PUBLIC_HOST}/static/` + id + '/av1.mp4'
	try {
		const titleResponse = await fetch(`${PUBLIC_HOST}/static/` + id + '/job.json');
		job = await titleResponse.json();
		if (!job?.EncodedCodecs?.includes('av1')) {
			video = `${PUBLIC_HOST}/static/` + id + '/hevc.mp4'
		}
	} catch (e) {
		console.log(params, e);
	}
	return {
		job: job,
		video: video,
		preview: `${PUBLIC_HOST}/static/` + id + '/thumb.jpg',
	};
}
