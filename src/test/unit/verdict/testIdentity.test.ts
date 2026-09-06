import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTestIdentity } from '../../../verdict/testIdentity';

test('a JUnit5 UniqueId string is parsed into class and method, display uses the short class name', () => {
	const raw = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalcTest]/[method:addsTwoNumbers()]';
	const result = parseTestIdentity(raw);
	assert.equal(result.className, 'dev.proofjava.playground.CalcTest');
	assert.equal(result.simpleClassName, 'CalcTest');
	assert.equal(result.methodName, 'addsTwoNumbers');
	assert.equal(result.invocation, null);
	assert.equal(result.display, 'CalcTest#addsTwoNumbers()');
});

/**
 * Faz 14c: the real regression this exists for - a real `@ParameterizedTest`
 * invocation id from coverdict-playground's `CalculatorParameterizedTest`
 * (captured from a live --per-test-target run, 2026-08-28). The original
 * parser only looked for `[method:]`, so this fell through to the `#`-
 * splitting fallback and found the `#1` inside `[test-template-invocation:
 * #1]`, mis-parsing the whole UniqueId as one giant unrecognized string -
 * exactly what made the panel unreadable.
 */
test('a JUnit5 test-template-invocation (@ParameterizedTest) id is parsed, not mis-split on its own "#"', () => {
	const raw = 'dev.proofjava.playground.CalculatorParameterizedTest.[engine:junit-jupiter]/'
		+ '[class:dev.proofjava.playground.CalculatorParameterizedTest]/'
		+ '[test-template:addProducesTheSumForEveryPair(int, int, int)]/[test-template-invocation:#1]';
	const result = parseTestIdentity(raw);
	assert.equal(result.className, 'dev.proofjava.playground.CalculatorParameterizedTest');
	assert.equal(result.simpleClassName, 'CalculatorParameterizedTest');
	assert.equal(result.methodName, 'addProducesTheSumForEveryPair');
	assert.equal(result.invocation, '1');
	assert.equal(result.display, 'CalculatorParameterizedTest#addProducesTheSumForEveryPair() #1');
});

test('a test-template id with no invocation segment still parses the method, invocation stays null', () => {
	const raw = '[class:dev.proofjava.playground.CalculatorParameterizedTest]/[test-template:addProducesTheSumForEveryPair(int, int, int)]';
	const result = parseTestIdentity(raw);
	assert.equal(result.methodName, 'addProducesTheSumForEveryPair');
	assert.equal(result.invocation, null);
	assert.equal(result.display, 'CalculatorParameterizedTest#addProducesTheSumForEveryPair()');
});

test('a Class#method() shape is parsed directly, display uses the short class name', () => {
	const result = parseTestIdentity('dev.proofjava.playground.CalcTest#addsTwoNumbers()');
	assert.equal(result.className, 'dev.proofjava.playground.CalcTest');
	assert.equal(result.simpleClassName, 'CalcTest');
	assert.equal(result.methodName, 'addsTwoNumbers');
	assert.equal(result.display, 'CalcTest#addsTwoNumbers()');
});

test('a Class#method() shape with no package keeps the bare class name', () => {
	const result = parseTestIdentity('CalcTest#addsTwoNumbers()');
	assert.equal(result.className, 'CalcTest');
	assert.equal(result.simpleClassName, 'CalcTest');
});

test('an unrecognized shape is shown verbatim rather than guessed at (hard rule 3a)', () => {
	const raw = 'SomeWeirdEngine::totallyUnknownFormat';
	const result = parseTestIdentity(raw);
	assert.equal(result.className, null);
	assert.equal(result.methodName, null);
	assert.equal(result.simpleClassName, null);
	assert.equal(result.invocation, null);
	assert.equal(result.display, raw);
});

test('a [class:] UniqueId with neither [method:] nor [test-template:] falls back to the raw id (hard rule 3a)', () => {
	const raw = '[engine:junit-jupiter]/[class:dev.proofjava.playground.CalcTest]';
	const result = parseTestIdentity(raw);
	assert.equal(result.className, null);
	assert.equal(result.display, raw);
});
