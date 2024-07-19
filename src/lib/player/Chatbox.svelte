<script lang="ts">
	import { type Chat, getRealName, SyncTypes } from '$lib/player/t';
	import { chatFocusedStore, chatLayoutStore, playersStore } from '../../store';
	import { onDestroy, onMount, tick } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Shortcut } from '$lib/components/ui/command';
	import { IconUsers } from '@tabler/icons-svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Pfp from '$lib/player/Pfp.svelte';

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
	export let messages: Chat[];
	export let historicalPlayers: { [key: string]: any };
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
		if(!value) return;
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
		<Input
			maxlength={250}
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
			class="input focus-visible:ring-transparent {useButton ? 'rounded-r-none':''}"
			id={inputId}
		/>

		{#if useButton}
			<div class="flex">
				<Dialog.Root>
					<Dialog.Trigger disabled={!connected}
						class={`${buttonVariants({ variant: "outline" })} border-l-0 rounded-l-none rounded-r-none border-r-0`}
					>History
					</Dialog.Trigger>
					<Dialog.Content class="pr-1 max-sm:pl-2 gap-3">
							<div class="text-lg self-start font-bold">Chat History (Session)</div>
							<div
								class="flex flex-col gap-2.5 items-center overflow-y-auto overflow-x-hidden max-h-[85vh]">
								{#if messages.length === 0}
									<div class="self-start">There's nothing here yet ┬─┬ノ( º _ ºノ)</div>
									{/if}
							{#each messages.reverse() as message}
								<div
									class={`w-full flex flex-wrap gap-1.5 items-center
									text-center ${message.isStateUpdate ? 'font-semibold' : ''}`}>
									<Pfp id={message.uid} class="avatar shrink-0 !w-6 !h-6"
											 discordUser={historicalPlayers[message.uid]?.discordUser} />

									<span class="font-bold shrink-0">
										{new Date(message.timestamp).toLocaleTimeString('en-US', {
											hour: '2-digit',
											minute: '2-digit',
											hour12: false
										})}
									</span>
									<span class="shrink-0">{getRealName(historicalPlayers[message.uid])}:</span>

									<span class="block break-words overflow-x-hidden text-justify pr-3">{message.message}</span>
								</div>
							{/each}
						</div>
					</Dialog.Content>
				</Dialog.Root>
				<Button disabled={!connected} variant="outline" class="rounded-l-none" on:click={()=>{
				sendMessage();
			}}>Send
				</Button>
			</div>
		{/if}
	</div>
</form>
