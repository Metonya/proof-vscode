import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { classNameFromPath, fqcnToRootRelativePath, toAbsolutePath, toRepoRelativePath } from '../../../model/pathIndex';

const WORKSPACE_ROOT = path.join('C:', 'repo');

test('toAbsolutePath joins a repo-relative forward-slash path onto the workspace root', () => {
	const result = toAbsolutePath(WORKSPACE_ROOT, 'src/main/java/com/example/Calc.java');
	assert.equal(result, path.join(WORKSPACE_ROOT, 'src', 'main', 'java', 'com', 'example', 'Calc.java'));
});

test('toRepoRelativePath is the inverse of toAbsolutePath', () => {
	const absolute = toAbsolutePath(WORKSPACE_ROOT, 'src/main/java/Calc.java');
	assert.equal(toRepoRelativePath(WORKSPACE_ROOT, absolute), 'src/main/java/Calc.java');
});

test('a path outside the workspace root is undefined, not a guessed ../ relative path', () => {
	const outside = path.join('C:', 'elsewhere', 'Calc.java');
	assert.equal(toRepoRelativePath(WORKSPACE_ROOT, outside), undefined);
});

/** Faz 15b: mirrors coverdict-cli's ChangedClassTargets.forEachMappedFile, just run in the opposite direction. */
test('fqcnToRootRelativePath joins a root and dotted FQCN into a repo-relative .java path', () => {
	assert.equal(fqcnToRootRelativePath('src/test/java', 'dev.coverdict.playground.CalcTest'), 'src/test/java/dev/coverdict/playground/CalcTest.java');
});

test('fqcnToRootRelativePath tolerates a root with a trailing slash', () => {
	assert.equal(fqcnToRootRelativePath('src/test/java/', 'dev.example.CalcTest'), 'src/test/java/dev/example/CalcTest.java');
});

test('classNameFromPath is the inverse of fqcnToRootRelativePath for a path under one of the given sourceRoots', () => {
	const path2 = fqcnToRootRelativePath('src/main/java', 'dev.coverdict.playground.Calculator');
	assert.equal(classNameFromPath(path2, ['src/main/java']), 'dev.coverdict.playground.Calculator');
});

test('classNameFromPath returns undefined for a path under none of the given sourceRoots (never guesses)', () => {
	assert.equal(classNameFromPath('other/Calc.java', ['src/main/java']), undefined);
});

test('classNameFromPath returns undefined for a non-.java path', () => {
	assert.equal(classNameFromPath('src/main/java/Calc.txt', ['src/main/java']), undefined);
});
