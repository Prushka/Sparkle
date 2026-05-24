/** @type { import("eslint").Linter.Config } */
module.exports = {
	root: true,
	extends: [
		'next/core-web-vitals',
		'next/typescript',
		'prettier'
	],
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	parserOptions: {
		sourceType: 'module',
		ecmaVersion: 2020,
		ecmaFeatures: {
			jsx: true
		}
	},
	env: {
		browser: true,
		es2017: true,
		node: true
	},
	ignorePatterns: ['.next/', 'build/', 'src/'],
	rules: {
		"@typescript-eslint/no-explicit-any": "off",
		"no-unused-vars": "off",
		"@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
	},
};
