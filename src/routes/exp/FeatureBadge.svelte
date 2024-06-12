<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { IconCheck, IconX } from '@tabler/icons-svelte';

	export let check: boolean = false;
</script>

<Button variant="outline" class="bg-gray-200 px-3 flex
 flex-wrap gap-2 rounded-full items-center justify-center font-semibold">
	<slot/>
	{#if check}
		<IconCheck class="w-5 h-5 p-1 rounded-full bg-green-500 inline"
							 size={18} stroke={3} color="white" />
		{:else}
		<IconX class="w-5 h-5 p-1 rounded-full bg-red-500 inline"
							 size={18} stroke={3} color="white" />
	{/if}
</Button>
