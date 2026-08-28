import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupConsecutiveLines, testsForClass, testsToLines } from '../../../model/lineIndex';
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

/**
 * Faz 14c (hata D-6): `entries` (a test directly executed this line) and
 * `ambient` (only reachable via a static initializer, D-50) must stay in
 * two separate maps, not merged - a caller that flattens them can no longer
 * tell "a test really covers this" from "this line only ran because of
 * `<clinit>`".
 */
test('a known class returns real entries in linesToTests, static-initializer evidence separately in ambientLinesToTests', () => {
	const result = testsForClass(BLOCK, 'root', 'dev.coverdict.playground.Calculator');
	assert.equal(result.kind, 'found');
	if (result.kind === 'found') {
		assert.deepEqual(result.linesToTests.get(7), ['CalcTest#addsTwoNumbers()']);
		assert.equal(result.linesToTests.get(3), undefined, 'line 3 only has ambient evidence, must not appear in linesToTests');
		assert.deepEqual(result.ambientLinesToTests.get(3), ['CalcTest#addsTwoNumbers()']);
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

/**
 * Faz 15a: `testsForClass`'ın tersi - "bu test hangi satırları çalıştırıyor".
 * Anahtar `parseTestIdentity`'nin `Class#method()` biçimi, `model/
 * testQuality.ts`'in `finding.testMethod` eşleştirmesiyle aynı sözleşme.
 */
test('testsToLines: a test appears once per production line it covers, keyed by Class#method()', () => {
	const reverse = testsToLines(BLOCK, 'root');
	const refs = reverse.get('CalcTest#addsTwoNumbers()');
	assert.ok(refs);
	assert.deepEqual([...refs!].sort((a, b) => a.line - b.line), [{ outerClassName: 'dev.coverdict.playground.Calculator', line: 7 }]);
});

test('testsToLines: ambient (<clinit>-only) evidence is excluded - a test does not "run" a line it only reached indirectly', () => {
	const reverse = testsToLines(BLOCK, 'root');
	const refs = reverse.get('CalcTest#addsTwoNumbers()');
	assert.ok(refs);
	assert.ok(!refs!.some((r) => r.line === 3), 'line 3 is ambient-only, must not appear in the reverse index');
});

test('testsToLines: a nested-class entry is reported under its outer class name', () => {
	const reverse = testsToLines(BLOCK, 'root');
	const refs = reverse.get('CalcTest#innerHelperTest()');
	assert.deepEqual(refs, [{ outerClassName: 'dev.coverdict.playground.Calculator', line: 40 }]);
});

test('testsToLines: a module id not present in the block returns an empty map, not an error', () => {
	assert.equal(testsToLines(BLOCK, 'nope').size, 0);
});

/**
 * Faz 17a: the real regression this exists for - a constructor/notify
 * method whose body is entirely covered by one single test showed up as
 * 6 separate "Satır N" nodes in the sidebar, each expanding to the exact
 * same one test (NotifyingCalculator.java, real playground data). Ardışık
 * satırların aynı test kümesiyle kapsanması tek bir aralığa toplanmalı,
 * `coverageView.ts`'in `uncoveredNewRanges` için zaten kullandığı desenle
 * aynı fikir.
 */
test('groupConsecutiveLines: consecutive lines with the exact same test set merge into one range', () => {
	const linesToTests = new Map([
		[9, ['NotifyingCalculatorMockitoTest#addAndNotifySendsTheComputedResult()']],
		[10, ['NotifyingCalculatorMockitoTest#addAndNotifySendsTheComputedResult()']],
		[11, ['NotifyingCalculatorMockitoTest#addAndNotifySendsTheComputedResult()']],
	]);
	const groups = groupConsecutiveLines(linesToTests);
	assert.deepEqual(groups, [{ startLine: 9, endLine: 11, tests: ['NotifyingCalculatorMockitoTest#addAndNotifySendsTheComputedResult()'] }]);
});

test('groupConsecutiveLines: a differently-tested line in the middle splits the range', () => {
	const linesToTests = new Map([
		[9, ['TestA#a()']],
		[10, ['TestB#b()']],
		[11, ['TestA#a()']],
	]);
	const groups = groupConsecutiveLines(linesToTests);
	assert.deepEqual(groups, [
		{ startLine: 9, endLine: 9, tests: ['TestA#a()'] },
		{ startLine: 10, endLine: 10, tests: ['TestB#b()'] },
		{ startLine: 11, endLine: 11, tests: ['TestA#a()'] },
	]);
});

test('groupConsecutiveLines: a non-consecutive line number (a gap) never merges even with the same test set', () => {
	const linesToTests = new Map([
		[9, ['TestA#a()']],
		[15, ['TestA#a()']],
	]);
	const groups = groupConsecutiveLines(linesToTests);
	assert.deepEqual(groups, [
		{ startLine: 9, endLine: 9, tests: ['TestA#a()'] },
		{ startLine: 15, endLine: 15, tests: ['TestA#a()'] },
	]);
});

test('groupConsecutiveLines: the same test set in a different order still merges (order-independent comparison)', () => {
	const linesToTests = new Map([
		[9, ['TestA#a()', 'TestB#b()']],
		[10, ['TestB#b()', 'TestA#a()']],
	]);
	const groups = groupConsecutiveLines(linesToTests);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].startLine, 9);
	assert.equal(groups[0].endLine, 10);
});

test('groupConsecutiveLines: a lone line is its own group with startLine === endLine', () => {
	const groups = groupConsecutiveLines(new Map([[7, ['CalcTest#addsTwoNumbers()']]]));
	assert.deepEqual(groups, [{ startLine: 7, endLine: 7, tests: ['CalcTest#addsTwoNumbers()'] }]);
});
