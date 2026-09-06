/**
 * Pure: recognizes a small, closed set of Gradle failure shapes from raw
 * subprocess output and turns them into an honest, actionable sentence -
 * never a guess. The Gradle sibling of `mavenErrorInterpreter.ts`, and it
 * keeps that file's rule: an unrecognized failure returns `undefined` and
 * the caller falls back to "see the terminal output" with the raw text
 * already visible - hard rule 3a, an unrecognized cause is never invented.
 *
 * Every shape here was captured from a real failing run, not written from
 * documentation (`gradleErrorInterpreter.test.ts`'s fixtures are the
 * literal captured text).
 */

export type GradleFailureKind = 'taskNotFoundInProject' | 'androidSdkMissing';

export interface GradleFailureInterpretation {
	kind: GradleFailureKind;
	/** Ready-to-show sentence explaining the cause. */
	detail: string;
}

/**
 * Captured verbatim from Gradle 9.7.1 on the real junit-framework repo
 * (`./gradlew :junit-bom:test`):
 *
 *   Selection failed
 *     Cannot locate tasks that match ':junit-bom:test' as task 'test' not found in project ':junit-bom'.
 *
 * Matched case-insensitively on the inner clause alone, because that clause
 * is also how the message reads when it starts a sentence ("Task 'test' not
 * found in project ':x'.") - the surrounding "Selection failed / Cannot
 * locate tasks" wrapper is the part that varies.
 */
const TASK_NOT_FOUND_PATTERN = /task '([^']+)' not found in project '([^']+)'/i;

export function interpretGradleFailure(output: string): GradleFailureInterpretation | undefined {
	return interpretTaskNotFoundInProject(output) ?? interpretAndroidSdkMissing(output);
}

/**
 * The failure mode module scoping introduces. An unscoped `gradlew test
 * jacocoTestReport` silently skips every project without those tasks; the
 * moment a run is scoped, a project missing either one fails the whole
 * build at task-selection time, before anything executes. That is the
 * honest outcome, but only if the message says which module, why, and what
 * to do about it.
 *
 * The two causes are different and both were measured on real repos, so
 * they get different advice:
 *
 * - no `test` task: a `java-platform` BOM or a docs-only module
 *   (junit-framework ships both) simply has no tests.
 * - no coverage task: `jacocoTestReport` is the default task name of
 *   Gradle's `jacoco` plugin, not a universal one. On Google's Now in
 *   Android, `:core:common` (plain JVM, never applies `jacoco`) has no
 *   coverage task at all, and `:core:data` (an Android library) has
 *   variant-named ones instead - `createDemoDebugUnitTestCoverageReport`
 *   and five siblings. Telling that user to apply the jacoco plugin would
 *   be wrong twice over: their build already applies it, and AGP still
 *   would not create a task by that name.
 */
function interpretTaskNotFoundInProject(output: string): GradleFailureInterpretation | undefined {
	const match = TASK_NOT_FOUND_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	const [, taskName, projectPath] = match;
	const moduleName = projectPath.replace(/^:/, '') || 'the root project';
	if (taskName === 'test') {
		return {
			kind: 'taskNotFoundInProject',
			detail: `\`${moduleName}\` has no tests to run - a BOM or docs-only module has no \`test\` task at all. `
				+ 'Uncheck it in the module picker on the next run.',
		};
	}
	return {
		kind: 'taskNotFoundInProject',
		detail: `\`${moduleName}\` has no \`${taskName}\` task. That name is the default of Gradle's \`jacoco\` `
			+ 'plugin: an Android module never has it (AGP names coverage tasks per variant, e.g. '
			+ '`createDemoDebugUnitTestCoverageReport`), and a plain JVM module only has it when it applies that '
			+ 'plugin. Point `proof.gradleCoverageTask` at the task this build really has, or uncheck the module.',
	};
}

/**
 * Captured verbatim from a real run of
 * `./gradlew :core:data:test :core:data:createDemoDebugUnitTestCoverageReport`
 * on Now in Android, on a machine whose Android SDK had only
 * `platform-tools` installed:
 *
 *   Could not determine the dependencies of task ':core:data:testDemoDebugUnitTest'.
 *   > SDK location not found. Define a valid SDK location with an ANDROID_HOME
 *     environment variable or by setting the sdk.dir path in your project's
 *     local properties file at '...\local.properties'.
 *
 * Worth its own shape because the raw output buries it under hundreds of
 * AGP configuration warnings, and because nothing about it is proof-java's
 * doing - the build simply cannot run here at all.
 */
const ANDROID_SDK_MISSING_PATTERN = /SDK location not found/i;

function interpretAndroidSdkMissing(output: string): GradleFailureInterpretation | undefined {
	if (!ANDROID_SDK_MISSING_PATTERN.test(output)) {
		return undefined;
	}
	return {
		kind: 'androidSdkMissing',
		detail: 'this Android build needs an Android SDK, and Gradle could not find one. Set `ANDROID_HOME`, or '
			+ 'put `sdk.dir` into the `local.properties` file at the repo root. Nothing about this is specific to '
			+ 'Proof - the build cannot run at all without an SDK.',
	};
}
