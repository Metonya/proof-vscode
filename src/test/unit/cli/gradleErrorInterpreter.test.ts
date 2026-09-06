import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { interpretGradleFailure } from '../../../cli/gradleErrorInterpreter';

/**
 * Literal captured output, not written from documentation: this is what
 * Gradle 9.7.1 printed for `./gradlew :junit-bom:test` on the real
 * junit-framework repo, where `junit-bom` is a `java-platform` module with
 * no `test` task at all - the exact failure module scoping introduces.
 */
const REAL_TASK_NOT_FOUND_OUTPUT = `
FAILURE: Build failed with an exception.

* What went wrong:
Selection failed
  Cannot locate tasks that match ':junit-bom:test' as task 'test' not found in project ':junit-bom'.

* Try:
> Run gradlew tasks to get a list of available tasks.
> Run with --stacktrace option to get the stack trace.

BUILD FAILED in 7s
`;

test('the real "task not found" output names the module and what to do about it', () => {
	const interpretation = interpretGradleFailure(REAL_TASK_NOT_FOUND_OUTPUT);

	assert.equal(interpretation?.kind, 'taskNotFoundInProject');
	assert.ok(interpretation.detail.includes('junit-bom'), interpretation.detail);
	assert.ok(interpretation.detail.includes('no `test` task'), interpretation.detail);
	assert.ok(interpretation.detail.includes('Uncheck it in the module picker'), interpretation.detail);
});

/**
 * A missing coverage task is a different cause from a missing `test` task,
 * and the advice that used to be given for it - "apply the jacoco plugin" -
 * was measurably wrong on Android: Now in Android already applies jacoco,
 * and AGP still names its coverage tasks per variant, so no
 * `jacocoTestReport` will ever exist there. The message must say that
 * rather than send the user after a plugin they already have.
 */
test('a missing coverage task names the real causes and the setting that fixes it', () => {
	const interpretation = interpretGradleFailure(
		"Cannot locate tasks that match ':core:common:jacocoTestReport' as task 'jacocoTestReport' not found in project ':core:common'.",
	);

	assert.equal(interpretation?.kind, 'taskNotFoundInProject');
	assert.ok(interpretation.detail.includes('core:common'), interpretation.detail);
	assert.ok(interpretation.detail.includes('Android'), interpretation.detail);
	assert.ok(interpretation.detail.includes('proof.gradleCoverageTask'), interpretation.detail);
	assert.ok(!interpretation.detail.includes('no tests to run'), interpretation.detail);
});

/** Older Gradle phrasing puts the same clause at the start of the sentence; the interpreter matches the clause, not the wrapper around it. */
test('the same clause is recognized when it starts the sentence', () => {
	const interpretation = interpretGradleFailure("Task 'test' not found in project ':core'.");

	assert.equal(interpretation?.kind, 'taskNotFoundInProject');
	assert.ok(interpretation.detail.includes('core'), interpretation.detail);
});

/** Hard rule 3a: an unrecognized failure gets no invented cause - the caller falls back to the raw terminal output. */
test('an unrelated Gradle failure returns undefined rather than a guessed cause', () => {
	assert.equal(interpretGradleFailure('> Task :core:test FAILED\n\n3 tests completed, 1 failed'), undefined);
	assert.equal(interpretGradleFailure(''), undefined);
});

/**
 * Literal captured output from `./gradlew :core:data:test
 * :core:data:createDemoDebugUnitTestCoverageReport` on Now in Android, on a
 * machine whose Android SDK had only `platform-tools` installed. The raw
 * output buries this under hundreds of AGP configuration warnings.
 */
const REAL_SDK_MISSING_OUTPUT = `
FAILURE: Build failed with an exception.

* What went wrong:
Could not determine the dependencies of task ':core:data:testDemoDebugUnitTest'.
> SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local properties file at '/repo/local.properties'.

BUILD FAILED in 2s
`;

test('a missing Android SDK is named as such, and as not being caused by Proof', () => {
	const interpretation = interpretGradleFailure(REAL_SDK_MISSING_OUTPUT);

	assert.equal(interpretation?.kind, 'androidSdkMissing');
	assert.ok(interpretation.detail.includes('ANDROID_HOME'), interpretation.detail);
	assert.ok(interpretation.detail.includes('local.properties'), interpretation.detail);
});

/** A task-selection failure and a missing SDK are different problems; the more specific one must win when both could match. */
test('a task-not-found failure is still reported as such, not as an SDK problem', () => {
	assert.equal(interpretGradleFailure(REAL_TASK_NOT_FOUND_OUTPUT)?.kind, 'taskNotFoundInProject');
});
