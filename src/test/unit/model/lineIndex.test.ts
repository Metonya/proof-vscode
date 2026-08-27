import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { testsForClass } from '../../../model/lineIndex';
import type { PerTestBlock } from '../../../verdict/types';

const BLOCK: PerTestBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [
			{ className: 'dev.coverdict.playground.Calculator', methodName: 'add', lines: [
				{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] },
			] },
			{ className: 'dev.coverdict.playground.Calculator$Inner', methodName: 'helper', lines: [
				{ line: 40, tests: ['CalcTest#innerHelperTest()'] },
			] },
		],
		ambient: [
			{ className: 'dev.coverdict.playground.Calculator', methodName: '<clinit>', lines: [
				{ line: 3, tests: ['CalcTest#addsTwoNumbers()'] },
			] },
		],
	}],
};

test('a known class returns its lines merged from entries and ambient', () => {
	const result = testsForClass(BLOCK, 'root', 'dev.coverdict.playground.Calculator');
	assert.equal(result.kind, 'found');
	if (result.kind === 'found') {
		assert.deepEqual(result.linesToTests.get(7), ['CalcTest#addsTwoNumbers()']);
		assert.deepEqual(result.linesToTests.get(3), ['CalcTest#addsTwoNumbers()']);
	}
});

test('a nested class entry is matched under its outer class name', () => {
	const result = testsForClass(BLOCK, 'root', 'dev.coverdict.playground.Calculator');
	assert.equal(result.kind, 'found');
	if (result.kind === 'found') {
		assert.deepEqual(result.linesToTests.get(40), ['CalcTest#innerHelperTest()']);
	}
});

test('a module id not present in the block is reported distinctly from a missing class', () => {
	const result = testsForClass(BLOCK, 'nope', 'dev.coverdict.playground.Calculator');
	assert.equal(result.kind, 'moduleNotFound');
});

test('a class with no matching entries is classNotFound - "L2 sadece değişen sınıflar için"', () => {
	const result = testsForClass(BLOCK, 'root', 'dev.coverdict.playground.NotAChangedClass');
	assert.equal(result.kind, 'classNotFound');
});
