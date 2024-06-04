<script lang="ts">
	import { SyncTypes } from '$lib/player/t';
	import { chatFocusedStore, chatLayoutStore, playersStore } from '../../store';
	import { onDestroy, onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Shortcut } from '$lib/components/ui/command';
	import { IconUsers } from '@tabler/icons-svelte';

	let value: string;
	export let send: any;
	export let onFocus: any = () => {
	};
	export let onBlur: any = () => {
	};
	export let chatFocused = false;
	export let focusByShortcut = false;
	export let controlsShowing: boolean | null = null;
	export let formId: string;
	export let inputId: string;
	let players : number;
	let chatHidden: boolean;
	const unsubscribeChatLayout = chatLayoutStore.subscribe((value) =>
		chatHidden = value === 'hidden'
	);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	const unsubscribePlayersStore = playersStore.subscribe((value) => players = value);
	onDestroy(() => {
		unsubscribeChatLayout();
		unsubscribeChatFocused();
		unsubscribePlayersStore();
	});
	$: placeholder = chatHidden ? 'Chat (hidden)' : 'Chat';
	onMount(
		() => {
			const f = (e: any) => {
				if (e.altKey && e.keyCode == 83) {
					e.preventDefault();
					if (controlsShowing === false || controlsShowing === null) {
						document.getElementById($$restProps.id)?.focus();
					}
				}
			};
			document.addEventListener('keydown', f);
			return () => {
				document.removeEventListener('keydown', f);
			};
		}
	);
</script>

<form
	id={formId}
	on:submit={e => {
		e.preventDefault();
						send({ chat: value, type: SyncTypes.ChatSync });
						value = ""
						placeholder = 'Sent!';
						setTimeout(() => {
							placeholder = chatHidden ? 'Chat (hidden)' : 'Chat';
						}, 2000);
	}}
	class="{$$restProps.class}"
	style={chatFocused ? 'visibility: visible;' : 'visibility: unset;'}
	autocomplete="off">
	<div class="relative flex items-center justify-end">
		{#if focusByShortcut}
			<Shortcut class="absolute pointer-events-none m-12 flex gap-0.5 justify-center items-center text-xs">
				{#if players > 0}
					<IconUsers stroke={2} size={14}/> {players}
				{/if}
				</Shortcut>
		{/if}
		<Input
			on:focus={onFocus}
			on:blur={onBlur}
			on:keydown={e => {
				e.stopPropagation()
		}}
			on:keyup={e => {
				e.stopPropagation()
		}}
			on:keypress={e => {
				e.stopPropagation()
		}}
			bind:value={value} autocomplete="off" type="text" placeholder={placeholder}
			class="input focus-visible:ring-transparent"
			id={inputId}
		/>
	</div>
</form>
