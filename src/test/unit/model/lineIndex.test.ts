import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { allClasses, groupConsecutiveLines, testsForClass, testsToLines } from '../../../model/lineIndex';
import type { PerTestBlock } from '../../../verdict/types';

const BLOCK: PerTestBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [
			{ className: 'dev.proofjava.playground.Calculator', methodName: 'add', lines: [
				{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] },
			] },
			{ className: 'dev.proofjava.playground.Calculator$Inner', methodName: 'helper', lines: [
				{ line: 40, tests: ['CalcTest#innerHelperTest()'] },
			] },
		],
		ambient: [
			{ className: 'dev.proofjava.playground.Calculator', methodName: '<clinit>', lines: [
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
	const result = testsForClass(BLOCK, 'dev.proofjava.playground.Calculator');
	assert.equal(result.kind, 'found');
	if (result.kind === 'found') {
		assert.deepEqual(result.linesToTests.get(7), ['CalcTest#addsTwoNumbers()']);
		assert.equal(result.linesToTests.get(3), undefined, 'line 3 only has ambient evidence, must not appear in linesToTests');
		assert.deepEqual(result.ambientLinesToTests.get(3), ['CalcTest#addsTwoNumbers()']);
	}
});

/** Faz 24 (§7.6 madde 4): `linesToMethod` gerçek `methodName` alanından geliyor - satır 3 yalnızca ambient'te olduğu için `linesToMethod`'da değil `ambientLinesToMethod`'da görünür. */
test('linesToMethod carries the real production method name per line, ambient stays in its own map', () => {
	const result = testsForClass(BLOCK, 'dev.proofjava.playground.Calculator');
	assert.equal(result.kind, 'found');
	if (result.kind === 'found') {
		assert.equal(result.linesToMethod.get(7), 'add');
		assert.equal(result.linesToMethod.get(3), undefined);
		assert.equal(result.ambientLinesToMethod.get(3), '<clinit>');
	}
});

test('a nested class entry is matched under its outer class name', () => {
	const result = testsForClass(BLOCK, 'dev.proofjava.playground.Calculator');
	assert.equal(result.kind, 'found');
	if (result.kind === 'found') {
		assert.deepEqual(result.linesToTests.get(40), ['CalcTest#innerHelperTest()']);
	}
});

/** Faz 30: no L2 evidence collected at all this run (`perTest.modules` empty) is distinct from "collected, but not for this class" (hard rule 3a). */
test('an empty modules array is noEvidence, distinct from a missing class', () => {
	const empty: PerTestBlock = { engine: 'pitest', engineVersion: '1.15.8', modules: [] };
	const result = testsForClass(empty, 'dev.proofjava.playground.Calculator');
	assert.equal(result.kind, 'noEvidence');
});

test('a class with no matching entries is classNotFound - "L2 sadece değişen sınıflar için"', () => {
	const result = testsForClass(BLOCK, 'dev.proofjava.playground.NotAChangedClass');
	assert.equal(result.kind, 'classNotFound');
});

/** Faz 31: `allClasses` - "Satır → Testler"'in hiç dosya açık değilken gösterdiği kök. */
const TWO_CLASSES: PerTestBlock = {
	engine: 'pitest', engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [
			{ className: 'dev.proofjava.playground.Calculator', methodName: 'add', lines: [{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] }] },
			{ className: 'dev.proofjava.playground.Multiplier', methodName: 'times', lines: [{ line: 12, tests: ['MultiplierTest#timesTwo()'] }] },
			{ className: 'dev.proofjava.playground.CalculatorGoodTest', methodName: 'addsTwoNumbers', lines: [{ line: 5, tests: ['CalcTest#addsTwoNumbers()'] }] },
		],
		ambient: [],
	}],
};

test('allClasses: groups entries by outer class name, one ClassLines per real class', () => {
	const classes = allClasses(TWO_CLASSES);
	assert.deepEqual(classes.map((c) => c.className), ['dev.proofjava.playground.Calculator', 'dev.proofjava.playground.CalculatorGoodTest', 'dev.proofjava.playground.Multiplier']);
	const calculator = classes.find((c) => c.className === 'dev.proofjava.playground.Calculator')!;
	assert.deepEqual(calculator.linesToTests.get(7), ['CalcTest#addsTwoNumbers()']);
	assert.equal(calculator.linesToMethod.get(7), 'add');
});

