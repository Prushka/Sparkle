import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
	distDir: process.env.SPARKLE_BUILD_DIR || '.next',
	output: 'standalone',
	reactStrictMode: true,
	webpack(config, { dev }) {
		if (dev) {
			config.watchOptions = {
				...config.watchOptions,
				ignored: [
					'**/.playwright-mcp/**',
					'**/.agents/**',
					'**/.claude/**',
					'**/cache/**',
					'**/.next-raw-validation/**'
				]
			};
		}
		return config;
	},
	async headers() {
		return [
			{
				source: '/_sparkle/:path*',
				headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }]
			},
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

const configureNext = (phase) => {
	const configuredPfpBytes = Number(process.env.MAX_PFP_BYTES || 12_000_000);
	const maxPfpBytes =
		Number.isSafeInteger(configuredPfpBytes) && configuredPfpBytes > 0
			? configuredPfpBytes
			: 12_000_000;
	return {
		...nextConfig,
		// Proxy clones request bodies. Include the backend's multipart allowance so
		// its avatar limit, rather than Next's smaller default, controls uploads.
		experimental: { proxyClientMaxBodySize: maxPfpBytes + 1024 * 1024 },
		async rewrites() {
			return {
				beforeFiles:
					phase === PHASE_DEVELOPMENT_SERVER
						? []
						: [{ source: '/sw.js', destination: '/_sparkle/sw.js' }]
			};
		}
	};
};

export default configureNext;
