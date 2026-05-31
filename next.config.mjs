/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	reactStrictMode: true,
	allowedDevOrigins: [
		'127.0.0.1',
		'192.168.1.156',
		'a.lyu.sh',
		'1251822920242823270.discordsays.com'
	]
};

export default nextConfig;
