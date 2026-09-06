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

/** A missing `jacocoTestReport` is a different cause (a plugin that was never applied) and must not be described as "no tests to run". */
test('a missing jacoco task is explained as a missing plugin, not as a module without tests', () => {
	const interpretation = interpretGradleFailure(
		"Cannot locate tasks that match ':docs:jacocoTestReport' as task 'jacocoTestReport' not found in project ':docs'.",
	);

	assert.equal(interpretation?.kind, 'taskNotFoundInProject');
	assert.ok(interpretation.detail.includes('docs'), interpretation.detail);
	assert.ok(interpretation.detail.includes('jacoco'), interpretation.detail);
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
