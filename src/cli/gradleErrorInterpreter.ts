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

export type GradleFailureKind = 'taskNotFoundInProject';

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
	return interpretTaskNotFoundInProject(output);
}

/**
 * The failure mode module scoping introduces. An unscoped `gradlew test
 * jacocoTestReport` silently skips every project without those tasks; the
 * moment a run is scoped, a project that has no `test` at all (a
 * `java-platform` BOM, a docs-only module - junit-framework has both) or no
 * `jacoco` plugin fails the whole build instead. That is the honest
 * outcome, but only if the message says which module and what to do.
 */
function interpretTaskNotFoundInProject(output: string): GradleFailureInterpretation | undefined {
	const match = TASK_NOT_FOUND_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	const [, taskName, projectPath] = match;
	const moduleName = projectPath.replace(/^:/, '') || 'the root project';
	const cause = taskName === 'test'
		? `\`${moduleName}\` has no tests to run (a BOM or docs-only module has no \`test\` task at all)`
		: `\`${moduleName}\` does not apply the plugin that provides \`${taskName}\` (usually \`jacoco\`)`;
	return {
		kind: 'taskNotFoundInProject',
		detail: `${cause}. Uncheck it in the module picker on the next run, or add that plugin to it.`,
	};
}
