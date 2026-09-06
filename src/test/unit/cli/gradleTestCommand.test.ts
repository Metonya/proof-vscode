import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGradleTestArgs, DEFAULT_COVERAGE_TASK, isShellSafeModuleRoot, unsafeModuleRoots } from '../../../cli/gradleTestCommand';

test('no scope at all keeps the historical whole-build argv', () => {
	assert.deepEqual(buildGradleTestArgs({}), ['test', 'jacocoTestReport']);
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: undefined }), ['test', 'jacocoTestReport']);
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: [] }), ['test', 'jacocoTestReport']);
});

/**
 * The distinction the CLI's own GradleClasspathFixer got wrong once: a bare
 * `test` matches that task in the root project AND every subproject, so the
 * root-scoped run must be `:test`, not `test`.
 */
test('the root project is scoped with a leading colon, never the bare task name', () => {
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['.'] }), [':test', ':jacocoTestReport']);
});

test('a subproject root becomes a qualified Gradle task path', () => {
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['core'] }), [':core:test', ':core:jacocoTestReport']);
});

test('a nested subproject keeps every segment as a Gradle path separator', () => {
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['modules/service-a'] }), [
		':modules:service-a:test',
		':modules:service-a:jacocoTestReport',
	]);
});

test('several modules are requested in the order they were picked, tests before reports per module', () => {
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['core', 'extras'] }), [
		':core:test',
		':core:jacocoTestReport',
		':extras:test',
		':extras:jacocoTestReport',
	]);
});

/**
 * `cli/runner.ts` spawns the wrapper with `shell: true`, and Gradle takes one
 * task path per argument - a root with a space would be split, one with `&`
 * would be a second command. `include("my module")` is legal Gradle, so this
 * is a real input. Dropping scoping (a slower, correct run) beats mangling.
 */
test('a shell-unsafe module root drops scoping entirely rather than being quoted or split', () => {
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['my module'] }), ['test', 'jacocoTestReport']);
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['core', 'evil & rm'] }), ['test', 'jacocoTestReport']);
});

test('isShellSafeModuleRoot accepts ordinary module paths and rejects shell metacharacters', () => {
	assert.equal(isShellSafeModuleRoot('core'), true);
	assert.equal(isShellSafeModuleRoot('modules/service-a'), true);
	assert.equal(isShellSafeModuleRoot('.'), true);
	assert.equal(isShellSafeModuleRoot('my module'), false);
	assert.equal(isShellSafeModuleRoot('a&b'), false);
	assert.equal(isShellSafeModuleRoot('a"b'), false);
});

test('unsafeModuleRoots names exactly the roots that caused scoping to be dropped', () => {
	assert.deepEqual(unsafeModuleRoots(['core', 'my module', 'a&b']), ['my module', 'a&b']);
	assert.deepEqual(unsafeModuleRoots(['core']), []);
	assert.deepEqual(unsafeModuleRoots(undefined), []);
});

/**
 * `jacocoTestReport` is the default task name of Gradle's `jacoco` plugin,
 * not a universal one - measured on Google's Now in Android, neither its
 * plain JVM modules nor its Android ones have a task by that name, and
 * asking for one fails the whole build at selection time. Hence the
 * `proof.gradleCoverageTask` setting.
 */
test('the coverage task defaults to jacocoTestReport when unset, blank, or whitespace', () => {
	assert.equal(DEFAULT_COVERAGE_TASK, 'jacocoTestReport');
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['core'] }), [':core:test', ':core:jacocoTestReport']);
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['core'], coverageTask: '' }), [':core:test', ':core:jacocoTestReport']);
	assert.deepEqual(buildGradleTestArgs({ moduleRoots: ['core'], coverageTask: '   ' }), [':core:test', ':core:jacocoTestReport']);
});

test('a configured coverage task replaces jacocoTestReport in a scoped run', () => {
	assert.deepEqual(
		buildGradleTestArgs({ moduleRoots: ['core/data'], coverageTask: 'createDemoDebugUnitTestCoverageReport' }),
		[':core:data:test', ':core:data:createDemoDebugUnitTestCoverageReport'],
	);
});

test('a configured coverage task is used by an unscoped run too', () => {
	assert.deepEqual(
		buildGradleTestArgs({ coverageTask: 'createDemoDebugUnitTestCoverageReport' }),
		['test', 'createDemoDebugUnitTestCoverageReport'],
	);
});
