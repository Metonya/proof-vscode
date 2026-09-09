import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVerdict, reinternMutationTestIds, reinternPerTestIds } from '../../../verdict/parse';
import { engineLine } from '../../../verdict/types';

const MINIMAL_METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 2, percent: 50 };
const MINIMAL_METRIC_SET = { 'jacoco-line': MINIMAL_METRIC, 'strict-line': MINIMAL_METRIC, 'sonar-compatible': MINIMAL_METRIC };

function minimalDocument(): unknown {
	return {
		schemaVersion: '0.1.0',
		tool: { name: 'proof-java', version: '0.1.0' },
		analysis: { status: 'complete', exitCode: 0, incompleteReasons: [] },
		inputs: { modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }] },
		coverage: { overall: MINIMAL_METRIC_SET, newCode: { status: 'unavailable_no_vcs' } },
		changedFiles: [],
		findings: [],
		warnings: [],
	};
}

test('a real shaped document parses', () => {
	const result = parseVerdict(JSON.stringify(minimalDocument()));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.coverage.overall['jacoco-line']?.percent, 50);
	}
});

test('malformed JSON never throws - returns an error result', () => {
	const result = parseVerdict('{ this is not json');
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.error, /invalid JSON/);
	}
});

test('valid JSON missing the required shape is rejected, not partially accepted', () => {
	const result = parseVerdict(JSON.stringify({ hello: 'world' }));
	assert.equal(result.ok, false);
});

test('a null percent (denominator 0) is preserved, not coerced to a number', () => {
	const doc = minimalDocument() as { coverage: { overall: Record<string, unknown> } };
	doc.coverage.overall['jacoco-line'] = { ...MINIMAL_METRIC, denominator: 0, percent: null };
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.coverage.overall['jacoco-line']?.percent, null);
	}
});

test('a well-formed fileCoverage block parses through', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.fileCoverage = {
		files: [{ module: 'root', path: 'src/main/java/Calc.java', metrics: MINIMAL_METRIC_SET, lines: [[14, 0, 3, 0, 0]] }],
		excluded: ['src/main/java/Generated.java'],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fileCoverage?.files[0].path, 'src/main/java/Calc.java');
		assert.equal(result.value.fileCoverage?.excluded[0], 'src/main/java/Generated.java');
	}
});

test('a document with no fileCoverage at all parses with it left undefined', () => {
	const result = parseVerdict(JSON.stringify(minimalDocument()));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fileCoverage, undefined);
	}
});

test('a malformed fileCoverage block (a line tuple with the wrong arity) is rejected', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.fileCoverage = {
		files: [{ module: 'root', path: 'src/main/java/Calc.java', metrics: MINIMAL_METRIC_SET, lines: [[14, 0, 3]] }],
		excluded: [],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, false);
});

test('a well-formed perTest block parses through, entries and ambient both', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.perTest = {
		engine: 'pitest',
		engineVersion: '1.15.8',
		modules: [{
			id: 'root',
			entries: [{ className: 'dev.proofjava.playground.Calculator', methodName: 'add', lines: [{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] }] }],
			ambient: [{ className: 'dev.proofjava.playground.Calculator', methodName: '<clinit>', lines: [{ line: 3, tests: ['CalcTest#addsTwoNumbers()'] }] }],
		}],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.perTest?.modules[0].entries[0].lines[0].tests[0], 'CalcTest#addsTwoNumbers()');
		assert.equal(result.value.perTest?.modules[0].ambient[0].methodName, '<clinit>');
	}
});

