import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapLines } from '../../../verdict/coverageMapping';

test('a fully covered line has no partial flag', () => {
	const [line] = mapLines([[14, 0, 3, 0, 0]]);
	assert.equal(line.executed, true);
	assert.equal(line.partial, false);
});

test('an uncovered line is not executed and not partial', () => {
	const [line] = mapLines([[14, 2, 0, 0, 0]]);
	assert.equal(line.executed, false);
	assert.equal(line.partial, false);
});

test('a real missed branch marks an executed line partial', () => {
	const [line] = mapLines([[14, 0, 2, 1, 1]]);
	assert.equal(line.executed, true);
	assert.equal(line.partial, true);
});

test('a partial instruction count with no branch data still marks the line partial', () => {
	const [line] = mapLines([[14, 2, 3, 0, 0]]);
	assert.equal(line.executed, true);
	assert.equal(line.partial, true);
});

test('fully covered instructions and branches classify as not partial', () => {
	const [line] = mapLines([[14, 0, 5, 0, 3]]);
	assert.equal(line.executed, true);
	assert.equal(line.partial, false);
});
