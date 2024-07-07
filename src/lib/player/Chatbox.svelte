<script lang="ts">
	import { SyncTypes } from '$lib/player/t';
	import { chatFocusedStore, chatLayoutStore, playersStore } from '../../store';
	import { onDestroy, onMount, tick } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Shortcut } from '$lib/components/ui/command';
	import { IconUsers } from '@tabler/icons-svelte';
	import { Button } from '$lib/components/ui/button';

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
	export let useButton: boolean = false;
	let players: number;
	let chatHidden: boolean;
	const unsubscribeChatLayout = chatLayoutStore.subscribe((value) =>
		chatHidden = value === 'hide'
	);
	const unsubscribeChatFocused = chatFocusedStore.subscribe((value) => chatFocused = value);
	const unsubscribePlayersStore = playersStore.subscribe((value) => players = value);
	let showShortcut = true;
	onDestroy(() => {
		unsubscribeChatLayout();
		unsubscribeChatFocused();
		unsubscribePlayersStore();
	});
	$: chatTxt = chatHidden ? 'Chat (hidden)' : `Chat ${controlsShowing === null && showShortcut ? '[Alt S]' : ''}`;
	$: placeholder = chatTxt;
	$: connected = players > 0;
	onMount(
		() => {
			const f = (e: any) => {
				if (e.altKey && e.keyCode == 83) {
					e.preventDefault();
					if (controlsShowing === false || controlsShowing === null) {
						document.getElementById(inputId)?.focus();
					}
				}
			};
			document.addEventListener('keydown', f);
			const shortcut = setTimeout(() => {
				showShortcut = false;
			}, 10000);
			return () => {
				document.removeEventListener('keydown', f);
				clearTimeout(shortcut);
			};
		}
	);

	function sendMessage() {
		send({ chat: value, type: SyncTypes.ChatSync });
		value = '';
		placeholder = 'Sent!';
		setTimeout(() => {
			placeholder = chatTxt;
		}, 2000);
	}
</script>

<form
	id={formId}
	on:submit={e => {
		e.preventDefault();
		sendMessage();
	}}
	class="{$$restProps.class}"
	style={chatFocused ? 'visibility: visible;' : 'visibility: unset;'}
	autocomplete="off">
	<div class="relative flex items-center justify-end">
		{#if focusByShortcut}
			<Shortcut class="absolute pointer-events-none mr-12 flex gap-0.5 justify-center items-center text-xs font-bold">
				{#if players > 0}
					<IconUsers stroke={3} size={14} /> {players}
				{/if}
			</Shortcut>

<!--			<Popover.Root>-->
<!--				<Popover.Trigger asChild let:builder>-->
<!--					<Button disabled builders={[builder]} variant="ghost" class="absolute left-8 p-1 w-8 h-8 confetti-button"><IconConfetti stroke={3} size={14} /></Button>-->
<!--				</Popover.Trigger>-->
<!--				<Popover.Content class="w-80">-->
<!--					<div class="grid gap-4">-->
<!--						<div class="space-y-2">-->
<!--							<h4 class="font-medium leading-none">Reactions</h4>-->
<!--						</div>-->
<!--						<EmojiPicker/>-->
<!--					</div>-->
<!--				</Popover.Content>-->
<!--			</Popover.Root>-->
		{/if}

		{#if useButton}
			<Button variant="outline" class="absolute" on:click={()=>{
				sendMessage();
			}}>Send
			</Button>
		{/if}
		<Input
			on:focus={()=>{
				onFocus();
				if(useButton) {
					tick().then(() => {
					setTimeout(()=>{
						window.scroll(0, 0)
				}, 100)
				});
				}
			}}
			disabled={!connected}
			on:blur={onBlur}
			on:keydown={e => {
				e.stopPropagation();
				if (e.key === 'Escape') {
					e.preventDefault();
					document.getElementById(inputId)?.blur();
				}
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
