import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { rollupFolder } from '../../../model/metrics';
import type { FileCoverageEntry } from '../../../verdict/types';
import { metricFor } from '../../../model/metrics';
import { engineLine, type Metric, type MetricSet } from '../../../verdict/types';

function fileWith(numerator: number, denominator: number): FileCoverageEntry {
	const metric = { numeratorName: 'a', numerator, denominatorName: 'b', denominator, percent: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10 };
	return { module: 'root', path: 'x', metrics: { 'jacoco-line': metric, 'strict-line': metric, 'sonar-compatible': metric }, lines: [] };
}

test('sums numerators and denominators across files, one division', () => {
	const rollup = rollupFolder([fileWith(8, 10), fileWith(2, 10)], 'jacoco-line');
	assert.equal(rollup.numerator, 10);
	assert.equal(rollup.denominator, 20);
	assert.equal(rollup.percent, 50);
});

test('an empty file list has a null percent, not a divide-by-zero NaN', () => {
	const rollup = rollupFolder([], 'jacoco-line');
	assert.equal(rollup.denominator, 0);
	assert.equal(rollup.percent, null);
});

test('a folder where every file has denominator 0 also stays null', () => {
	const rollup = rollupFolder([fileWith(0, 0), fileWith(0, 0)], 'sonar-compatible');
	assert.equal(rollup.percent, null);
});

test('a proof-python verdict resolves through either engine-line setting', () => {
	// The first mode is named after the engine that produced the report, so a
	// user whose `proof.badgeMetric` says jacoco-line must still get a number
	// from a coverage-line document, and the other way round. No migration:
	// both values mean "the engine's own line counter" (proof-java D-99).
	const metric: Metric = { numeratorName: 'a', numerator: 3, denominatorName: 'b', denominator: 4, percent: 75 };
	const other: Metric = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 4, percent: 25 };
	const python: MetricSet = { 'coverage-line': metric, 'strict-line': other, 'sonar-compatible': other };
	const java: MetricSet = { 'jacoco-line': metric, 'strict-line': other, 'sonar-compatible': other };

	for (const set of [python, java]) {
		assert.equal(metricFor(set, 'jacoco-line')?.percent, 75);
		assert.equal(metricFor(set, 'coverage-line')?.percent, 75);
		assert.equal(metricFor(set, 'strict-line')?.percent, 25);
	}
});

test('engineLine names the mode the document actually carries', () => {
	const metric: Metric = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 2, percent: 50 };
	const set: MetricSet = { 'coverage-line': metric, 'strict-line': metric, 'sonar-compatible': metric };
	assert.equal(engineLine(set)?.mode, 'coverage-line');
});
