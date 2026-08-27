import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTestIdentity } from '../../../verdict/testIdentity';

test('a JUnit5 UniqueId string is parsed into class and method', () => {
	const raw = '[engine:junit-jupiter]/[class:dev.coverdict.playground.CalcTest]/[method:addsTwoNumbers()]';
	const result = parseTestIdentity(raw);
	assert.equal(result.className, 'dev.coverdict.playground.CalcTest');
	assert.equal(result.methodName, 'addsTwoNumbers');
	assert.equal(result.display, 'dev.coverdict.playground.CalcTest#addsTwoNumbers()');
});

test('a Class#method() shape is parsed directly', () => {
	const result = parseTestIdentity('dev.coverdict.playground.CalcTest#addsTwoNumbers()');
	assert.equal(result.className, 'dev.coverdict.playground.CalcTest');
	assert.equal(result.methodName, 'addsTwoNumbers');
	assert.equal(result.display, 'dev.coverdict.playground.CalcTest#addsTwoNumbers()');
});

test('an unrecognized shape is shown verbatim rather than guessed at (hard rule 3a)', () => {
	const raw = 'SomeWeirdEngine::totallyUnknownFormat';
	const result = parseTestIdentity(raw);
	assert.equal(result.className, null);
	assert.equal(result.methodName, null);
	assert.equal(result.display, raw);
});
