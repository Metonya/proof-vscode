import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindModules, describeModuleForReport, describeSiblingProjects, isProjectRoot, moduleForPath, toRepoRelativePosix } from '../../../cli/reportDiscovery';

test('a report at the workspace root needs no module binding', () => {
	const module = describeModuleForReport('target/site/jacoco/jacoco.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'target/site/jacoco/jacoco.xml');
});

test('a report under a Maven module subdirectory is bound to that module root', () => {
	const module = describeModuleForReport('gson/target/site/jacoco/jacoco.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, 'gson');
	assert.equal(module.reportPath, 'gson/target/site/jacoco/jacoco.xml');
});

test('nested module paths keep every segment in the root', () => {
	const module = describeModuleForReport('modules/service-a/target/site/jacoco/jacoco.xml');
	assert.equal(module.root, 'modules/service-a');
});

test('a report at an unfamiliar layout falls back to the repo root rather than guessing', () => {
	const module = describeModuleForReport('some/other/coverage/jacoco.xml');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'some/other/coverage/jacoco.xml');
});

test('toRepoRelativePosix strips the repo root and normalizes backslashes', () => {
	const rel = toRepoRelativePosix('C:\\repo\\gson\\target\\site\\jacoco\\jacoco.xml', 'C:\\repo');
	assert.equal(rel, 'gson/target/site/jacoco/jacoco.xml');
});

test('toRepoRelativePosix on an already-relative-looking mismatch returns the normalized input unchanged', () => {
	const rel = toRepoRelativePosix('/elsewhere/jacoco.xml', 'C:\\repo');
	assert.equal(rel, '/elsewhere/jacoco.xml');
});

test('isProjectRoot is true when a pom.xml marker is present (gson-shaped: one real multi-module project)', () => {
	assert.equal(isProjectRoot(['pom.xml']), true);
});

test('isProjectRoot is true for any recognized Gradle marker too', () => {
	assert.equal(isProjectRoot(['settings.gradle.kts']), true);
});

test('isProjectRoot is false with no markers at all (coverdict-corpus-shaped: a folder of unrelated repos)', () => {
	assert.equal(isProjectRoot([]), false);
});

test('describeSiblingProjects names every candidate and tells the user to open one directly, never picks for them', () => {
	const message = describeSiblingProjects(['assertj', 'dropwizard', 'gson', 'junit-framework']);
	assert.ok(message.includes('assertj, dropwizard, gson, junit-framework'));
	assert.ok(message.includes('4'));
	assert.ok(!message.toLowerCase().includes('otomatik')); // never phrased as if one was auto-chosen
});

/** Faz 30: bindModules is the multi-module counterpart of describeModuleForReport - real, distinct ids instead of a fixed 'root'. */
test('bindModules: gives each discovered report a real id derived from its module root', () => {
	const bound = bindModules([
		'gson/target/site/jacoco/jacoco.xml',
		'extras/target/site/jacoco/jacoco.xml',
		'test-jpms/target/site/jacoco/jacoco.xml',
	]);
	assert.deepEqual(bound.map((m) => m.id), ['gson', 'extras', 'test-jpms']);
	assert.deepEqual(bound.map((m) => m.root), ['gson', 'extras', 'test-jpms']);
});

test('bindModules: a report at the workspace root gets id "root"', () => {
	const bound = bindModules(['target/site/jacoco/jacoco.xml']);
	assert.deepEqual(bound, [{ id: 'root', root: '.', reportPath: 'target/site/jacoco/jacoco.xml' }]);
});

test('bindModules: a real id collision (two module roots ending in the same segment) gets a numeric suffix, never silently merges', () => {
	const bound = bindModules([
		'backend/util/target/site/jacoco/jacoco.xml',
		'frontend/util/target/site/jacoco/jacoco.xml',
	]);
	assert.deepEqual(bound.map((m) => m.id), ['util', 'util-2']);
	assert.equal(new Set(bound.map((m) => m.id)).size, 2);
});

test('bindModules: unsafe characters in a module root are sanitized to a valid CLI token', () => {
	const bound = bindModules(['my module!/target/site/jacoco/jacoco.xml']);
	assert.equal(bound[0].id, 'my-module-');
});

/** Faz 30: which bound module a target file belongs to - longest-root-prefix wins, '.' is the lowest-priority fallback. */
test('moduleForPath: a file under a module root resolves to that module', () => {
	const modules = [{ id: 'gson', root: 'gson' }, { id: 'extras', root: 'extras' }];
	assert.equal(moduleForPath('gson/src/test/java/com/google/gson/GsonTest.java', modules), 'gson');
	assert.equal(moduleForPath('extras/src/test/java/com/google/gson/extras/ExtraTest.java', modules), 'extras');
});

test('moduleForPath: a nested module\'s own root outranks its parent\'s (longest prefix wins)', () => {
	const modules = [{ id: 'root', root: '.' }, { id: 'nested', root: 'gson/nested' }];
	assert.equal(moduleForPath('gson/nested/src/main/java/Foo.java', modules), 'nested');
	assert.equal(moduleForPath('gson/src/main/java/Bar.java', modules), 'root');
});

test('moduleForPath: a path under no bound module\'s root is undefined, not a guess', () => {
	const modules = [{ id: 'gson', root: 'gson' }];
	assert.equal(moduleForPath('extras/src/main/java/Foo.java', modules), undefined);
});