test('allClasses: with a production-class filter, test classes (PIT mutates them too) are dropped - same convention as classesOf/testsToLines', () => {
	const isProduction = (className: string) => className !== 'dev.proofjava.playground.CalculatorGoodTest';
	const classes = allClasses(TWO_CLASSES, isProduction);
	assert.deepEqual(classes.map((c) => c.className), ['dev.proofjava.playground.Calculator', 'dev.proofjava.playground.Multiplier']);
});

test('allClasses: without a filter nothing is dropped - missing information must not silently delete evidence', () => {
	assert.equal(allClasses(TWO_CLASSES).length, 3);
});

test('allClasses: an empty modules array returns an empty list, not an error', () => {
	const empty: PerTestBlock = { engine: 'pitest', engineVersion: '1.15.8', modules: [] };
	assert.deepEqual(allClasses(empty), []);
});

test('allClasses: a nested class entry is grouped under its outer class name', () => {
	const classes = allClasses(BLOCK);
	assert.deepEqual(classes.map((c) => c.className), ['dev.proofjava.playground.Calculator']);
	assert.deepEqual(classes[0].linesToTests.get(40), ['CalcTest#innerHelperTest()'], 'the $Inner entry must merge into the outer class');
});

/** Faz 30: a multi-module run's evidence merges - a class in either module's entries is found, without needing to know which module it came from. */
test('testsForClass merges evidence across several bound modules', () => {
	const twoModules: PerTestBlock = {
		engine: 'pitest', engineVersion: '1.15.8',
		modules: [
			BLOCK.modules[0],
			{
				id: 'gson',
				entries: [{ className: 'com.example.Other', methodName: 'run', lines: [{ line: 12, tests: ['OtherTest#runs()'] }] }],
				ambient: [],
			},
		],
	};
	const fromFirstModule = testsForClass(twoModules, 'dev.proofjava.playground.Calculator');
	assert.equal(fromFirstModule.kind, 'found');
	const fromSecondModule = testsForClass(twoModules, 'com.example.Other');
	assert.equal(fromSecondModule.kind, 'found');
	if (fromSecondModule.kind === 'found') {
		assert.deepEqual(fromSecondModule.linesToTests.get(12), ['OtherTest#runs()']);
	}
});

/**
 * Faz 15a: `testsForClass`'ın tersi - "bu test hangi satırları çalıştırıyor".
 * Anahtar `parseTestIdentity`'nin `Class#method()` biçimi, `model/
 * testQuality.ts`'in `finding.testMethod` eşleştirmesiyle aynı sözleşme.
 */
test('testsToLines: a test appears once per production line it covers, keyed by Class#method()', () => {
	const reverse = testsToLines(BLOCK);
	const refs = reverse.get('CalcTest#addsTwoNumbers()');
	assert.ok(refs);
	assert.deepEqual([...refs!].sort((a, b) => a.line - b.line), [{ outerClassName: 'dev.proofjava.playground.Calculator', line: 7 }]);
});

test('testsToLines: ambient (<clinit>-only) evidence is excluded - a test does not "run" a line it only reached indirectly', () => {
	const reverse = testsToLines(BLOCK);
	const refs = reverse.get('CalcTest#addsTwoNumbers()');
	assert.ok(refs);
	assert.ok(!refs!.some((r) => r.line === 3), 'line 3 is ambient-only, must not appear in the reverse index');
});

test('testsToLines: a nested-class entry is reported under its outer class name', () => {
	const reverse = testsToLines(BLOCK);
	const refs = reverse.get('CalcTest#innerHelperTest()');
	assert.deepEqual(refs, [{ outerClassName: 'dev.proofjava.playground.Calculator', line: 40 }]);
});

/**
 * Faz 21: PIT'in L2 toplayıcısı test sınıflarını da `entries`'e yazıyor
 * (gerçek playground koşusuyla doğrulandı) - süzgeç verilmezse bir test
 * kendi gövdesinin satırlarını "çalıştırdığı production satırları" diye
 * listeler.
 */
