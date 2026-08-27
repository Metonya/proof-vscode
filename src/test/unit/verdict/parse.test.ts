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
		coverage: { overall: MINIMAL_METRIC_SET, newCode: { status: 'unavailable_no_vcs' } },
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
