<script lang="ts">
	import { type DiscordUser, getAvatarUrl, pfpLastFetched } from '../../store';
	import { onDestroy, onMount } from 'svelte';
	import { PUBLIC_STATIC } from '$env/static/public';

	let pfpLast: any = {};
	export let id: string;
	export let discordUser : DiscordUser | null | undefined = null;
	const unsubscribe = pfpLastFetched.subscribe((value) => pfpLast = value);
	onDestroy(unsubscribe);

	onMount(() => {
		if(!pfpLast[id] && !discordUser){
			pfpLastFetched.update((value) => {
				return {...value, [id]: Date.now()};
			});
		}
	});

</script>


<img
	src={discordUser ? getAvatarUrl(discordUser) : `${PUBLIC_STATIC}/pfp/${id}.png?${pfpLast[id]}`}
		 alt="pfp" class="rounded-full object-cover {$$restProps.class}" />
