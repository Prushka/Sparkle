<script lang="ts">
	let i : any;
	export let send : any;
	export let classes = "";
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
				 class="c-box input text-black {$$restProps.class} {classes}"
				 id={$$restProps.id}
	>
</form>

<style>
	.c-box{
      width: 32rem;
      font-size: 1rem !important;
      background-color: rgba(255, 255, 255, 0.9) !important;
	}
	@media (max-width: 1000px) {
		.c-box{
			width: 100%;
		}
	}
</style>
