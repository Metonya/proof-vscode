import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMavenTestArgs } from '../../../cli/mavenTestCommand';

test('buildMavenTestArgs: -B always present, phase always present', () => {
	const args = buildMavenTestArgs({ phase: 'test', injectJacocoGoals: false, jacocoPluginVersion: '0.8.13' });
	assert.deepEqual(args, ['-B', 'test']);
});

test('buildMavenTestArgs: verify phase is honored, never guessed at as test', () => {
	const args = buildMavenTestArgs({ phase: 'verify', injectJacocoGoals: false, jacocoPluginVersion: '0.8.13' });
	assert.deepEqual(args, ['-B', 'verify']);
});

/** Faz 30 (D-30's CLI-goal-binding approach): when no pom in the reactor configures jacoco itself, coverdict injects the exact CLI goals around the phase - never a permanent pom edit. */
test('buildMavenTestArgs: injectJacocoGoals wraps the phase with prepare-agent and report, full coordinates', () => {
	const args = buildMavenTestArgs({ phase: 'test', injectJacocoGoals: true, jacocoPluginVersion: '0.8.13' });
	assert.deepEqual(args, [
		'-B',
		'org.jacoco:jacoco-maven-plugin:0.8.13:prepare-agent',
		'test',
		'org.jacoco:jacoco-maven-plugin:0.8.13:report',
	]);
});

test('buildMavenTestArgs: the jacoco plugin version is exactly what was passed, not a hardcoded default', () => {
	const args = buildMavenTestArgs({ phase: 'test', injectJacocoGoals: true, jacocoPluginVersion: '0.8.99' });
	assert.ok(args.includes('org.jacoco:jacoco-maven-plugin:0.8.99:prepare-agent'));
	assert.ok(args.includes('org.jacoco:jacoco-maven-plugin:0.8.99:report'));
});

test('buildMavenTestArgs: no -pl/-am - the whole reactor builds, matching a user\'s own manual `mvn test`', () => {
	const args = buildMavenTestArgs({ phase: 'verify', injectJacocoGoals: true, jacocoPluginVersion: '0.8.13' });
	assert.ok(!args.includes('-pl'));
	assert.ok(!args.includes('-am'));
});
