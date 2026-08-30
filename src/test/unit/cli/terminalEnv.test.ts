import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveEnvOverrides } from '../../../cli/terminalEnv';

/** Real shape from this session's gson `.vscode/settings.json` - `terminal.integrated.env.windows`. */
test('resolveEnvOverrides: a plain value passes through unchanged', () => {
	const resolved = resolveEnvOverrides({ JAVA_HOME: 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.17.10-hotspot' }, {});
	assert.equal(resolved.JAVA_HOME, 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.17.10-hotspot');
});

test('resolveEnvOverrides: ${env:X} resolves against baseEnv - the real "prepend to existing PATH" shape', () => {
	const resolved = resolveEnvOverrides(
		{ Path: 'C:\\jdk17\\bin;${env:Path}' },
		{ Path: 'C:\\Windows\\System32' },
	);
	assert.equal(resolved.Path, 'C:\\jdk17\\bin;C:\\Windows\\System32');
});

test('resolveEnvOverrides: an unresolved variable (not in baseEnv) becomes empty, never the literal placeholder text', () => {
	const resolved = resolveEnvOverrides({ FOO: '${env:DOES_NOT_EXIST}' }, {});
	assert.equal(resolved.FOO, '');
});

test('resolveEnvOverrides: ${env:X} resolves against baseEnv, never against another override in the same batch', () => {
	// If JAVA_HOME's own placeholder referenced OTHER's *new* value here it would read "new", not "old" -
	// the real setting's intent is always "relative to what was already there", not a chained substitution.
	const resolved = resolveEnvOverrides(
		{ OTHER: 'new', JAVA_HOME: '${env:OTHER}' },
		{ OTHER: 'old' },
	);
	assert.equal(resolved.JAVA_HOME, 'old');
});

test('resolveEnvOverrides: multiple placeholders in one value all resolve', () => {
	const resolved = resolveEnvOverrides(
		{ COMBINED: '${env:A}-${env:B}' },
		{ A: '1', B: '2' },
	);
	assert.equal(resolved.COMBINED, '1-2');
});

test('resolveEnvOverrides: an empty overrides object returns an empty result', () => {
	assert.deepEqual(resolveEnvOverrides({}, { Path: 'C:\\Windows' }), {});
});
