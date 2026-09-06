import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { warningInfo } from '../../../model/warningCatalog';

/** Faz 18: the warning the user actually saw and could not interpret - it must now carry both possible causes, since proof-java genuinely cannot tell them apart. */
test('CHANGED_LINES_ABSENT_FROM_REPORT explains both causes: non-executable lines and a stale report', () => {
	const info = warningInfo({ code: 'CHANGED_LINES_ABSENT_FROM_REPORT', message: '3 changed line(s) across 1 file(s) are absent...' });
	assert.notEqual(info.title, info.code, 'the title must be readable, not the raw enum');
	assert.ok(info.explanation);
	assert.match(info.explanation!, /parantez|imza/, 'must mention the benign cause (braces/signatures are not executable)');
	assert.match(info.explanation!, /eski/, 'must mention the real cause (a stale report)');
	assert.ok(info.action);
});

test('every catalogued code gets a title different from the code itself', () => {
	const codes = [
		'CHANGED_LINES_ABSENT_FROM_REPORT',
		'CHANGED_FILES_EXCLUDED',
		'MODULE_WITHOUT_REPORT',
		'PER_TEST_NO_CHANGED_TARGETS',
		'PER_TEST_CLASSPATH_MISSING',
		'PER_TEST_TRUNCATED',
		'PER_TEST_EMPTY_EVIDENCE',
		'PER_TEST_TARGET_UNRESOLVED',
		'PER_TEST_TARGET_NOT_BOUND',
		'PER_TEST_COLLECTION_FAILED',
	];
	for (const code of codes) {
		const info = warningInfo({ code, message: 'raw' });
		assert.notEqual(info.title, code, `${code} has no Turkish title`);
		assert.ok(info.explanation, `${code} has no explanation`);
		assert.ok(info.action, `${code} has no action`);
	}
});

/** Hard rule 3a: an unknown code is shown as-is rather than dressed up as something we recognize. */
test('an unknown warning code falls back to the raw code with no invented explanation', () => {
	const info = warningInfo({ code: 'SOME_FUTURE_CODE', message: 'raw message' });
	assert.equal(info.title, 'SOME_FUTURE_CODE');
	assert.equal(info.explanation, undefined);
	assert.equal(info.action, undefined);
});
