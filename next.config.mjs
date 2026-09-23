/** @type {import('next').NextConfig} */
const nextConfig = {
	distDir: process.env.SPARKLE_BUILD_DIR || '.next',
	output: 'standalone',
	reactStrictMode: true,
	webpack(config, { dev }) {
		if (dev) {
			config.watchOptions = {
				...config.watchOptions,
				ignored: ['**/.playwright-mcp/**', '**/.agents/**', '**/.claude/**', '**/cache/**', '**/.next-raw-validation/**']
			};
		}
		return config;
	},
	async headers() {
		return [
			{
				source: '/sw.js',
				headers: [
					{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
					{ key: 'Service-Worker-Allowed', value: '/' }
				]
			},
			{
				source: '/manifest.json',
				headers: [
					{ key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' },
					{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }
				]
			}
		];
	},
	allowedDevOrigins: ['127.0.0.1', '192.168.1.*', 'a.lyu.sh', '1251822920242823270.discordsays.com']
};

export default nextConfig;
