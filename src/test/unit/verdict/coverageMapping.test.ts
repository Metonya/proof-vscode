import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapLines } from '../../../verdict/coverageMapping';
import type { LineTuple } from '../../../verdict/types';

test('a fully covered line with no branches has no branch data', () => {
	const [line] = mapLines([[14, 0, 3, 0, 0]], 'branch-approximation');
	assert.equal(line.executed, true);
	assert.deepEqual(line.branches, []);
});

test('an uncovered line is not executed and has no branches', () => {
	const [line] = mapLines([[14, 2, 0, 0, 0]], 'branch-approximation');
	assert.equal(line.executed, false);
	assert.deepEqual(line.branches, []);
});

test('real branch data is used as-is, regardless of partialLineMode', () => {
	const tuple: LineTuple = [14, 0, 2, 1, 1];
	for (const mode of ['branch-approximation', 'strict'] as const) {
		const [line] = mapLines([tuple], mode);
		assert.equal(line.executed, true);
		assert.deepEqual(line.branches, ['covered', 'missed']);
	}
});

test('branch-approximation synthesizes a covered+missed pair for a partial line with no real branches', () => {
	const [line] = mapLines([[14, 2, 3, 0, 0]], 'branch-approximation');
	assert.equal(line.executed, true);
	assert.deepEqual(line.branches, ['covered', 'missed']);
});

test('strict leaves a partial line with no real branches branchless', () => {
	const [line] = mapLines([[14, 2, 3, 0, 0]], 'strict');
	assert.equal(line.executed, true);
	assert.deepEqual(line.branches, []);
});

test('multiple covered and missed real branches all round-trip in order (covered first)', () => {
	const [line] = mapLines([[14, 0, 5, 2, 3]], 'branch-approximation');
	assert.deepEqual(line.branches, ['covered', 'covered', 'covered', 'missed', 'missed']);
});
