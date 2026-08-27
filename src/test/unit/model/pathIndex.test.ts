import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { toAbsolutePath, toRepoRelativePath } from '../../../model/pathIndex';

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
