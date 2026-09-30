import assert from 'node:assert/strict';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from 'next/constants.js';
import configureNext from '../../next.config.mjs';

const original = process.env.MAX_PFP_BYTES;
try {
	delete process.env.MAX_PFP_BYTES;
	for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
		assert.equal(
			configureNext(phase).experimental.proxyClientMaxBodySize,
			12_000_000 + 1024 * 1024
		);
	}
	process.env.MAX_PFP_BYTES = '20000000';
	assert.equal(
		configureNext(PHASE_PRODUCTION_SERVER).experimental.proxyClientMaxBodySize,
		20_000_000 + 1024 * 1024
	);
	process.env.MAX_PFP_BYTES = '64';
	assert.equal(
		configureNext(PHASE_DEVELOPMENT_SERVER).experimental.proxyClientMaxBodySize,
		64 + 1024 * 1024
	);
	console.log('Profile upload proxy limits passed');
} finally {
	if (original === undefined) delete process.env.MAX_PFP_BYTES;
	else process.env.MAX_PFP_BYTES = original;
}
