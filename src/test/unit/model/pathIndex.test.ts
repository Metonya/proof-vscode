import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { classifySourcePath, classNameFromPath, fqcnToRootRelativePath, toAbsolutePath, toRepoRelativePath } from '../../../model/pathIndex';

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

/**
 * Faz 21: the direction "Satır → Testler" and the hover render is decided
 * here, from the CLI's own `inputs.modules[]` - not from whether a class
 * happens to have per-test line records, which PIT's collector writes for
 * test classes too.
 */
const SINGLE_MODULE = [{ sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }];

test('classifySourcePath calls a file under testRoots a test', () => {
	assert.equal(classifySourcePath('src/test/java/dev/coverdict/playground/CalcTest.java', SINGLE_MODULE), 'test');
});

test('classifySourcePath calls a file under sourceRoots production', () => {
	assert.equal(classifySourcePath('src/main/java/dev/coverdict/playground/Calculator.java', SINGLE_MODULE), 'production');
});

test('classifySourcePath returns unknown for a file under no declared root - never a silent "production"', () => {
	assert.equal(classifySourcePath('tools/Generate.java', SINGLE_MODULE), 'unknown');
});

test('classifySourcePath returns unknown when there are no modules at all (an old restored verdict)', () => {
	assert.equal(classifySourcePath('src/test/java/CalcTest.java', []), 'unknown');
});

test('classifySourcePath prefers the more specific testRoot when a sourceRoot is its ancestor', () => {
	const nested = [{ sourceRoots: ['src'], testRoots: ['src/test/java'] }];
	assert.equal(classifySourcePath('src/test/java/CalcTest.java', nested), 'test');
	assert.equal(classifySourcePath('src/main/java/Calc.java', nested), 'production');
});

test('classifySourcePath searches every declared module, not just the first', () => {
	const multi = [
		{ sourceRoots: ['core/src/main/java'], testRoots: ['core/src/test/java'] },
		{ sourceRoots: ['api/src/main/java'], testRoots: ['api/src/test/java'] },
	];
	assert.equal(classifySourcePath('api/src/test/java/ApiTest.java', multi), 'test');
	assert.equal(classifySourcePath('api/src/main/java/Api.java', multi), 'production');
});

test('classifySourcePath does not treat a sibling directory with a shared prefix as being under the root', () => {
	assert.equal(classifySourcePath('src/test/javafx/Thing.java', SINGLE_MODULE), 'unknown');
});
