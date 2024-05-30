import { PUBLIC_STATIC } from '$env/static/public';
import { getTitleComponents, type Job, preprocessJob, preprocessJobs, type TitleComponents } from '$lib/player/t';
import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';

/** @type {import('../../.svelte-kit/types/src/routes').PageServerLoad} */
export async function load({ params }) {
	const { id } = params;
	let job: Job | null = null
	let codec = 'h264'
	const base = `${PUBLIC_STATIC}/${id}`
	let plot = ''
	let title: TitleComponents
	let rating = -1
	let jobs : Job[] = []
	let titleStr = 'UwU'
	try {
		const jobsResponse = await fetch(`${env.SERVER_BE}/all`);
		jobs = await jobsResponse.json();
		jobs = preprocessJobs(jobs)
		const jobResponse = await fetch(`${env.SERVER_BE}/job/${id}`);
		job = await jobResponse.json();
		if (job) {
			job = preprocessJob(job)
		}else{
			redirect(302, '/');
		}
		if (!job?.EncodedCodecs?.includes('h264')) {
			if (job?.EncodedCodecs?.includes('av1')) {
				codec = 'av1'
			}else{
				codec = 'hevc'
			}
		}
		title = getTitleComponents(job)
		const infoResponse = await fetch(`${base}/info.nfo`);
		const info = await infoResponse.text();
		const $ = cheerio.load(info);
		rating = parseFloat($('rating').text());
		plot = $('plot').text();
	} catch (e) {
		console.log(params, e);
		redirect(302, '/');
	}
	if (title.episodes) {
		const se = Object.values(title.episodes)[0]
		titleStr = `${title.title} - ${se.se} - ${se.seTitle}`
	}else{
		titleStr = title.title
	}
	return {
		jobs: jobs,
		job: job,
		video: `${base}/${codec}.mp4`,
		preview: `${base}/poster.jpg`,
		icon: `${base}/poster.jpg`,
		rating,
		title: titleStr,
		plot,
	};
}
