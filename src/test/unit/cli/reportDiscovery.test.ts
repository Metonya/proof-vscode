import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeModuleForReport, toRepoRelativePosix } from '../../../cli/reportDiscovery';

test('a report at the workspace root needs no module binding', () => {
	const module = describeModuleForReport('target/site/jacoco/jacoco.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'target/site/jacoco/jacoco.xml');
});

test('a report under a Maven module subdirectory is bound to that module root', () => {
	const module = describeModuleForReport('gson/target/site/jacoco/jacoco.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, 'gson');
	assert.equal(module.reportPath, 'gson/target/site/jacoco/jacoco.xml');
});

test('nested module paths keep every segment in the root', () => {
	const module = describeModuleForReport('modules/service-a/target/site/jacoco/jacoco.xml');
	assert.equal(module.root, 'modules/service-a');
});

test('a report at an unfamiliar layout falls back to the repo root rather than guessing', () => {
	const module = describeModuleForReport('some/other/coverage/jacoco.xml');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'some/other/coverage/jacoco.xml');
});

test('toRepoRelativePosix strips the repo root and normalizes backslashes', () => {
	const rel = toRepoRelativePosix('C:\\repo\\gson\\target\\site\\jacoco\\jacoco.xml', 'C:\\repo');
	assert.equal(rel, 'gson/target/site/jacoco/jacoco.xml');
});

test('toRepoRelativePosix on an already-relative-looking mismatch returns the normalized input unchanged', () => {
	const rel = toRepoRelativePosix('/elsewhere/jacoco.xml', 'C:\\repo');
	assert.equal(rel, '/elsewhere/jacoco.xml');
});
