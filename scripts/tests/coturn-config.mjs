import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercises configuration generation without opening ports or using real credentials.
// On Windows, pass the path to Git Bash as the first argument.
const shell = process.argv[2] || 'sh';
const cache = path.resolve('cache');
mkdirSync(cache, { recursive: true });
const fixture = mkdtempSync(path.join(cache, 'coturn-config-'));
const posix = (value) =>
	process.platform === 'win32'
		? value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
		: value;
const secret = '0123456789abcdef'.repeat(4);
const stub = `#!/bin/sh
set -eu
[ "$#" = 2 ] && [ "$1" = '-c' ]
[ -z "\${VOICE_TURN_SECRET+x}" ]
cp "$2" "$TEST_CONFIG_OUTPUT"
rm -f "$2"
`;
writeFileSync(path.join(fixture, 'turnserver'), stub, { mode: 0o700 });
const base = {
	...process.env,
	TURN_REALM: 'turn.example.test',
	TURN_EXTERNAL_IP: '203.0.113.10',
	TURN_RELAY_IP: '192.168.1.50',
	VOICE_TURN_SECRET: secret,
	TURN_TLS_ENABLED: 'false',
	TEST_CONFIG_OUTPUT: posix(path.join(fixture, 'rendered.conf'))
};
const run = (overrides = {}) =>
	spawnSync(
		shell,
		[
			'-c',
			'PATH="$1:$PATH"; export PATH; exec sh scripts/coturn-entrypoint.sh "$2"',
			'coturn-test',
			posix(fixture),
			posix(path.join(fixture, 'certs'))
		],
		{ encoding: 'utf8', env: { ...base, ...overrides } }
	);

try {
	let result = run();
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	const config = readFileSync(path.join(fixture, 'rendered.conf'), 'utf8');
	for (const line of [
		'external-ip=203.0.113.10/192.168.1.50',
		'relay-ip=192.168.1.50',
		`static-auth-secret=${secret}`,
		'use-auth-secret',
		'no-tls',
		'min-port=49160',
		'max-port=49259'
	])
		assert.ok(config.split('\n').includes(line), `Missing configuration: ${line.split('=')[0]}`);
	assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
	for (const invalid of [
		{ VOICE_TURN_SECRET: '' },
		{ VOICE_TURN_SECRET: 'short' },
		{ VOICE_TURN_SECRET: `${secret}\nno-auth` },
		{ TURN_REALM: 'turn.example.test\nno-auth' },
		{ TURN_EXTERNAL_IP: '' },
		{ TURN_RELAY_IP: '$(echo invalid)' },
		{ TURN_TLS_ENABLED: 'maybe' }
	]) {
		result = run(invalid);
		assert.notEqual(result.status, 0, `Accepted invalid ${Object.keys(invalid)[0]}`);
		assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
	}
	// Missing certificates reject startup. Only paths/readability are tested here;
	// actual certificate parsing and TURN/TLS require a live coturn deployment.
	result = run({ TURN_TLS_ENABLED: 'true' });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /TLS requires readable/);
	mkdirSync(path.join(fixture, 'certs'));
	writeFileSync(path.join(fixture, 'certs', 'fullchain.pem'), 'disposable test certificate');
	result = run({ TURN_TLS_ENABLED: 'true' });
	assert.notEqual(result.status, 0);
	writeFileSync(path.join(fixture, 'certs', 'privkey.pem'), 'disposable test key');
	result = run({ TURN_TLS_ENABLED: 'true' });
	assert.equal(result.status, 0, result.stderr);
	const tlsConfig = readFileSync(path.join(fixture, 'rendered.conf'), 'utf8');
	assert.ok(!tlsConfig.split('\n').includes('no-tls'));
	assert.ok(tlsConfig.includes(`cert=${posix(fixture)}/certs/fullchain.pem`));
	assert.ok(tlsConfig.includes(`pkey=${posix(fixture)}/certs/privkey.pem`));
	console.log(
		'Coturn config generation, required settings, secret handling, and TLS checks passed.'
	);
} finally {
	// Only remove this test's own verified cache fixture.
	assert.equal(path.dirname(fixture), cache);
	rmSync(fixture, { recursive: true, force: true });
}
