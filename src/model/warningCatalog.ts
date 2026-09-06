import type { Reason } from '../verdict/types';

/**
 * Phase 18: `warnings[]` became visible in Phase 14d, but only with the
 * raw CLI message - codes are English and technical
 * ("CHANGED_LINES_ABSENT_FROM_REPORT: 3 changed line(s) ... are absent
 * from the bound report(s)"), with no explanation of what it means or
 * what to do about it anywhere.
 *
 * This catalog gives each code a plain title + "what it means" + "what to
 * do". The raw message is **never dropped** - it stays in the tooltip
 * verbatim, because it carries real numbers the CLI itself counted (how
 * many lines, how many files) that can't be invented here. An unrecognized
 * code falls back to its raw form (hard rule 3a: never pretend to
 * recognize something we don't).
 * Pure - no `vscode`.
 */
export interface WarningInfo {
	code: string;
	title: string;
	/** `undefined` when the code is not in the catalogue - the caller falls back to the raw CLI message. */
	explanation: string | undefined;
	action: string | undefined;
}

const CATALOG: Record<string, { title: string; explanation: string; action: string }> = {
	CHANGED_LINES_ABSENT_FROM_REPORT: {
		title: 'Some changed lines are missing from the coverage report',
		explanation: 'Some of the lines you changed never appear in the JaCoCo report at all, so they contributed to neither the numerator nor the denominator of the "new code" percentage. '
			+ 'There are two possible causes and proof-java can\'t tell them apart: (1) those lines aren\'t executable code to begin with - a brace, a method signature, a blank line; JaCoCo never lists these, and that\'s completely normal. '
			+ '(2) The report is older than this change - i.e. you haven\'t run the tests since your last edit.',
		action: 'If the number is lower than expected, rerun the tests to refresh the report first (mvn test). If it still shows up after that, the remaining lines are likely just braces/signatures.',
	},
	CHANGED_FILES_EXCLUDED: {
		title: 'Some changed files were excluded from coverage',
		explanation: 'Some of the files you changed matched a proof.coverageExclusions pattern (or a test folder), so they never entered the new-code calculation at all.',
		action: 'If that\'s intentional, there\'s nothing to do. Otherwise, review your proof.coverageExclusions setting.',
	},
	MODULE_WITHOUT_REPORT: {
		title: 'A module has no coverage report',
		explanation: 'A defined module has no JaCoCo report bound to it, so that module was excluded from the analyzed set entirely - its coverage isn\'t 0%, it\'s simply unknown.',
		action: 'Run that module\'s tests with JaCoCo and make sure the proof.reportPath setting points at the right file.',
	},
	PER_TEST_NO_CHANGED_TARGETS: {
		title: 'No target class for per-test evidence',
		explanation: 'Deep Scan can only target production classes that changed in the diff; nothing was collected because no class changed in this run. This isn\'t an error.',
		action: 'Make a real change to a file and scan again, or for a single class: right-click that file → "Which Test Covers Which Line For This Class".',
	},
	PER_TEST_CLASSPATH_MISSING: {
		title: 'No classpath file bound for per-test evidence',
		explanation: 'Deep Scan reruns your tests under PIT, which needs a file listing the full test classpath line by line; no such file is bound to this module.',
		action: 'Generate the classpath list (mvn dependency:build-classpath) and make sure proof.perTestClasspathPath points at it.',
	},
	PER_TEST_TRUNCATED: {
		title: 'Per-test evidence was truncated',
		explanation: 'Part of the collected evidence was dropped. What\'s shown may be incomplete - a line not appearing here does NOT mean "no test covers it".',
		action: 'If you need complete evidence, rerun the scan with a narrower scope (a single class).',
	},
	PER_TEST_EMPTY_EVIDENCE: {
		title: 'Per-test evidence ran but came back empty',
		explanation: 'The engine ran but couldn\'t resolve any test-to-line records. Evidence was requested but is missing - this means "we couldn\'t tell", not "no test covers these lines".',
		action: 'Confirm the tests actually ran and that the classpath list includes the compiled classes (target/classes, target/test-classes).',
	},
	PER_TEST_TARGET_UNRESOLVED: {
		title: 'Target class not found',
		explanation: 'The class name given for per-test evidence couldn\'t be resolved to a .java file under any declared source root, so it was skipped.',
		action: 'Make sure the class name is fully qualified (package included) and the file lives under src/main/java.',
	},
	PER_TEST_TARGET_NOT_BOUND: {
		title: 'No target class given for a module',
		explanation: 'A defined module had no target class bound to it in this run, so it was excluded from per-test evidence entirely. Normal when targeting a single module in a multi-module project.',
		action: 'If that\'s intentional, there\'s nothing to do.',
	},
	PER_TEST_COLLECTION_FAILED: {
		title: 'Per-test evidence collection failed',
		explanation: 'The engine reported an error for this module; its per-test evidence was skipped. Coverage numbers are unaffected, only "which test covers which line" is missing.',
		action: 'Check the proof-java output channel for detail (Output → proof-java).',
	},
};

export function warningInfo(reason: Reason): WarningInfo {
	const known = CATALOG[reason.code];
	return {
		code: reason.code,
		title: known?.title ?? reason.code,
		explanation: known?.explanation,
		action: known?.action,
	};
}