test('D-86: a perTest block with interned testIds/numeric indexes resolves back to plain test-id strings', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.perTest = {
		engine: 'pitest',
		engineVersion: '1.15.8',
		modules: [{
			id: 'root',
			testIds: ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()'],
			entries: [{ className: 'dev.proofjava.playground.Calculator', methodName: 'add', lines: [{ line: 7, tests: [0, 1] }] }],
			ambient: [{ className: 'dev.proofjava.playground.Calculator', methodName: '<clinit>', lines: [{ line: 3, tests: [0] }] }],
		}],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.deepEqual(result.value.perTest?.modules[0].entries[0].lines[0].tests, ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()']);
		assert.deepEqual(result.value.perTest?.modules[0].ambient[0].lines[0].tests, ['CalcTest#addsTwoNumbers()']);
		assert.ok(!('testIds' in (result.value.perTest?.modules[0] as object)), 'the now-redundant testIds must be dropped, not left mixed with resolved-to-strings tests (Faz 34 - a leftover testIds fooled reinternPerTestIds\'s presence check)');
	}
});

test('Faz 34: reinternPerTestIds converts a resolved (plain-string) perTest block back into testIds + numeric indexes', () => {
	const doc: Record<string, unknown> = {
		modules: [{
			id: 'root',
			entries: [{ className: 'C', methodName: 'm', lines: [{ line: 7, tests: ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()'] }] }],
			ambient: [{ className: 'C', methodName: '<clinit>', lines: [{ line: 3, tests: ['CalcTest#addsTwoNumbers()'] }] }],
		}],
	};
	reinternPerTestIds(doc);
	const testModule = (doc.modules as Record<string, unknown>[])[0];
	assert.deepEqual(testModule.testIds, ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()']);
	const entries = testModule.entries as Record<string, unknown>[];
	assert.deepEqual((entries[0].lines as Record<string, unknown>[])[0].tests, [0, 1]);
	const ambient = testModule.ambient as Record<string, unknown>[];
	assert.deepEqual((ambient[0].lines as Record<string, unknown>[])[0].tests, [0]);
});

test('Faz 34: reinternPerTestIds self-heals a mixed/stale document (a leftover testIds array alongside already-resolved string tests) instead of trusting testIds\'s mere presence', () => {
	const doc: Record<string, unknown> = {
		modules: [{
			id: 'root',
			testIds: ['stale', 'leftover'], // from an older extension build's snapshot, before it deleted this on resolve
			entries: [{ className: 'C', methodName: 'm', lines: [{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] }] }],
			ambient: [],
		}],
	};
	reinternPerTestIds(doc);
	const testModule = (doc.modules as Record<string, unknown>[])[0];
	assert.deepEqual(testModule.testIds, ['CalcTest#addsTwoNumbers()'], 'must rebuild from the real string values, not trust the stale leftover array');
	const entries = testModule.entries as Record<string, unknown>[];
	assert.deepEqual((entries[0].lines as Record<string, unknown>[])[0].tests, [0]);
});

test('Faz 34: reinternPerTestIds leaves an already-native module (numeric tests, real testIds) untouched', () => {
	const doc: Record<string, unknown> = {
		modules: [{
			id: 'root',
			testIds: ['CalcTest#addsTwoNumbers()'],
			entries: [{ className: 'C', methodName: 'm', lines: [{ line: 7, tests: [0] }] }],
			ambient: [],
		}],
	};
	reinternPerTestIds(doc);
	const testModule = (doc.modules as Record<string, unknown>[])[0];
	assert.deepEqual(testModule.testIds, ['CalcTest#addsTwoNumbers()']);
	const entries = testModule.entries as Record<string, unknown>[];
	assert.deepEqual((entries[0].lines as Record<string, unknown>[])[0].tests, [0]);
});

test('Faz 34: reinternMutationTestIds converts a resolved (plain-string) mutation block back into testIds + numeric killingTests', () => {
	const doc: Record<string, unknown> = {
		modules: [{
			id: 'root',
			methods: [{
				className: 'C', methodName: 'add', methodDescription: '(II)I', firstLine: 6, lastLine: 8,
				mutants: [{ mutator: 'PrimitiveReturnsMutator', line: 7, status: 'KILLED', killingTests: ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()'] }],
			}],
		}],
	};
	reinternMutationTestIds(doc);
	const mutationModule = (doc.modules as Record<string, unknown>[])[0];
	assert.deepEqual(mutationModule.testIds, ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()']);
	const methods = mutationModule.methods as Record<string, unknown>[];
	assert.deepEqual((methods[0].mutants as Record<string, unknown>[])[0].killingTests, [0, 1]);
});

test('a document with no perTest at all parses with it left undefined', () => {
	const result = parseVerdict(JSON.stringify(minimalDocument()));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.perTest, undefined);
	}
});

test('a malformed perTest block (a line with no tests array) is rejected', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.perTest = {
		engine: 'pitest',
		engineVersion: '1.15.8',
		modules: [{ id: 'root', entries: [{ className: 'C', methodName: 'm', lines: [{ line: 1 }] }], ambient: [] }],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, false);
});

test('D-86: a mutation block with interned testIds/numeric killingTests indexes resolves back to plain test-id strings', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.mutation = {
		engine: 'pitest',
		engineVersion: '1.15.8',
		modules: [{
			id: 'root',
			testIds: ['CalcTest#addsTwoNumbers()', 'CalcTest#subtractsTwoNumbers()'],
			methods: [{
				className: 'dev.proofjava.playground.Calculator',
				methodName: 'add',
				methodDescription: '(II)I',
				firstLine: 6,
				lastLine: 8,
				mutants: [{ mutator: 'PrimitiveReturnsMutator', line: 7, status: 'KILLED', killingTests: [1, 0] }],
			}],
		}],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.deepEqual(result.value.mutation?.modules[0].methods[0].mutants[0].killingTests, ['CalcTest#subtractsTwoNumbers()', 'CalcTest#addsTwoNumbers()']);
	}
});

test('coverage.newCode as a real metricSet (a diff that ran fine) parses through', () => {
	const freshMetric = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 4, percent: 25 };
	const doc = minimalDocument() as Record<string, unknown>;
	(doc.coverage as Record<string, unknown>).newCode = { 'jacoco-line': freshMetric, 'strict-line': freshMetric, 'sonar-compatible': freshMetric };
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok && !('status' in result.value.coverage.newCode)) {
		assert.equal(engineLine(result.value.coverage.newCode)?.metric.percent, 25);
	} else {
		assert.fail('expected a real metricSet, not a status object');
	}
});

test('a well-formed finding parses through, including a SUBSUMED_TEST-only field', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.findings = [{
		rule: 'SUBSUMED_TEST', severity: 'INFO', confidence: 'MEDIUM', module: 'root',
		path: 'src/test/java/CalcTest.java', startLine: 10, endLine: 12,
		message: 'dominated', suggestedAction: 'consider removing', fingerprint: 'abc123',
		testMethod: 'narrowCase', relatedTestMethod: 'wideCase',
	}];
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.findings[0].rule, 'SUBSUMED_TEST');
		assert.equal(result.value.findings[0].relatedTestMethod, 'wideCase');
	}
});

