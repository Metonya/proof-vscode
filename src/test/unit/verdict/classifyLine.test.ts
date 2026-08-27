import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyLine, mapLines } from '../../../verdict/coverageMapping';

/**
 * Plan.md F7's own requirement: "İki yol da özdeş durum üretiyor" (the
 * native path and the decoration fallback produce identical states). This
 * is proven by construction - ui/coverageProvider.ts and
 * ui/decorationFallback.ts both call mapLines + classifyLine, never a
 * second implementation - but this test locks the classification contract
 * itself so a future change to either consumer can't silently diverge.
 */

test('a fully covered line with no branch data classifies as covered', () => {
	const [line] = mapLines([[14, 0, 3, 0, 0]], 'branch-approximation');
	assert.equal(classifyLine(line), 'covered');
});

test('an unexecuted line classifies as uncovered regardless of branch data', () => {
	const [line] = mapLines([[14, 2, 0, 1, 0]], 'branch-approximation');
	assert.equal(classifyLine(line), 'uncovered');
});

test('an executed line with a real missed branch classifies as partial', () => {
	const [line] = mapLines([[14, 0, 2, 1, 1]], 'branch-approximation');
	assert.equal(classifyLine(line), 'partial');
});

test('an executed line with only covered real branches classifies as covered', () => {
	const [line] = mapLines([[14, 0, 2, 0, 2]], 'branch-approximation');
	assert.equal(classifyLine(line), 'covered');
});

test('branch-approximation classifies a partial-instruction line with no real branches as partial', () => {
	const [line] = mapLines([[14, 2, 3, 0, 0]], 'branch-approximation');
	assert.equal(classifyLine(line), 'partial');
});

test('strict classifies the same partial-instruction line as covered (the honest-but-less-visible tradeoff)', () => {
	const [line] = mapLines([[14, 2, 3, 0, 0]], 'strict');
	assert.equal(classifyLine(line), 'covered');
});
