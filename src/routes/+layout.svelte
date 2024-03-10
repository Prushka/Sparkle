
<script lang="ts">
	import { afterNavigate } from '$app/navigation';

	afterNavigate(() => {
		console.log('navigated');
		const theme = localStorage.getItem('theme');
		if (theme) {
			const html = document.querySelector('html');
			html?.setAttribute('data-theme', theme || "light");
		}
	});
</script>

<slot/>
