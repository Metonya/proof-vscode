import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectClassName } from '../../../model/classNameDetector';

test('a real package declaration is combined with the file base name', () => {
	const source = 'package dev.proofjava.playground;\n\npublic class Calculator {\n}\n';
	assert.equal(detectClassName(source, 'Calculator'), 'dev.proofjava.playground.Calculator');
});

test('no package declaration falls back to the bare class name (default package)', () => {
	assert.equal(detectClassName('public class Calculator {}\n', 'Calculator'), 'Calculator');
});

test('leading blank lines and comments before the package declaration do not confuse detection', () => {
	const source = '\n\n// a leading comment\npackage dev.proofjava.playground;\npublic class Calc {}\n';
	assert.equal(detectClassName(source, 'Calc'), 'dev.proofjava.playground.Calc');
});

/**
 * SonarQube flagged PACKAGE_DECLARATION as a possible DoS-by-backtracking
 * hotspot (typescript:S5852). Reviewed and marked safe rather than left
 * unverified: no nested quantifier exists in `/^\s*package\s+([\w.]+)\s*;/m`
 * - `[\w.]+` cannot overlap with the surrounding `\s*`/`;`, so there is no
 * ambiguous split to backtrack across. This proves it against a genuinely
 * adversarial input (many long, non-matching "package"-like lines with no
 * terminating semicolon) rather than asserting it from the pattern alone.
 */
test('a large file with many non-matching "package"-shaped lines is still handled in linear time', () => {
	const adversarialLine = `package ${'a.'.repeat(2000)}a `.repeat(1) + '\n';
	const source = adversarialLine.repeat(500) + 'package dev.proofjava.playground;\n';

	const start = Date.now();
	const result = detectClassName(source, 'Calculator');
	const elapsedMs = Date.now() - start;

	assert.equal(result, 'dev.proofjava.playground.Calculator');
	assert.ok(elapsedMs < 1000, `expected linear-time matching, took ${elapsedMs}ms`);
});
