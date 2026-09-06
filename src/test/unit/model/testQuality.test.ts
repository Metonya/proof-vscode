import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyTest, indexFindingsByTestMethod, lineQuality } from '../../../model/testQuality';
import type { Finding } from '../../../verdict/types';

/**
 * Real data captured from a live `--per-test-target` run against
 * proof-java-playground's `Calculator.java` (2026-08-28, session that added
 * Faz 15) - not synthesized. Four lines, four different outcomes:
 *   - line 37 (`square`): one test, no oracle -> false green.
 *   - line 11 (`subtract`): same shape, different rule -> false green.
 *   - line 15 (`multiply`): three tests, one has no finding (real oracle) ->
 *     not false green even though two of the three are TAUTOLOGICAL_ORACLE.
 *   - line 7 (`add`): five tests, one is NO_RECOGNIZED_ORACLE but
 *     INCONCLUSIVE confidence -> must not count as noOracle, must not make
 *     the line false green even though every OTHER test also has no finding.
 */
const SQUARE_HAS_NO_ASSERTION = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]';
const SUBTRACT_HAS_NO_ASSERTION = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorNoOracleTest]/[method:subtractHasNoAssertion()]';
const DIVIDE_AND_MULTIPLY_WIDE = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorSubsumedTest]/[method:divideAndMultiplyWide()]';
const MULTIPLY_CONSTANT_VS_CONSTANT = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorTautologicalOracleTest]/[method:multiplyConstantVsConstant()]';
const MULTIPLY_LITERAL_BOOLEAN = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorTautologicalOracleTest]/[method:multiplyLiteralBoolean()]';
const ADD_WORKS_CORRECTLY = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorGoodTest]/[method:addWorksCorrectly()]';
const ADD_PARAM_INVOCATION_1 = '[class:dev.proofjava.playground.CalculatorParameterizedTest]/[test-template:addProducesTheSumForEveryPair(int, int, int)]/[test-template-invocation:#1]';
const ADD_CHECKED_VIA_SOFT_ASSERTIONS = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorUnresolvedOracleTest]/[method:addCheckedViaLocalSoftAssertions()]';

const FINDINGS: readonly Finding[] = [
	finding('NO_RECOGNIZED_ORACLE', 'HIGH', 'dev.proofjava.playground.CalculatorPseudoTestedTest#squareHasNoAssertion()'),
	finding('NO_RECOGNIZED_ORACLE', 'HIGH', 'dev.proofjava.playground.CalculatorNoOracleTest#subtractHasNoAssertion()'),
	finding('TAUTOLOGICAL_ORACLE', 'HIGH', 'dev.proofjava.playground.CalculatorTautologicalOracleTest#multiplyConstantVsConstant()'),
	finding('TAUTOLOGICAL_ORACLE', 'HIGH', 'dev.proofjava.playground.CalculatorTautologicalOracleTest#multiplyLiteralBoolean()'),
	finding('NO_RECOGNIZED_ORACLE', 'INCONCLUSIVE', 'dev.proofjava.playground.CalculatorUnresolvedOracleTest#addCheckedViaLocalSoftAssertions()'),
];

function finding(rule: Finding['rule'], confidence: Finding['confidence'], testMethod: string): Finding {
	return {
		rule, confidence, testMethod,
		severity: 'WARNING', module: 'root', path: 'src/test/java/X.java', startLine: 1, endLine: 1,
		message: 'm', suggestedAction: 'a', fingerprint: rule + testMethod,
	};
}

test('classifyTest: a test with a real NO_RECOGNIZED_ORACLE finding is noOracle', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	assert.equal(classifyTest(SQUARE_HAS_NO_ASSERTION, index), 'noOracle');
});

test('classifyTest: the same rule at INCONCLUSIVE confidence is a distinct verdict, not noOracle', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	assert.equal(classifyTest(ADD_CHECKED_VIA_SOFT_ASSERTIONS, index), 'inconclusive');
});

test('classifyTest: a test with no finding at all is ok', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	assert.equal(classifyTest(DIVIDE_AND_MULTIPLY_WIDE, index), 'ok');
	assert.equal(classifyTest(ADD_WORKS_CORRECTLY, index), 'ok');
});

test('lineQuality: line 37 - the single covering test has no oracle -> false green', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	const quality = lineQuality([SQUARE_HAS_NO_ASSERTION], index);
	assert.equal(quality.isFalseGreen, true);
	assert.equal(quality.byVerdict.noOracle, 1);
});

test('lineQuality: line 11 - same shape, different rule -> also false green', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	const quality = lineQuality([SUBTRACT_HAS_NO_ASSERTION], index);
	assert.equal(quality.isFalseGreen, true);
});

test('lineQuality: line 15 - two of three tests are TAUTOLOGICAL_ORACLE, but the third has a real oracle -> not false green', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	const quality = lineQuality([DIVIDE_AND_MULTIPLY_WIDE, MULTIPLY_CONSTANT_VS_CONSTANT, MULTIPLY_LITERAL_BOOLEAN], index);
	assert.equal(quality.isFalseGreen, false);
	assert.equal(quality.byVerdict.ok, 1);
	assert.equal(quality.byVerdict.noOracle, 2);
});

/**
 * The case the plan called out by name: one covering test is
 * NO_RECOGNIZED_ORACLE but INCONCLUSIVE - every other test on the line also
 * happens to have no finding (ok), so the line is not false green either
 * way here, but the inconclusive test must count as its own verdict, never
 * silently folded into noOracle or ok.
 */
test('lineQuality: line 7 - an INCONCLUSIVE test is tracked as its own verdict, not counted as noOracle', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	const quality = lineQuality(
		[ADD_WORKS_CORRECTLY, ADD_PARAM_INVOCATION_1, ADD_CHECKED_VIA_SOFT_ASSERTIONS],
		index,
	);
	assert.equal(quality.isFalseGreen, false);
	assert.equal(quality.byVerdict.inconclusive, 1);
	assert.equal(quality.byVerdict.noOracle, 0);
	assert.equal(quality.byVerdict.ok, 2);
});

test('lineQuality: a line covered by zero tests is not false green (no claim without evidence, hard rule 3a)', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	assert.equal(lineQuality([], index).isFalseGreen, false);
});

test('lineQuality: a line where every test is inconclusive is not false green', () => {
	const index = indexFindingsByTestMethod(FINDINGS);
	assert.equal(lineQuality([ADD_CHECKED_VIA_SOFT_ASSERTIONS], index).isFalseGreen, false);
});
