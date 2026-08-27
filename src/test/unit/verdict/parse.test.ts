import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVerdict } from '../../../verdict/parse';

const MINIMAL_METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 2, percent: 50 };
const MINIMAL_METRIC_SET = { 'jacoco-line': MINIMAL_METRIC, 'strict-line': MINIMAL_METRIC, 'sonar-compatible': MINIMAL_METRIC };

function minimalDocument(): unknown {
	return {
		schemaVersion: '0.1.0',
		tool: { name: 'coverdict', version: '0.1.0' },
		analysis: { status: 'complete', exitCode: 0, incompleteReasons: [] },
		inputs: { modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }] },
		coverage: { overall: MINIMAL_METRIC_SET, newCode: { status: 'unavailable_no_vcs' } },
		warnings: [],
	};
}

test('a real shaped document parses', () => {
	const result = parseVerdict(JSON.stringify(minimalDocument()));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.coverage.overall['jacoco-line'].percent, 50);
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
		assert.equal(result.value.coverage.overall['jacoco-line'].percent, null);
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
			entries: [{ className: 'dev.coverdict.playground.Calculator', methodName: 'add', lines: [{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] }] }],
			ambient: [{ className: 'dev.coverdict.playground.Calculator', methodName: '<clinit>', lines: [{ line: 3, tests: ['CalcTest#addsTwoNumbers()'] }] }],
		}],
	};
	const result = parseVerdict(JSON.stringify(doc));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.perTest?.modules[0].entries[0].lines[0].tests[0], 'CalcTest#addsTwoNumbers()');
		assert.equal(result.value.perTest?.modules[0].ambient[0].methodName, '<clinit>');
	}
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
