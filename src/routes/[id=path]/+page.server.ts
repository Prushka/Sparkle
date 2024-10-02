import { PUBLIC_STATIC } from '$env/static/public';
import { type Job } from '$lib/player/t';
import * as cheerio from 'cheerio';
import { redirect } from '@sveltejs/kit';
import { roomMapping, getJobs } from '../../cache';
import { env } from '$env/dynamic/private';

/** @type {import('../../.svelte-kit/types/src/routes').PageServerLoad} */
export async function load({ params, url, fetch }) {
	let { id } = params;
	let job: Job | undefined = undefined
	let codec = 'h264'
	let base = `${PUBLIC_STATIC}/${id}`
	let plot = ''
	let rating = -1
	let jobs : Job[] = []
	let titleStr: string
	const room = url.searchParams.get('room') || url.searchParams.get('channel_id')
	if (room) {
		roomMapping[room] = id
	}
	try {
		jobs = await getJobs(fetch, id)
		job = jobs.find(j => j.Id === id)
		if (!job && id.length >= 4) {
			const prefixJobs = jobs.filter(j => j.Id.startsWith(id))
			if (prefixJobs.length === 1) {
				job = prefixJobs[0]
			}
		}
		if (job) {
			id = job.Id
			base = `${PUBLIC_STATIC}/${id}`
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
		const infoResponse = await fetch(`${env.SERVER_BE}/static/${id}/info.nfo`);
		const info = await infoResponse.text();
		const $ = cheerio.load(info, {
			xml: true,
		});
		rating = parseFloat($('rating').text());
		plot = $('plot').text();
	} catch (e) {
		console.log(params, e);
		redirect(302, '/');
	}
	let displayTitle: string
	const title = job!.Title
	if (title.episode) {
		const se = title.episode
		titleStr = `${title.title} - ${se.se} - ${se.title}`
		displayTitle = `${se.se} - ${se.title}`
	}else{
		titleStr = title.title
		displayTitle = title.title
	}
	return {
		jobs: jobs,
		job: job,
		video: `${base}/${codec}.mp4`,
		preview: `${base}/poster.jpg`,
		icon: `${base}/poster.jpg`,
		rating,
		title: titleStr,
		displayTitle,
		plot,
		oembedJson: room ? `https://${url.host}/json/${job?.Id}?room=${room}` : `https://${url.host}/json/${job?.Id}`,
		dominantColor: job?.DominantColors?.[0] ? job?.DominantColors?.[0] : "#EC275F"
	};
}
