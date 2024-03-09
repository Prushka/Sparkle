<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		type TextTrackInit
	} from 'vidstack';
	import { formatSeconds, type Job, type PlayerState } from './t';
	import { PUBLIC_HOST, PUBLIC_WS } from '$env/static/public';
	import { page } from '$app/stores';
	let player: MediaPlayerElement;

	let socket: WebSocket;
	let name = '';
	let roomStates: PlayerState[] = [];
	let jobs: Job[] = [];
	// load id from query param
	let id: string = '';
	let textTracks: TextTrackInit[] = [];
	let lastTicked = 0;
	let videoSrc = '';

	function idChanges() {
		console.log('called');
		connect();

		for (const job of jobs) {
			if (job.Id === id) {
				for (const sub of job.Subtitles) {
					textTracks.push({
						src: `${PUBLIC_HOST}/static/${id}/${sub}`,
						label: sub,
						kind: 'subtitles'
					});
				}
				break;
			}
		}
		for (const track of textTracks) player.textTracks.add(track);
		console.log('textTracks', textTracks);
		videoSrc = `${PUBLIC_HOST}/static/${id}/out.mp4`;
	}

	$ : if (id !== '') {
		idChanges();
	}

	function connect() {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.close();
		}
		socket = new WebSocket(`${PUBLIC_WS}/sync/${id}`);
		socket.onopen = () => {
			console.log('Connected to sync server');
			if (name !== '') {
				send({ name: name });
			}
			send({ reason: 'new player'})
		};

		socket.onmessage = (event: MessageEvent) => {
			console.log('received: ' + event.data);
			const state = JSON.parse(event.data);
			if (player) {
				if (Array.isArray(state)) {
					roomStates = state;
					lastTicked = Date.now();
				} else {
					if (state['paused'] === true && player.paused === false) {
						player.pause();
					} else if (state['paused'] === false && player.paused === true) {
						player.play();
					}
					if (state['time'] !== undefined) {
						player.currentTime = state['time'];
					}
				}
			}
		};

		socket.onerror = function() {
			console.error('Socket encountered error');
			socket.close();
		};

		socket.onclose = () => {
			console.log('Socket closed, reconnecting');
			setTimeout(function() {
				connect();
			}, 1000);
		};
	}

	function send(data: any) {
		if (player && socket && socket.readyState === WebSocket.OPEN) {
			console.log('sending: ' + JSON.stringify(data));
			socket.send(JSON.stringify(data));
		}
	}

	onMount(() => {
		fetch(`${PUBLIC_HOST}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = data;
				console.log(jobs);
				id = $page.url.searchParams.get('id') || '';
			});
		name = localStorage.getItem('name') || '';
		setInterval(() => {
			send({
				time: player?.currentTime
			});
		}, 4000);


	});
</script>

<main id="main-page" class="flex flex-col items-center w-full h-full overflow-auto gap-3 py-4">
	<div class="w-full flex gap-2 items-center px-8">
		<label class="input input-bordered flex items-center gap-2">
			Name
			<input
				on:focusout={() => {
					send({
						name: name
					})
				localStorage.setItem("name", name)
		}}
				bind:value={name} type="text" class="grow" placeholder="Who?" />
		</label>
		<select bind:value={id}
						class="select select-bordered w-full max-w-xs">
			<option disabled selected>Which media?</option>
			{#each jobs as job}
				<option value={job.Id}>{job.FileRawName}</option>
			{/each}
		</select>
		<div class="flex gap-1">
			{#each roomStates as state}
				<div class="btn btn-neutral">
					{state.name}: {formatSeconds(state.time)}, {state.paused ? 'paused' : 'playing'}
				</div>
			{/each}
			<div class="btn">
				Last tick: {Math.ceil((Date.now() - lastTicked) / 1000)}
			</div>
		</div>
	</div>
	<media-player
		class="media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4"
		title="Sprite Fight"
		src={videoSrc}
		crossorigin
		bind:this={player}
		on:pause={
			() => {
				send({ paused: true });
			}}
		on:play={
			() => {
				send({ paused: false });
			}}
	>
		<media-provider>
			<media-poster
				class="absolute inset-0 block h-full w-full rounded-md opacity-0 transition-opacity data-[visible]:opacity-100 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
			/>
		</media-provider>

		<media-video-layout
		/>
	</media-player>


</main>

<style>
    .media-player {
        border: none !important;
        border-radius: unset !important;
    }
</style>
