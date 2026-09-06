import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { getMutationState, getPerTestState, getStaleFiles, isFileStale, markFileStale, setCoverageState, setMutationState, setPerTestState, type CoverageState } from '../../../model/store';
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

/** Faz 30: PerTestState/MutationState no longer carry a moduleId - a multi-module run's evidence lives entirely inside perTest.modules[]/mutation.modules[], nothing left to select. */
test('PerTestState/MutationState round-trip with no moduleId field', () => {
	const perTestBlock = { engine: 'pitest', engineVersion: '1.15.8', modules: [] };
	setPerTestState({ perTest: perTestBlock, warnings: [], targets: [], ranAt: undefined });
	assert.deepEqual(getPerTestState(), { perTest: perTestBlock, warnings: [], targets: [], ranAt: undefined });

	const mutationBlock = { engine: 'pitest', engineVersion: '1.15.8', modules: [] };
	setMutationState({ mutation: mutationBlock, warnings: [], targets: [], ranAt: undefined });
	assert.deepEqual(getMutationState(), { mutation: mutationBlock, warnings: [], targets: [], ranAt: undefined });
});
