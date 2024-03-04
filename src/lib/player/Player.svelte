<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		type TextTrackInit
	} from 'vidstack';
	import type { Job, PlayerState } from '../../t';

	let player: MediaPlayerElement;

	const ip = '192.168.50.182:1323';
	const host = `http://${ip}`;
	let socket: WebSocket;
	let name = '';
	let roomStates: PlayerState[] = [];
	let jobs: Job[] = [];
	let id: string = '';
	let textTracks: TextTrackInit[] = [];
	function idChanges() {
		console.log("called")
		connect();

		for (const job of jobs) {
			if (job.Id === id) {
				for (const sub of job.Subtitles) {
					textTracks.push({
						src: `${host}/static/${id}/${sub}.vtt`,
						label: sub,
						kind: 'subtitles'
					});
				}
				break;
			}
		}
		for (const track of textTracks) player.textTracks.add(track);
	}
	$ : if (id !== '') {
		idChanges()
	}

	function connect() {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.close();
		}
		socket = new WebSocket(`ws://${ip}/sync/${id}`);
		socket.onopen = () => {
			console.log('Connected to sync server');
			if (name !== '') {
				socket.send(JSON.stringify({
					name: name
				}));
			}
		};

		socket.onmessage = (event: MessageEvent) => {
			console.log('received: ' + event.data);
			const state = JSON.parse(event.data);
			if (player) {
				if (Array.isArray(state)) {
					roomStates = state;
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

	function syncTime() {
		if (player !== null && socket.readyState === WebSocket.OPEN) {
			const curr = player.currentTime;
			console.log(curr);
			socket.send(JSON.stringify({
				time: curr
			}));
		}
	}

	onMount(() => {
		fetch(`${host}/all`)
			.then(response => response.json())
			.then(data => {
				jobs = data;
				console.log(jobs);
			}).catch(error => {
			console.log(error);
			return [];
		});
		name = localStorage.getItem('name') || '';

		syncTime();
		// tick every 2 seconds
		setInterval(() => {
			syncTime();
		}, 4000);
		// Subscribe to state updates.
		return player.subscribe(({ paused }: { paused: boolean }
		) => {
			if (socket.readyState === WebSocket.OPEN) {
				console.log({
					paused: paused
				});
				socket.send(JSON.stringify({
					paused: paused
				}));
			}
		});
	});
</script>

<main id="main-page" class="flex flex-col items-center w-full h-full overflow-auto gap-3 py-4">
	<div class="w-full flex gap-2 justify-center items-center px-8">
		<label class="input input-bordered flex items-center gap-2">
			Name
			<input
				on:focusout={() => {
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({
					name: name,
				}))
				localStorage.setItem("name", name)
			}
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
				<div class="badge badge-neutral">
					{state.name}: {state.time}
				</div>
			{/each}
		</div>
	</div>
	<media-player
		id="player"
		class="media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4"
		title="Sprite Fight"
		src={`${host}/static/${id}/out.mp4`}
		crossorigin
		bind:this={player}
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
