<script lang="ts">
	import { SyncTypes } from '$lib/player/t';

	let i: any;
	export let send: any;
	export let classes = '';
	export let onFocus: any = () => {};
	export let onBlur: any = () => {};
</script>

<form
	on:submit={e => {
		e.preventDefault();
						const message = i.value;
						i.value = '';
						send({ chat: message, type: SyncTypes.ChatSync });
						i.placeholder = 'Sent!';
						setTimeout(() => {
							i.placeholder = 'Chat';
						}, 2000);
	}}
	autocomplete="off">
	<input
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
		bind:this={i} autocomplete="off" type="text" placeholder="Chat"
		class="c-box input {$$restProps.class} {classes}"
		id={$$restProps.id}
	>
</form>

<style>
    .c-box {
        font-size: 1rem !important;
    }
</style>
