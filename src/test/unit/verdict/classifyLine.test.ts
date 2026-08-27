import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyLine, mapLines } from '../../../verdict/coverageMapping';

/**
 * `ui/gutterRenderer.ts` is the only consumer of this classification (Faz
 * 9 dropped the native Test Coverage API entirely) - this test locks the
 * contract so a future change can't silently diverge from what gets painted.
 */

test('a fully covered line with no branch data classifies as covered', () => {
	const [line] = mapLines([[14, 0, 3, 0, 0]]);
	assert.equal(classifyLine(line), 'covered');
});

test('an unexecuted line classifies as uncovered regardless of branch data', () => {
	const [line] = mapLines([[14, 2, 0, 1, 0]]);
	assert.equal(classifyLine(line), 'uncovered');
});

test('an executed line with a real missed branch classifies as partial', () => {
	const [line] = mapLines([[14, 0, 2, 1, 1]]);
	assert.equal(classifyLine(line), 'partial');
});

test('an executed line with only covered real branches classifies as covered', () => {
	const [line] = mapLines([[14, 0, 2, 0, 2]]);
	assert.equal(classifyLine(line), 'covered');
});

test('a partial-instruction line with no real branches classifies as partial', () => {
	const [line] = mapLines([[14, 2, 3, 0, 0]]);
	assert.equal(classifyLine(line), 'partial');
});
