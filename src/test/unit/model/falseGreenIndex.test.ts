import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildFalseGreenIndex } from '../../../model/falseGreenIndex';
import type { FileCoverageBlock, Finding, PerTestBlock } from '../../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

const FILE_COVERAGE: FileCoverageBlock = {
	files: [{ module: 'root', path: 'src/main/java/dev/proofjava/playground/Calculator.java', metrics: METRIC_SET, lines: [] }],
	excluded: [],
};

const PER_TEST: PerTestBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [{
			className: 'dev.proofjava.playground.Calculator',
			methodName: 'square',
			lines: [
				{ line: 37, tests: ['[class:dev.proofjava.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] },
				{ line: 15, tests: [
					'[class:dev.proofjava.playground.CalculatorSubsumedTest]/[method:divideAndMultiplyWide()]',
					'[class:dev.proofjava.playground.CalculatorTautologicalOracleTest]/[method:multiplyConstantVsConstant()]',
				] },
			],
		}],
		ambient: [],
	}],
};

const FINDINGS: readonly Finding[] = [
	{
		rule: 'NO_RECOGNIZED_ORACLE', confidence: 'HIGH', severity: 'WARNING', module: 'root',
		path: 'x', startLine: 1, endLine: 1, message: 'm', suggestedAction: 'a', fingerprint: '1',
		testMethod: 'dev.proofjava.playground.CalculatorPseudoTestedTest#squareHasNoAssertion()',
	},
	{
		rule: 'TAUTOLOGICAL_ORACLE', confidence: 'HIGH', severity: 'WARNING', module: 'root',
		path: 'x', startLine: 1, endLine: 1, message: 'm', suggestedAction: 'a', fingerprint: '2',
		testMethod: 'dev.proofjava.playground.CalculatorTautologicalOracleTest#multiplyConstantVsConstant()',
	},
];

/** Real data shape from a live --per-test-target run (Faz 15 session) - line 37's single test has no oracle, line 15's has a real one alongside a weak one. */
test('buildFalseGreenIndex: a line whose only covering test has no oracle is in the index, keyed by the production file path', () => {
	const index = buildFalseGreenIndex(PER_TEST, FINDINGS, FILE_COVERAGE, ['src/main/java']);
	const lines = index.get('src/main/java/dev/proofjava/playground/Calculator.java');
	assert.ok(lines?.has(37));
});

test('buildFalseGreenIndex: a line with at least one test that has no finding is not in the index', () => {
	const index = buildFalseGreenIndex(PER_TEST, FINDINGS, FILE_COVERAGE, ['src/main/java']);
	const lines = index.get('src/main/java/dev/proofjava/playground/Calculator.java');
	assert.ok(!lines?.has(15));
});

test('buildFalseGreenIndex: an empty modules array returns an empty index, not an error', () => {
	const empty: PerTestBlock = { engine: 'pitest', engineVersion: '1.15.8', modules: [] };
	assert.equal(buildFalseGreenIndex(empty, FINDINGS, FILE_COVERAGE, ['src/main/java']).size, 0);
});

test('buildFalseGreenIndex: no fileCoverage (flag not requested) returns an empty index rather than guessing a path', () => {
	assert.equal(buildFalseGreenIndex(PER_TEST, FINDINGS, undefined, ['src/main/java']).size, 0);
});

/** Faz 30: evidence from several bound modules merges. */
test('buildFalseGreenIndex: merges evidence across two modules', () => {
	const secondFileCoverage: FileCoverageBlock = {
		files: [...FILE_COVERAGE.files, { module: 'gson', path: 'gson/src/main/java/com/example/Other.java', metrics: METRIC_SET, lines: [] }],
		excluded: [],
	};
	const secondModule: PerTestBlock = {
		engine: 'pitest', engineVersion: '1.15.8',
		modules: [
			...PER_TEST.modules,
			{ id: 'gson', entries: [{ className: 'com.example.Other', methodName: 'run', lines: [{ line: 9, tests: ['[class:com.example.OtherTest]/[method:runs()]'] }] }], ambient: [] },
		],
	};
	const otherFindings: readonly Finding[] = [
		{ rule: 'NO_RECOGNIZED_ORACLE', confidence: 'HIGH', severity: 'WARNING', module: 'gson', path: 'x', startLine: 1, endLine: 1, message: 'm', suggestedAction: 'a', fingerprint: '3', testMethod: 'com.example.OtherTest#runs()' },
	];
	const index = buildFalseGreenIndex(secondModule, [...FINDINGS, ...otherFindings], secondFileCoverage, ['src/main/java', 'gson/src/main/java']);
	assert.ok(index.get('src/main/java/dev/proofjava/playground/Calculator.java')?.has(37));
	assert.ok(index.get('gson/src/main/java/com/example/Other.java')?.has(9));
});
