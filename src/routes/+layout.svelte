
<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { defaultTheme } from '$lib/player/t';
	import './styles.css';

	afterNavigate(() => {
		console.log('navigated');
		const theme = localStorage.getItem('theme');
		if (theme) {
			const html = document.querySelector('html');
			html?.setAttribute('data-theme', theme || defaultTheme);
		}
	});
</script>

<slot/>
