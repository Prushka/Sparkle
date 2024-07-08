<script lang="ts">
	import { type Chat, findName, type Player } from '$lib/player/t.js';
import Pfp from '$lib/player/Pfp.svelte';

export let messagesToDisplay: Chat[];
export let historicalPlayers: { [key: string]: Player };
export let controlsShowing: boolean | null;
</script>


<div
	class="{controlsShowing ? 'max-md:!mt-10':''} flex flex-col gap-0.5 ml-auto chat-history items-end">
	{#each messagesToDisplay as message}
		<div
			class={`flex gap-1 justify-center items-center chat-line
				py-1 pl-2.5 pr-2 text-center text-white ${message.isStateUpdate ? 'font-semibold' : ''}`}>
			<span>{message.message}</span>
			<span>
					{message.timeStr ? `[${message.timeStr}]` : ''}
				</span>

			<span>{findName(Object.values(historicalPlayers), message.uid)}</span>
			<Pfp id={message.uid} class="avatar"
					 discordUser={Object.values(historicalPlayers).find((p) => p.id === message.uid)?.discordUser} />
		</div>
	{/each}
</div>

<style>


    .chat-history {
        margin-top: 2rem;
        margin-right: 2rem;
        font-size: 0.94rem;
    }

    @media (max-width: 1050px) {
        .chat-history {
            margin-top: 0.5rem;
            margin-right: 0.5rem;
            font-size: 0.825rem;
        }

        .chat-history .text-sm {
            line-height: unset;
            font-size: 0.825rem;
        }
    }

    @media (max-width: 700px) {

        .chat-history {
            margin-top: 0.5rem;
            margin-right: 0.5rem;
            font-size: 0.66rem;
        }

        .chat-history .text-sm {
            line-height: unset;
            font-size: 0.66rem;
        }
    }
</style>
