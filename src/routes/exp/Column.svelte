<script lang="ts">

	export let titles = [
		['Title1', 'Subtitle1'],
		['Title2', 'Subtitle2']
	];
	export let rows: number | null = null;
	export let header = "header";
	export let isMain = false;

	$: {
		let t = []
		if (rows !== null) {
			for (let i = 0; i < rows; i++) {
				t.push(["",""])
			}
			titles = t
		}
	}
</script>

<div class="flex flex-col text-slate-800 w-[20rem] border-2 rounded shadow-sm">
	<div class="h-14 flex justify-center items-center
	{isMain ? 'bg-[#EC275F] text-white':'bg-[#FECAD5] text-slate-800'}  text-lg font-black
rounded-t">
		{header}
	</div>
	{#each titles as [title, subtitle], index}
		<div class={`h-24 gap-0.5 flex justify-center items-center flex-col p-4
		 ${index % 2 === 0 ? 'bg-gray-100' : 'bg-white'}
		 ${index === titles.length-1 ? 'rounded-b' : ''}`}>
			{#if index === 0}
				<slot name="0"/>
			{/if}
			{#if index === 1}
				<slot name="1"/>
			{/if}
			{#if index === 2}
				<slot name="2"/>
			{/if}
			{#if index === 3}
				<slot name="3"/>
			{/if}
			{#if index === 4}
				<slot name="4"/>
			{/if}{#if index === 5}
			<slot name="5"/>
		{/if}{#if index === 6}
			<slot name="6"/>
		{/if}

			<div class="text-lg font-bold">
				{title}
			</div>
			{#if subtitle}
			<div class="text-sm font-semibold text-slate-600">
				{subtitle}
			</div>
				{/if}
		</div>
	{/each}
</div>
