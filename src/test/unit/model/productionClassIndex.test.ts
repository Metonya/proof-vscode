import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProductionClassIndex, productionSourceRoots, testSourceRoots } from '../../../model/productionClassIndex';
import type { FileCoverageBlock } from '../../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

test('buildProductionClassIndex: maps a normal file to its FQCN', () => {
	const fileCoverage: FileCoverageBlock = {
		files: [{ module: 'root', path: 'src/main/java/dev/proofjava/playground/Calculator.java', metrics: METRIC_SET, lines: [] }],
		excluded: [],
	};
	const { byClassName, ambiguous } = buildProductionClassIndex(fileCoverage, ['src/main/java']);
	assert.equal(byClassName.get('dev.proofjava.playground.Calculator'), 'src/main/java/dev/proofjava/playground/Calculator.java');
	assert.equal(ambiguous.size, 0);
});

/**
 * Faz 30: a multi-module run can (rarely) declare the same FQCN in two
 * modules. Last-writer-wins would silently point navigation at whichever
 * module happened to be listed last - a colliding name is instead removed
 * from byClassName and recorded in ambiguous (hard rule 3a: no guess).
 */
test('buildProductionClassIndex: a duplicate FQCN across two modules is dropped from byClassName and recorded as ambiguous', () => {
	const fileCoverage: FileCoverageBlock = {
		files: [
			{ module: 'moduleA', path: 'moduleA/src/main/java/com/example/Shared.java', metrics: METRIC_SET, lines: [] },
			{ module: 'moduleB', path: 'moduleB/src/main/java/com/example/Shared.java', metrics: METRIC_SET, lines: [] },
		],
		excluded: [],
	};
	const { byClassName, ambiguous } = buildProductionClassIndex(fileCoverage, ['moduleA/src/main/java', 'moduleB/src/main/java']);
	assert.equal(byClassName.has('com.example.Shared'), false);
	assert.ok(ambiguous.has('com.example.Shared'));
});

test('buildProductionClassIndex: a third file with the same colliding name does not resurrect the entry', () => {
	const fileCoverage: FileCoverageBlock = {
		files: [
			{ module: 'a', path: 'a/src/main/java/com/example/Shared.java', metrics: METRIC_SET, lines: [] },
			{ module: 'b', path: 'b/src/main/java/com/example/Shared.java', metrics: METRIC_SET, lines: [] },
			{ module: 'c', path: 'c/src/main/java/com/example/Shared.java', metrics: METRIC_SET, lines: [] },
		],
		excluded: [],
	};
	const { byClassName, ambiguous } = buildProductionClassIndex(fileCoverage, ['a/src/main/java', 'b/src/main/java', 'c/src/main/java']);
	assert.equal(byClassName.has('com.example.Shared'), false);
	assert.equal(ambiguous.size, 1);
});

test('buildProductionClassIndex: distinct FQCNs across modules never collide', () => {
	const fileCoverage: FileCoverageBlock = {
		files: [
			{ module: 'gson', path: 'gson/src/main/java/com/google/gson/Gson.java', metrics: METRIC_SET, lines: [] },
			{ module: 'extras', path: 'extras/src/main/java/com/google/gson/extras/Extra.java', metrics: METRIC_SET, lines: [] },
		],
		excluded: [],
	};
	const { byClassName, ambiguous } = buildProductionClassIndex(fileCoverage, ['gson/src/main/java', 'extras/src/main/java']);
	assert.equal(byClassName.get('com.google.gson.Gson'), 'gson/src/main/java/com/google/gson/Gson.java');
	assert.equal(byClassName.get('com.google.gson.extras.Extra'), 'extras/src/main/java/com/google/gson/extras/Extra.java');
	assert.equal(ambiguous.size, 0);
});

test('productionSourceRoots: flattens every module\'s declared roots', () => {
	const roots = productionSourceRoots([
		{ sourceRoots: ['gson/src/main/java'] },
		{ sourceRoots: ['extras/src/main/java'] },
	]);
	assert.deepEqual(roots, ['gson/src/main/java', 'extras/src/main/java']);
});

test('productionSourceRoots: falls back to the Maven default when no module declares any', () => {
	assert.deepEqual(productionSourceRoots([]), ['src/main/java']);
});

test('testSourceRoots: same shape as productionSourceRoots, for test roots', () => {
	assert.deepEqual(testSourceRoots([{ testRoots: ['gson/src/test/java'] }]), ['gson/src/test/java']);
	assert.deepEqual(testSourceRoots([]), ['src/test/java']);
});
