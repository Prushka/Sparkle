<script lang="ts">
	import { SyncTypes } from '$lib/player/t';
	import { chatFocusedStore, chatLayoutStore } from '../../store';
	import { onDestroy, onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Shortcut } from '$lib/components/ui/command';

	let value: string;
	export let send: any;
	export let onFocus: any = () => {};
	export let onBlur: any = () => {};
	export let chatFocused = false;
	export let focusByShortcut = false;
	let chatHidden : boolean;
	const unsubscribeChatLayout = chatLayoutStore.subscribe((value) =>
		chatHidden = value === "hidden"
	);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	onDestroy(() => {
		unsubscribeChatLayout();
		unsubscribeChatFocused();
	});
	$: placeholder = chatHidden ? 'Chat (hidden)' : 'Chat';
	onMount(
		() => {
			const f = (e : any) => {
				if (e.altKey && e.keyCode == 65) {
					console.log("triggered!")
					e.preventDefault();
					document.getElementById($$restProps.id)?.focus();
				}
			}
			if (focusByShortcut) {
				document.addEventListener('keydown', f);
			}
			return () => {
				if (focusByShortcut) {
					document.removeEventListener('keydown', f);
				}
			}
		}
	);
</script>

<svelte:options accessors/>
<form
	on:submit={e => {
		e.preventDefault();
		console.log(value)
						send({ chat: value, type: SyncTypes.ChatSync });
						value = ""
						const oldPlaceholder = placeholder;
						placeholder = 'Sent!';
						setTimeout(() => {
							placeholder = oldPlaceholder;
						}, 2000);
	}}
	class="{$$restProps.class}"
	style={chatFocused ? 'visibility: visible;' : 'visibility: unset;'}
	autocomplete="off">
	<div class="relative flex items-center justify-end">
		{#if focusByShortcut}
		<Shortcut class="absolute pointer-events-none m-12">Alt A</Shortcut>
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
		id={$$restProps.id}
	/>
	</div>
</form>
