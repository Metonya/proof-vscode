import { parseTestIdentity } from '../verdict/testIdentity';
import type { Finding } from '../verdict/types';

/**
 * Faz 15a: the join proof-vscode never made. `findings[].testMethod`
 * (shape `FQCN#method()`) and `perTest`'s test ids (JUnit5 UniqueId or the
 * same `FQCN#method()` shape, see `verdict/testIdentity.ts`) refer to the
 * exact same test - confirmed against a real playground run, 2026-08-28,
 * 17 exact matches. Without this join, a line covered only by a test with
 * no assertion looks identical in the UI to a line covered by a real test -
 * proof-java's entire reason to exist over plain JaCoCo, invisible until now.
 *
 * Pure - no `vscode` (Plan.md Bölüm 2's first invariant).
 */
export type TestVerdict = 'ok' | 'noOracle' | 'weak' | 'redundant' | 'inconclusive';

/** Keyed by `finding.testMethod` (already `FQCN#method()`, no reshaping) - the only findings that can be joined to a test id are the ones the CLI itself anchored on a test method. */
export function indexFindingsByTestMethod(findings: readonly Finding[]): ReadonlyMap<string, Finding> {
	const index = new Map<string, Finding>();
	for (const finding of findings) {
		if (finding.testMethod) {
			index.set(finding.testMethod, finding);
		}
	}
	return index;
}

/**
 * `rawTestId` (a `perTest` line's test id) is parsed to the same
 * `Class#method()` key `finding.testMethod` already uses, then matched.
 * No match -> `ok` (hard rule 3a: absence of a finding is not itself
 * evidence of quality, but this module has nothing further to say - the L0
 * oracle scan already looked and found nothing wrong). `INCONCLUSIVE`
 * confidence is kept distinct from a real `noOracle` verdict - a test the
 * scanner could not resolve is not the same claim as a test with no
 * oracle at all (real playground case: `CalculatorUnresolvedOracleTest`,
 * confidence INCONCLUSIVE on `NO_RECOGNIZED_ORACLE`).
 */
export function classifyTest(rawTestId: string, findingsByTestMethod: ReadonlyMap<string, Finding>): TestVerdict {
	const identity = parseTestIdentity(rawTestId);
	if (identity.className === null || identity.methodName === null) {
		return 'ok';
	}
	const finding = findingsByTestMethod.get(`${identity.className}#${identity.methodName}()`);
	if (!finding) {
		return 'ok';
	}
	if (finding.confidence === 'INCONCLUSIVE') {
		return 'inconclusive';
	}
	switch (finding.rule) {
		case 'NO_RECOGNIZED_ORACLE':
		case 'TAUTOLOGICAL_ORACLE':
		case 'CATCH_ORACLE_WITHOUT_FAIL':
			return 'noOracle';
		case 'NULL_CHECK_ONLY':
			return 'weak';
		case 'SUBSUMED_TEST':
			return 'redundant';
		case 'PSEUDO_TESTED_METHOD':
			// Anchored on the production method (mutation evidence), not a
			// single test's oracle quality - has nothing to say about which
			// of the covering tests is weak, so it does not downgrade any of them.
			return 'ok';
	}
}

export interface TestQualityRef {
	rawTestId: string;
	verdict: TestVerdict;
	/** `undefined` when `verdict` is `'ok'` - nothing to point at. */
	finding: Finding | undefined;
}

export interface LineQuality {
	tests: readonly TestQualityRef[];
	byVerdict: Readonly<Record<TestVerdict, number>>;
	/**
	 * True only when at least one test covers the line AND every one of
	 * them is `noOracle` - a JaCoCo-green line that no test actually
	 * verifies anything on. A single `inconclusive` test blocks this (the
	 * scanner could not confirm noOracle, so neither can this line), same
	 * for `ok`/`weak`/`redundant` - any test that did assert something,
	 * however imperfectly, is enough to not call the line a false green.
	 */
	isFalseGreen: boolean;
}

export function lineQuality(rawTestIds: readonly string[], findingsByTestMethod: ReadonlyMap<string, Finding>): LineQuality {
	const byVerdict: Record<TestVerdict, number> = { ok: 0, noOracle: 0, weak: 0, redundant: 0, inconclusive: 0 };
	const tests: TestQualityRef[] = [];
	for (const rawTestId of rawTestIds) {
		const identity = parseTestIdentity(rawTestId);
		const finding = identity.className && identity.methodName
			? findingsByTestMethod.get(`${identity.className}#${identity.methodName}()`)
			: undefined;
		const verdict = classifyTest(rawTestId, findingsByTestMethod);
		byVerdict[verdict] += 1;
		tests.push({ rawTestId, verdict, finding });
	}
	const isFalseGreen = tests.length > 0 && byVerdict.noOracle === tests.length;
	return { tests, byVerdict, isFalseGreen };
}
