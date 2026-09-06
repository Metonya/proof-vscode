import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ruleDocsUrl, ruleInfo } from '../../../model/ruleCatalog';
import type { RuleId } from '../../../verdict/types';

const ALL_RULES: readonly RuleId[] = [
	'NO_RECOGNIZED_ORACLE',
	'TAUTOLOGICAL_ORACLE',
	'CATCH_ORACLE_WITHOUT_FAIL',
	'NULL_CHECK_ONLY',
	'PSEUDO_TESTED_METHOD',
	'SUBSUMED_TEST',
];

/** Faz 18: every rule the CLI can emit must have a readable title/summary/action - a missing one would silently fall back to the raw enum the user complained about. */
test('every RuleId has a non-empty title, summary and action', () => {
	for (const rule of ALL_RULES) {
		const info = ruleInfo(rule);
		assert.equal(info.code, rule, 'the raw enum stays available for search/grep');
		assert.ok(info.title.length > 0, `${rule} has no title`);
		assert.ok(info.summary.length > 20, `${rule}'s summary is too short to explain anything`);
		assert.ok(info.action.length > 0, `${rule} has no action`);
	}
});

test('no title is just the raw enum - the whole point is that it is readable', () => {
	for (const rule of ALL_RULES) {
		assert.notEqual(ruleInfo(rule).title, rule);
		assert.ok(!ruleInfo(rule).title.includes('_'), `${rule}'s title still looks like an enum`);
	}
});

test('ruleDocsUrl points at that rule\'s own doc in the proof-java repo', () => {
	assert.equal(ruleDocsUrl('NULL_CHECK_ONLY'), 'https://github.com/Metonya/proof-java/blob/main/docs/rules/NULL_CHECK_ONLY.md');
});
