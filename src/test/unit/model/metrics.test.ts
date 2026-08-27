import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { rollupFolder } from '../../../model/metrics';
import type { FileCoverageEntry } from '../../../verdict/types';

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
