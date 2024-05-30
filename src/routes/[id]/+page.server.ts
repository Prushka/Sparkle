import { PUBLIC_STATIC } from '$env/static/public';
import { type Job, preprocessJob, preprocessJobs } from '$lib/player/t';
import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

/** @type {import('../../.svelte-kit/types/src/routes').PageServerLoad} */
export async function load({ params }) {
	const { id } = params;
	let job: Job | null = null
	let codec = 'h264'
	const base = `${PUBLIC_STATIC}/${id}`
	let episode = -1
	let season = -1
	let plot = ''
	let title = 'UwU'
	let rating = -1
	let nfoTitle = ''
	let jobs : Job[] = []
	try {
		const jobsResponse = await fetch(`${env.SERVER_BE}/all`);
		jobs = await jobsResponse.json();
		jobs = preprocessJobs(jobs)
		const jobResponse = await fetch(`${env.SERVER_BE}/job/${id}`);
		job = await jobResponse.json();
		if (job) {
			job = preprocessJob(job)
		}else{
			error(404, {
				message: 'Media not found'
			});
		}
		if (!job?.EncodedCodecs?.includes('h264')) {
			if (job?.EncodedCodecs?.includes('av1')) {
				codec = 'av1'
			}else{
				codec = 'hevc'
			}
		}
		title = job?.Input || "UwU"
		const infoResponse = await fetch(`${base}/info.nfo`);
		const info = await infoResponse.text();
		const $ = cheerio.load(info);
		episode = parseInt($('episode').text());
		season = parseInt($('season').text());
		rating = parseFloat($('rating').text());
		plot = $('plot').text();
		const movieTagExists = $('movie').length > 0;
		nfoTitle = $('title').text()
		if (movieTagExists && nfoTitle.length > 0) {
			title = nfoTitle;
		}
	} catch (e) {
		console.log(params, e);
		error(404, {
			message: 'Media not found'
		});
	}
	if (episode >=0 && season >=0) {
		const seasonEpisode = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`
		if (title.includes(seasonEpisode)) {
			title = title.substring(0, title.indexOf(seasonEpisode))
			title = title.substring(0, title.length - 3)
			title = `${title}${nfoTitle ? ` - ${nfoTitle}` : ''} - Season ${season} - Episode ${episode}`
		}
	}
	return {
		jobs: jobs,
		job: job,
		video: `${base}/${codec}.mp4`,
		preview: `${base}/poster.jpg`,
		icon: `${base}/poster.jpg`,
		rating,
		title,
		plot,
		episode,
		season,
	};
}