const BLOCK_WITH_SELF_COVERING_TEST: PerTestBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [
			{ className: 'dev.proofjava.playground.Calculator', methodName: 'add', lines: [{ line: 7, tests: ['CalcTest#addsTwoNumbers()'] }] },
			{ className: 'dev.proofjava.playground.CalcTest', methodName: 'addsTwoNumbers', lines: [{ line: 18, tests: ['CalcTest#addsTwoNumbers()'] }] },
		],
		ambient: [],
	}],
};

test('testsToLines: with a production-class filter, a test does not report its own lines as production lines', () => {
	const reverse = testsToLines(BLOCK_WITH_SELF_COVERING_TEST, (c) => c === 'dev.proofjava.playground.Calculator');
	assert.deepEqual(reverse.get('CalcTest#addsTwoNumbers()')?.map((r) => r.line), [7]);
});

test('testsToLines: without a filter nothing is dropped - missing information must not silently delete evidence', () => {
	const reverse = testsToLines(BLOCK_WITH_SELF_COVERING_TEST);
	assert.deepEqual(reverse.get('CalcTest#addsTwoNumbers()')?.map((r) => r.line), [7, 18]);
});

test('testsToLines: an empty modules array returns an empty map, not an error', () => {
	const empty: PerTestBlock = { engine: 'pitest', engineVersion: '1.15.8', modules: [] };
	assert.equal(testsToLines(empty).size, 0);
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
	assert.deepEqual(groups, [{ startLine: 9, endLine: 11, tests: ['NotifyingCalculatorMockitoTest#addAndNotifySendsTheComputedResult()'], methodName: undefined }]);
});

test('groupConsecutiveLines: a differently-tested line in the middle splits the range', () => {
	const linesToTests = new Map([
		[9, ['TestA#a()']],
		[10, ['TestB#b()']],
		[11, ['TestA#a()']],
	]);
	const groups = groupConsecutiveLines(linesToTests);
	assert.deepEqual(groups, [
		{ startLine: 9, endLine: 9, tests: ['TestA#a()'], methodName: undefined },
		{ startLine: 10, endLine: 10, tests: ['TestB#b()'], methodName: undefined },
		{ startLine: 11, endLine: 11, tests: ['TestA#a()'], methodName: undefined },
	]);
});

test('groupConsecutiveLines: a non-consecutive line number (a gap) never merges even with the same test set', () => {
	const linesToTests = new Map([
		[9, ['TestA#a()']],
		[15, ['TestA#a()']],
	]);
	const groups = groupConsecutiveLines(linesToTests);
	assert.deepEqual(groups, [
		{ startLine: 9, endLine: 9, tests: ['TestA#a()'], methodName: undefined },
		{ startLine: 15, endLine: 15, tests: ['TestA#a()'], methodName: undefined },
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
	assert.deepEqual(groups, [{ startLine: 7, endLine: 7, tests: ['CalcTest#addsTwoNumbers()'], methodName: undefined }]);
});

/**
 * Faz 24 (§7.6 madde 4): real playground data (verified 2026-08-28,
 * --per-test-target root=dev.proofjava.playground.Calculator) shows the
 * compiler-generated no-arg constructor's single instruction attributed to
 * the class declaration line, "Satır 4 · 14 test" - every test that builds
 * a Calculator shows up there, which reads as noise unless the line is
 * labelled with the method it actually belongs to (`<init>`).
 */
test('groupConsecutiveLines: linesToMethod labels a range with its production method, real <init> shape', () => {
	const linesToTests = new Map([[4, Array.from({ length: 14 }, (_, i) => `Test${i}#t()`)]]);
	const linesToMethod = new Map([[4, '<init>']]);
	const groups = groupConsecutiveLines(linesToTests, linesToMethod);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].methodName, '<init>');
});

test('groupConsecutiveLines: adjacent lines from two different methods never merge even with identical test sets', () => {
	const linesToTests = new Map([
		[10, ['TestA#a()']],
		[11, ['TestA#a()']],
	]);
	const linesToMethod = new Map([[10, 'foo'], [11, 'bar']]);
	const groups = groupConsecutiveLines(linesToTests, linesToMethod);
	assert.deepEqual(groups, [
		{ startLine: 10, endLine: 10, tests: ['TestA#a()'], methodName: 'foo' },
		{ startLine: 11, endLine: 11, tests: ['TestA#a()'], methodName: 'bar' },
	]);
});
