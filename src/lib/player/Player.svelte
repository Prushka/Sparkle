<script lang="ts">
	// Import styles.
	import 'vidstack/bundle';
	import type { MediaPlayerElement } from 'vidstack/elements';
	import { onMount } from 'svelte';
	import {
		type TextTrackInit
	} from 'vidstack';

	let player: MediaPlayerElement;

	const id = "PC1eyyTa7TVtHiZGKoSWbD2rkxmD7RcX"
	const host = "192.168.50.182:1323"
	let socket: WebSocket;

	function connect() {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.close()
		}
		socket = new WebSocket(`ws://${host}/sync/${id}`)
		socket.onopen = () => {
			console.log("Connected to sync server")
		}

		socket.onmessage = (event: MessageEvent) => {
			console.log("received: " + event.data)
			const state = JSON.parse(event.data)
			if(player){
				if (state["paused"] === true && player.paused === false) {
					player.pause()
				} else if (state["paused"] === false && player.paused === true) {
					player.play()
				}
				if (state["time"] !== undefined) {
					player.currentTime = state["time"]
				}
			}
		}

		socket.onerror = function () {
			console.error('Socket encountered error');
			socket.close();
		};

		socket.onclose = () => {
			console.log("Socket closed, reconnecting")
			setTimeout(function () {
				connect();
			}, 1000);
		}
	}

	function syncTime() {
		if (player !== null && socket.readyState === WebSocket.OPEN) {
			const curr = player.currentTime
			console.log(curr)
			socket.send(JSON.stringify({
				time: curr
			}))
		}
	}

	onMount(() => {
		connect()
		let textTracks: TextTrackInit[] = [
			// Subtitles
			{
				src: `http://${host}/static/${id}/2-subtitle_eng.vtt`,
				label: 'English',
				language: 'en-US',
				kind: 'subtitles',
				default: true,
			},
		];

		for (const track of textTracks) player.textTracks.add(track);

		syncTime()
		// tick every 2 seconds
		setInterval(() => {
			syncTime()
		}, 4000)
		// Subscribe to state updates.
		return player.subscribe(({paused}: {paused: boolean}
		) => {
			if (socket.readyState === WebSocket.OPEN) {
				console.log({
					paused: paused,
				})
				socket.send(JSON.stringify({
					paused: paused,
				}))
			}
		});
	});
</script>

<main id="main-page" class="flex flex-col items-center w-full h-full overflow-auto gap-3 py-4">
<label class="input input-bordered flex items-center gap-2">
	Name
	<input type="text" class="grow" placeholder="Daisy" />
</label>
	<media-player
		id="player"
		class="media-player w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-media-focus data-[focus]:ring-4"
		title="Sprite Fight"
		src={`http://${host}/static/${id}/out.mp4`}
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
	.media-player{
			border: none !important;
			border-radius: unset !important;
	}
</style>