test('a finding with an unrecognized rule id is rejected', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.findings = [{
		rule: 'NOT_A_REAL_RULE', severity: 'WARNING', confidence: 'HIGH', module: 'root',
		path: 'x', startLine: 1, endLine: 1, message: 'm', suggestedAction: 's', fingerprint: 'f',
	}];
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, false);
});

test('a well-formed mapped changedFile with uncoveredNewRanges parses through', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.changedFiles = [{
		path: 'src/main/java/Calc.java', module: 'root', classification: 'mapped',
		newLines: 14, coveredNewLines: 10, uncoveredNewRanges: [[42, 44], [51, 51]],
	}];
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.deepEqual(result.value.changedFiles[0].uncoveredNewRanges, [[42, 44], [51, 51]]);
	}
});

test('an unmapped changedFile without the mapped-only fields still parses', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.changedFiles = [{ path: 'README.md', classification: 'unsupported' }];
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
});

test('warnings carry through with their optional path/module/count fields', () => {
	const doc = minimalDocument() as Record<string, unknown>;
	doc.warnings = [{ code: 'PER_TEST_TRUNCATED', message: 'evidence dropped', module: 'root', count: 3 }];
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.warnings[0].code, 'PER_TEST_TRUNCATED');
		assert.equal(result.value.warnings[0].count, 3);
	}
});
