
<script lang="ts">
	import { afterNavigate } from '$app/navigation';

	afterNavigate(() => {
		console.log('navigated');

		localStorage.setItem('vds-player:background-opacity', '0%')
		localStorage.setItem('vds-player:text-shadow', 'outline')
		localStorage.setItem('vds-player:font-size', '115%')
		const theme = localStorage.getItem('theme');
		if (theme) {
			const html = document.querySelector('html');
			html?.setAttribute('data-theme', theme || "light");
		}
	});
</script>

<slot/>
