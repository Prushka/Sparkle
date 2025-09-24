<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import { Reload, Rocket } from 'svelte-radix';
import { IconPlugConnected } from '@tabler/icons-svelte';
import * as Tooltip from '$lib/components/ui/tooltip/index.js';

export let socketCommunicating : boolean;
export let interacted:boolean;
export let exited:boolean;
export let tickedSecsAgoStr:string;
export let onClick:()=>void;
</script>

<Tooltip.Root openDelay={0}>
	<Tooltip.Trigger asChild let:builder>
		<Button builders={[builder]} variant="outline"
						on:click={onClick}
						class="font-bold {socketCommunicating ? 'text-green-600 hover:text-green-600' : interacted ? 'text-red-600 hover:text-red-600' : 'text-pink-600 hover:text-pink-600'} {$$restProps.class}">
			{#if socketCommunicating}
				<IconPlugConnected size={20} stroke={2} />
			{:else}
				{#if !interacted}
					<Rocket class="mr-2 h-4 w-4 animate-bounce" />
					Join Watch Room
				{:else if !exited}
					<Reload class="mr-2 h-4 w-4 animate-spin" />
					Connecting...
				{:else}
					Disconnected
				{/if}
			{/if}
		</Button>
	</Tooltip.Trigger>
	<Tooltip.Content>
		<p>Ticked: {tickedSecsAgoStr}s ago</p>
	</Tooltip.Content>
</Tooltip.Root>
