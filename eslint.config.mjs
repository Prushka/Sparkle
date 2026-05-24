import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
	...nextVitals,
	{
		ignores: ['public/scripts/**']
	}
];

export default config;
