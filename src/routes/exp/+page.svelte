<script lang="ts">
	import Column from './Column.svelte';
	import FeatureBadge from './FeatureBadge.svelte';

	let competitors = 5;
	let information = [
		['Screenshots'],
		['Website'],
		['Product and Platforms', 'Business Focus'],
		['Business Model'],
		['Active Since'],
		['Target Audience', 'Customers']
	];

	let offerings = [["Competitive Advantage", "Strengths"],
		["Weaknesses"]]

	let userProblem = [['Budget Management'],
		['Investment Tracking'],
		['Financial Education'],
		['User Reviews', 'Feedback']];

	let ux = [["Setup Process"],
		["Engagement", "Mechanisms"],
		["Personalization"],
		["Transaction Efficiency", "Ease of Use"],
		["Security Measures"]]

	let ui = [["Visual Design Elements"],
		["Navigation Ease"],
		["Interactive Elements"],
		["UI Consistency"],
		["Information Structure", "Presentation"]]

	let persona = [["Persona 1"],
		["Persona 2"],
		["Persona 3"]]

	let summary = [["Summary"],
		["Notes"]]
</script>

<main class="p-12 flex flex-col gap-8">
	<div class="font-black text-[2em]">Competitive Analysis</div>
	<div class="flex flex-col gap-12">
		<div class="flex gap-4">
			<Column isMain header="Information" titles={information} />
			{#each Array(competitors) as _, i}
				<Column header="Competitor {i+1}" rows={information.length} />
			{/each}
		</div>

		<div class="flex gap-4">
			<Column isMain header="Solution Offerings"
							titles={offerings} />
			{#each Array(competitors) as _, i}
				<Column header="Competitor {i+1}" rows={offerings.length} />
			{/each}
		</div>
		<div class="flex gap-4">
			<Column isMain header="User Problem Addressing"
							titles={userProblem} />
			<Column header="Competitor 1" rows={userProblem.length}>
				<div slot="0" class="w-full flex flex-wrap gap-1.5">
					<FeatureBadge check>Built-in Tips</FeatureBadge>
					<FeatureBadge>Algo-Driven</FeatureBadge>
				</div>
			</Column>
			{#each Array(competitors-1) as _, i}
				<Column header="Competitor {i+2}" rows={userProblem.length} />
			{/each}
		</div>
		<div class="flex gap-4">
			<Column isMain header="Persona"
							titles={persona} />
			{#each Array(competitors) as _, i}
				<Column header="Competitor {i+1}" rows={persona.length} />
			{/each}
		</div>
		<div class="flex gap-4">
			<Column isMain header="User Experience"
							titles={ux} />
			{#each Array(competitors) as _, i}
				<Column header="Competitor {i+1}" rows={ux.length} />
			{/each}
		</div>
		<div class="flex gap-4">
			<Column isMain header="User Interface"
							titles={ui} />
			{#each Array(competitors) as _, i}
				<Column header="Competitor {i+1}" rows={ui.length} />
			{/each}
		</div>
		<div class="flex gap-4">
			<Column isMain header="Summary"
							titles={summary} />
			{#each Array(competitors) as _, i}
				<Column header="Competitor {i+1}" rows={summary.length} />
			{/each}
	</div>
</main>

<style>
	main {
      /*--destructive: 0 85.4% 92%;*/
      /*--destructive-foreground: 0 100% 5.9%;*/
      --background: 0 0% 100%;
	}
</style>
