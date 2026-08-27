import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectClassName } from '../../../model/classNameDetector';

test('a real package declaration is combined with the file base name', () => {
	const source = 'package dev.coverdict.playground;\n\npublic class Calculator {\n}\n';
	assert.equal(detectClassName(source, 'Calculator'), 'dev.coverdict.playground.Calculator');
});

test('no package declaration falls back to the bare class name (default package)', () => {
	assert.equal(detectClassName('public class Calculator {}\n', 'Calculator'), 'Calculator');
});

test('leading blank lines and comments before the package declaration do not confuse detection', () => {
	const source = '\n\n// a leading comment\npackage dev.coverdict.playground;\npublic class Calc {}\n';
	assert.equal(detectClassName(source, 'Calc'), 'dev.coverdict.playground.Calc');
});
