/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	reactStrictMode: true,
	allowedDevOrigins: ['127.0.0.1'],
	env: {
		PUBLIC_BE: process.env.PUBLIC_BE,
		PUBLIC_DISCORD_CLIENT_ID: process.env.PUBLIC_DISCORD_CLIENT_ID
	}
};

export default nextConfig;
