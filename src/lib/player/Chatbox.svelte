<script lang="ts">
	let i : any;
	export let send : any;
</script>

<form
	on:submit={e => {
		e.preventDefault();
						const message = i.value;
						i.value = '';
						send({ chat: message });
						i.placeholder = 'Sent!';
						setTimeout(() => {
							i.placeholder = 'Chat';
						}, 2000);
	}}
	autocomplete="off">
	<input bind:this={i} autocomplete="off" type="text" placeholder="Chat"
				 class="input input-sm mx-8 text-black" id="chat-input"
	>
</form>
