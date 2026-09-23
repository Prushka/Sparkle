import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: './tests/e2e',
	timeout: 90_000,
	workers: 1,
	outputDir: './cache/playwright-results',
	reporter: 'list',
	use: {
		baseURL: process.env.SPARKLE_TEST_URL || 'http://127.0.0.1:3002',
		browserName: process.env.SPARKLE_TEST_CHANNEL === 'firefox' ? 'firefox' : 'chromium',
		channel:
			process.env.SPARKLE_TEST_CHANNEL === 'firefox'
				? undefined
				: process.env.SPARKLE_TEST_CHANNEL || 'chrome',
		headless: true,
		launchOptions: {
			args:
				process.env.SPARKLE_TEST_CHANNEL === 'firefox'
					? []
					: ['--autoplay-policy=no-user-gesture-required']
		},
		screenshot: 'only-on-failure'
	}
});
