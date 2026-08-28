import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { getStaleFiles, isFileStale, markFileStale, setCoverageState, type CoverageState } from '../../../model/store';
import type { MetricSet } from '../../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

const STATE: CoverageState = {
	workspaceRoot: '/repo',
	fileCoverage: undefined,
	overall: METRIC_SET,
	newCode: { status: 'unavailable_no_vcs' },
	changedFiles: [],
	findings: [],
	warnings: [],
	modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }],
};

/** Faz 14e: staleness tracking lives in model/store (no vscode import), stays pure and unit-testable. */
test('a marked file is stale until the next setCoverageState resets it', () => {
	markFileStale('/repo/src/Foo.java');
	assert.equal(isFileStale('/repo/src/Foo.java'), true);
	assert.equal(isFileStale('/repo/src/Bar.java'), false);
	assert.ok(getStaleFiles().has('/repo/src/Foo.java'));

	setCoverageState(STATE);
	assert.equal(isFileStale('/repo/src/Foo.java'), false);
	assert.equal(getStaleFiles().size, 0);
});

test('marking the same file stale twice is a no-op, not a growing set', () => {
	markFileStale('/repo/src/Foo.java');
	markFileStale('/repo/src/Foo.java');
	assert.equal(getStaleFiles().size, 1);
	setCoverageState(STATE); // reset for later tests in this process
});
