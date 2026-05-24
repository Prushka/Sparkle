/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	reactStrictMode: true,
	env: {
		PUBLIC_STATIC: process.env.PUBLIC_STATIC,
		PUBLIC_BE: process.env.PUBLIC_BE,
		PUBLIC_DISCORD_CLIENT_ID: process.env.PUBLIC_DISCORD_CLIENT_ID
	}
};

export default nextConfig;
